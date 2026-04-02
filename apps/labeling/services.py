from django.db import connection, transaction
from django.db.models import Count, Exists, IntegerField, OuterRef, Subquery
from django.db.models.functions import Coalesce
from django.utils import timezone

from apps.labeling.consensus import evaluate_annotation_consensus
from apps.labeling.models import Annotation, Task, TaskAssignment
from apps.labeling.workflows import is_text_detection_workflow
from apps.rooms.models import Room, RoomMembership
from apps.rooms.policies import can_annotate_room, can_review_room
from apps.users.models import User
from common.exceptions import AccessDeniedError, ConflictError

"""
Write-side business logic for task assignment and annotation submission.

Key invariant:
- a task can require more than one review when room cross-validation is enabled
- assignments are created lazily when an annotator requests the next task
- consensus is evaluated when enough submissions for the current round exist
"""


def _assert_joined_membership(*, room: Room, annotator: User) -> None:
    membership = RoomMembership.objects.filter(room=room, user=annotator).only("status", "role").first()
    if not can_annotate_room(room=room, user=annotator, membership=membership):
        raise AccessDeniedError("Current user cannot label tasks in this room.")


def _build_stage_two_payload(*, task: Task, consensus_payload: dict, submitted_assignments: list[TaskAssignment]) -> dict:
    return {
        **task.input_payload,
        "workflow_stage": Task.WorkflowStage.TEXT_TRANSCRIPTION,
        "detection_task_id": task.id,
        "detected_annotations": consensus_payload.get("annotations", []),
        "excluded_annotator_ids": sorted({assignment.annotator_id for assignment in submitted_assignments}),
    }


def _create_followup_transcription_task(*, task: Task, consensus_payload: dict, submitted_assignments: list[TaskAssignment]) -> None:
    if task.child_tasks.filter(workflow_stage=Task.WorkflowStage.TEXT_TRANSCRIPTION).exists():
        return

    annotations = consensus_payload.get("annotations", [])
    Task.objects.create(
        room=task.room,
        parent_task=task,
        source_type=task.source_type,
        workflow_stage=Task.WorkflowStage.TEXT_TRANSCRIPTION,
        source_name=task.source_name,
        source_file=task.source_file.name if task.source_file else "",
        input_payload=_build_stage_two_payload(task=task, consensus_payload=consensus_payload, submitted_assignments=submitted_assignments),
        status=Task.Status.SUBMITTED if not annotations else Task.Status.PENDING,
        validation_score=100.0 if not annotations else None,
        consensus_payload={"annotations": []} if not annotations else None,
    )


def get_next_task_for_annotator(*, room: Room, annotator: User):
    _assert_joined_membership(room=room, annotator=annotator)

    with transaction.atomic():
        # Reuse an unfinished assignment first so refreshes do not hand out a
        # second task to the same annotator while the current one is open.
        current_assignment = (
            TaskAssignment.objects.select_related("task")
            .select_for_update()
            .filter(
                task__room=room,
                annotator=annotator,
                status=TaskAssignment.Status.IN_PROGRESS,
            )
            .order_by("task_id")
            .first()
        )
        if current_assignment:
            return current_assignment.task

        annotator_assignments = TaskAssignment.objects.filter(
            task_id=OuterRef("pk"),
            annotator=annotator,
        )
        round_assignments = (
            TaskAssignment.objects.filter(
                task_id=OuterRef("pk"),
                round_number=OuterRef("current_round"),
            )
            .values("task_id")
            .annotate(total=Count("id"))
            .values("total")[:1]
        )
        queryset = (
            Task.objects.filter(
                room=room,
                status__in=(Task.Status.PENDING, Task.Status.IN_PROGRESS),
            )
            .annotate(
                has_annotator_assignment=Exists(annotator_assignments),
                round_assignments_count=Coalesce(
                    Subquery(round_assignments, output_field=IntegerField()),
                    0,
                ),
            )
            .filter(
                has_annotator_assignment=False,
                round_assignments_count__lt=room.required_reviews_per_item,
            )
            .exclude(
                workflow_stage=Task.WorkflowStage.TEXT_TRANSCRIPTION,
                input_payload__excluded_annotator_ids__contains=[annotator.id],
            )
            .order_by("id")
        )
        # `skip_locked` lets multiple annotators ask for work concurrently
        # without blocking each other on the same candidate task.
        if connection.features.has_select_for_update_skip_locked:
            queryset = queryset.select_for_update(skip_locked=True)
        else:
            queryset = queryset.select_for_update()

        next_task = queryset.first()
        if next_task:
            TaskAssignment.objects.create(
                task=next_task,
                annotator=annotator,
                round_number=next_task.current_round,
                status=TaskAssignment.Status.IN_PROGRESS,
                assigned_at=timezone.now(),
            )

            if next_task.status != Task.Status.IN_PROGRESS:
                next_task.status = Task.Status.IN_PROGRESS
                next_task.save(update_fields=["status", "updated_at"])

            return next_task

        return None


def submit_annotation(*, task: Task, annotator: User, result_payload):
    with transaction.atomic():
        locked_task = Task.objects.select_for_update().select_related("room").get(id=task.id)
        if locked_task.status != Task.Status.IN_PROGRESS:
            raise ConflictError("Only tasks in progress can be submitted.")

        assignment = (
            TaskAssignment.objects.select_for_update()
            .filter(
                task=locked_task,
                annotator=annotator,
                status=TaskAssignment.Status.IN_PROGRESS,
            )
            .order_by("-round_number", "-assigned_at")
            .first()
        )
        if assignment is None:
            raise AccessDeniedError("Task is not assigned to the current annotator.")

        if Annotation.objects.filter(assignment=assignment).exists():
            raise ConflictError("Annotation for this assignment already exists.")

        annotation = Annotation.objects.create(
            task=locked_task,
            assignment=assignment,
            annotator=annotator,
            result_payload=result_payload,
            submitted_at=timezone.now(),
        )

        assignment.status = TaskAssignment.Status.SUBMITTED
        assignment.submitted_at = annotation.submitted_at
        assignment.save(update_fields=["status", "submitted_at", "updated_at"])

        round_assignments = list(
            locked_task.assignments.filter(round_number=locked_task.current_round).order_by("id")
        )
        submitted_assignments = [item for item in round_assignments if item.status == TaskAssignment.Status.SUBMITTED]

        required_reviews = locked_task.room.required_reviews_per_item
        if len(submitted_assignments) >= required_reviews:
            # Once the round has enough reviews we either accept consensus and
            # close the task, or reopen it for the next round.
            round_annotations = list(
                Annotation.objects.filter(assignment__in=submitted_assignments).order_by("submitted_at", "id")
            )
            consensus = evaluate_annotation_consensus(
                annotations=round_annotations,
                similarity_threshold=locked_task.room.cross_validation_similarity_threshold,
            )

            locked_task.validation_score = consensus["score"]
            if consensus["accepted"]:
                locked_task.status = Task.Status.SUBMITTED
                locked_task.consensus_payload = consensus["consensus_payload"]
            else:
                locked_task.status = Task.Status.PENDING
                locked_task.current_round += 1
                locked_task.consensus_payload = None

            locked_task.save(
                update_fields=[
                    "status",
                    "current_round",
                    "validation_score",
                    "consensus_payload",
                    "updated_at",
                ]
            )

            if (
                consensus["accepted"]
                and is_text_detection_workflow(room=locked_task.room)
                and locked_task.workflow_stage == Task.WorkflowStage.TEXT_DETECTION
                and locked_task.consensus_payload is not None
            ):
                _create_followup_transcription_task(
                    task=locked_task,
                    consensus_payload=locked_task.consensus_payload,
                    submitted_assignments=submitted_assignments,
                )
        else:
            locked_task.save(update_fields=["updated_at"])

        return annotation


def reject_task_annotation(*, task: Task, reviewer: User) -> Task:
    if not can_review_room(room=task.room, user=reviewer):
        raise AccessDeniedError("You do not have permission to reject annotations in this room.")

    with transaction.atomic():
        locked_task = Task.objects.select_for_update().select_related("room").get(id=task.id)
        if not can_review_room(room=locked_task.room, user=reviewer):
            raise AccessDeniedError("You do not have permission to reject annotations in this room.")
        if locked_task.status != Task.Status.SUBMITTED:
            raise ConflictError("Only submitted tasks can be rejected.")

        locked_task.status = Task.Status.PENDING
        locked_task.current_round += 1
        locked_task.validation_score = None
        locked_task.consensus_payload = None
        locked_task.save(
            update_fields=[
                "status",
                "current_round",
                "validation_score",
                "consensus_payload",
                "updated_at",
            ]
        )
        return locked_task
