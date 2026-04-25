from django.db import connection, transaction
from django.db.models import Count, Exists, F, IntegerField, OuterRef, Subquery
from django.db.models.functions import Coalesce
from django.utils import timezone

from apps.labeling.consensus import evaluate_annotation_consensus
from apps.labeling.distribution import (
    get_effective_reviews_for_task,
    get_task_assignment_pool_ids,
    get_task_designated_annotator_ids,
)
from apps.labeling.models import Annotation, Task, TaskAssignment
from apps.labeling.workflows import (
    build_task_input_payload_with_revision_target,
    get_task_is_final_stage,
    get_task_revision_target_annotator_id,
    is_text_detection_workflow,
)
from apps.rooms.models import Room, RoomAssignmentQuota, RoomMembership
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


ACTIVE_ASSIGNMENT_STATUSES = (
    TaskAssignment.Status.IN_PROGRESS,
    TaskAssignment.Status.SUBMITTED,
)


def _assert_joined_membership(*, room: Room, annotator: User) -> None:
    membership = RoomMembership.objects.filter(room=room, user=annotator).only("status", "role").first()
    if not can_annotate_room(room=room, user=annotator, membership=membership):
        raise AccessDeniedError("Текущий пользователь не может размечать задачи в этой комнате.")


def get_room_assignment_quota_usage(*, room: Room, annotator: User) -> int:
    return TaskAssignment.objects.filter(
        task__room=room,
        annotator=annotator,
        round_number=F("task__current_round"),
        status__in=ACTIVE_ASSIGNMENT_STATUSES,
    ).count()


def _has_assignment_quota_capacity(*, room: Room, annotator: User) -> bool:
    task_quota = (
        RoomAssignmentQuota.objects.filter(room=room, user=annotator)
        .values_list("task_quota", flat=True)
        .first()
    )
    if task_quota is None:
        task_quota = room.default_assignment_quota
    if task_quota is None:
        return True
    return get_room_assignment_quota_usage(room=room, annotator=annotator) < task_quota


def _get_current_round_assignment_pool_ids(*, task: Task, round_assignments: list[TaskAssignment]) -> list[int]:
    skipped_annotator_ids = {
        assignment.annotator_id
        for assignment in round_assignments
        if assignment.status == TaskAssignment.Status.SKIPPED
    }
    return [
        annotator_id
        for annotator_id in get_task_assignment_pool_ids(task=task)
        if annotator_id not in skipped_annotator_ids
    ]


def _can_rescue_assignment_candidate(*, task: Task, annotator: User, assignment_pool_ids: list[int]) -> bool:
    if annotator.id not in assignment_pool_ids:
        return False
    if get_task_revision_target_annotator_id(task=task) is not None:
        return False
    return True


def _get_room_eligible_annotators_count(*, room: Room) -> int:
    joined_annotators_count = (
        RoomMembership.objects.filter(
            room=room,
            status=RoomMembership.Status.JOINED,
            role__in=(RoomMembership.Role.ANNOTATOR, RoomMembership.Role.ADMIN),
        )
        .count()
    )
    return joined_annotators_count + (1 if room.owner_is_annotator else 0)


def _build_stage_two_payload(*, task: Task, consensus_payload: dict, submitted_assignments: list[TaskAssignment]) -> dict:
    excluded_annotator_ids = []
    if _get_room_eligible_annotators_count(room=task.room) > 1:
        excluded_annotator_ids = sorted({assignment.annotator_id for assignment in submitted_assignments})

    return {
        **task.input_payload,
        "workflow_stage": Task.WorkflowStage.TEXT_TRANSCRIPTION,
        "detection_task_id": task.id,
        "detected_annotations": consensus_payload.get("annotations", []),
        "excluded_annotator_ids": excluded_annotator_ids,
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


def _delete_rejected_round_history(*, task: Task) -> None:
    TaskAssignment.objects.filter(task=task).exclude(round_number=task.current_round).delete()


def get_submission_editability(*, task: Task, assignment: TaskAssignment) -> tuple[bool, str | None]:
    if assignment.status != TaskAssignment.Status.SUBMITTED or assignment.round_number != task.current_round:
        return False, "Эта версия разметки уже ушла в другой раунд и больше не редактируется."
    if task.status == Task.Status.SUBMITTED:
        return False, "Задача уже финализирована и не может быть изменена без возврата на исправление."
    return True, None


def get_next_task_for_annotator(*, room: Room, annotator: User):
    """
    Finds and assigns the next available Task to the Annotator.
    
    This function is central to the labeling pipeline. It MUST be executed within
    an atomic transaction. It intelligently skips tasks that the annotator has already
    worked on, or tasks that have already gathered enough reviews (cross-validation).
    
    Notice the use of `select_for_update(skip_locked=True)`. This allows
    multiple workers to call this function concurrently without deadlocking or waiting
    for each other to release row locks. If you change this query, verify lock contention.
    """
    _assert_joined_membership(room=room, annotator=annotator)

    with transaction.atomic():
        # Reuse an unfinished assignment first so refreshes do not hand out a
        # second task to the same annotator while the current one is open.
        current_assignments = (
            TaskAssignment.objects.select_related("task")
            .select_for_update()
            .filter(
                task__room=room,
                annotator=annotator,
                status=TaskAssignment.Status.IN_PROGRESS,
            )
        )
        current_assignment = (
            current_assignments.filter(task__input_payload__revision_target_annotator_id=annotator.id)
            .order_by("task_id")
            .first()
        )
        if current_assignment is None:
            current_assignment = current_assignments.order_by("task_id").first()
        if current_assignment:
            return current_assignment.task

        if not _has_assignment_quota_capacity(room=room, annotator=annotator):
            return None

        annotator_assignments = TaskAssignment.objects.filter(
            task_id=OuterRef("pk"),
            annotator=annotator,
            round_number=OuterRef("current_round"),
        )
        round_assignments = (
            TaskAssignment.objects.filter(
                task_id=OuterRef("pk"),
                round_number=OuterRef("current_round"),
                status__in=ACTIVE_ASSIGNMENT_STATUSES,
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

        candidate_tasks = list(queryset.prefetch_related("assignments"))

        def choose_next_task(*, allow_rescue: bool) -> Task | None:
            for candidate_task in candidate_tasks:
                current_round_annotator_ids = {
                    assignment.annotator_id
                    for assignment in candidate_task.assignments.all()
                    if assignment.round_number == candidate_task.current_round
                    and assignment.status in ACTIVE_ASSIGNMENT_STATUSES
                }
                current_round_assignments = [
                    assignment
                    for assignment in candidate_task.assignments.all()
                    if assignment.round_number == candidate_task.current_round
                ]
                assignment_pool_ids = _get_current_round_assignment_pool_ids(
                    task=candidate_task,
                    round_assignments=current_round_assignments,
                )
                effective_reviews = get_effective_reviews_for_task(
                    task=candidate_task,
                    assignment_pool_ids=assignment_pool_ids,
                )
                if effective_reviews <= 0 or len(current_round_annotator_ids) >= effective_reviews:
                    continue

                designated_annotator_ids = get_task_designated_annotator_ids(
                    task=candidate_task,
                    current_round_annotator_ids=current_round_annotator_ids,
                    assignment_pool_ids=assignment_pool_ids,
                )
                if annotator.id in designated_annotator_ids:
                    return candidate_task
                if allow_rescue and _can_rescue_assignment_candidate(
                    task=candidate_task,
                    annotator=annotator,
                    assignment_pool_ids=assignment_pool_ids,
                ):
                    return candidate_task
            return None

        next_task = choose_next_task(allow_rescue=False)
        if next_task is None:
            next_task = choose_next_task(allow_rescue=True)

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
    """
    Saves an annotation payload and closes the task assignment.
    
    If room requires multiple reviews (cross-validation), this will check if the current
    round has gathered enough submissions. If it has, `evaluate_annotation_consensus` is called.
    
    Depending on consensus, the task is either:
    1. Marked SUBMITTED with a final consensus payload.
    2. Reset to PENDING and round incremented for another human to review.
    3. Triggers child task creation if in a multi-stage workflow.
    """
    with transaction.atomic():
        locked_task = Task.objects.select_for_update().select_related("room").get(id=task.id)
        if locked_task.status != Task.Status.IN_PROGRESS:
            raise ConflictError("Отправить можно только задачу, которая сейчас в работе.")

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
            raise AccessDeniedError("Эта задача не назначена текущему разметчику.")

        if Annotation.objects.filter(assignment=assignment).exists():
            raise ConflictError("Разметка для этого назначения уже существует.")

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

        revision_target_annotator_id = get_task_revision_target_annotator_id(task=locked_task)
        revision_gate_cleared = revision_target_annotator_id == annotator.id
        if revision_gate_cleared:
            locked_task.input_payload = build_task_input_payload_with_revision_target(task=locked_task, annotator_id=None)

        round_assignments = list(
            locked_task.assignments.filter(round_number=locked_task.current_round).order_by("id")
        )
        submitted_assignments = [item for item in round_assignments if item.status == TaskAssignment.Status.SUBMITTED]
        assignment_pool_ids = _get_current_round_assignment_pool_ids(
            task=locked_task,
            round_assignments=round_assignments,
        )

        required_reviews = get_effective_reviews_for_task(
            task=locked_task,
            assignment_pool_ids=assignment_pool_ids,
        )
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
                _delete_rejected_round_history(task=locked_task)
            else:
                locked_task.status = Task.Status.PENDING
                locked_task.current_round += 1
                locked_task.consensus_payload = None

            update_fields = [
                "status",
                "current_round",
                "validation_score",
                "consensus_payload",
                "updated_at",
            ]
            if revision_gate_cleared:
                update_fields.insert(4, "input_payload")
            locked_task.save(update_fields=update_fields)

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
            update_fields = ["updated_at"]
            if revision_gate_cleared:
                update_fields.insert(0, "input_payload")
            locked_task.save(update_fields=update_fields)

        return annotation


def skip_task_for_annotator(*, task: Task, annotator: User) -> Task:
    with transaction.atomic():
        locked_task = Task.objects.select_for_update().select_related("room").get(id=task.id)
        _assert_joined_membership(room=locked_task.room, annotator=annotator)
        if locked_task.source_type not in (Task.SourceType.IMAGE, Task.SourceType.VIDEO):
            raise ConflictError("Пропускать можно только задачи с изображениями или видео.")

        assignment = (
            TaskAssignment.objects.select_for_update()
            .filter(
                task=locked_task,
                annotator=annotator,
                status=TaskAssignment.Status.IN_PROGRESS,
                round_number=locked_task.current_round,
            )
            .order_by("-assigned_at", "-id")
            .first()
        )
        if assignment is None:
            raise AccessDeniedError("Эта задача не назначена текущему разметчику.")

        assignment.status = TaskAssignment.Status.SKIPPED
        assignment.submitted_at = None
        assignment.save(update_fields=["status", "submitted_at", "updated_at"])

        round_assignments = list(
            locked_task.assignments.filter(round_number=locked_task.current_round).order_by("id")
        )
        submitted_assignments = [item for item in round_assignments if item.status == TaskAssignment.Status.SUBMITTED]
        assignment_pool_ids = _get_current_round_assignment_pool_ids(
            task=locked_task,
            round_assignments=round_assignments,
        )
        required_reviews = get_effective_reviews_for_task(
            task=locked_task,
            assignment_pool_ids=assignment_pool_ids,
        )

        if required_reviews > 0 and len(submitted_assignments) >= required_reviews:
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
                _delete_rejected_round_history(task=locked_task)
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
            return locked_task

        if locked_task.status == Task.Status.IN_PROGRESS:
            active_assignments_exist = any(
                item.status in ACTIVE_ASSIGNMENT_STATUSES
                for item in round_assignments
            )
            if not active_assignments_exist:
                locked_task.status = Task.Status.PENDING
                locked_task.save(update_fields=["status", "updated_at"])
            else:
                locked_task.save(update_fields=["updated_at"])

        return locked_task


def update_submitted_annotation(*, task: Task, annotator: User, result_payload):
    with transaction.atomic():
        locked_task = Task.objects.select_for_update().select_related("room").get(id=task.id)
        _assert_joined_membership(room=locked_task.room, annotator=annotator)

        assignment = (
            TaskAssignment.objects.select_for_update()
            .filter(
                task=locked_task,
                annotator=annotator,
                status=TaskAssignment.Status.SUBMITTED,
                round_number=locked_task.current_round,
            )
            .order_by("-submitted_at", "-id")
            .first()
        )
        if assignment is None:
            raise AccessDeniedError("Отправленная разметка текущего пользователя не найдена.")

        # Reverse one-to-one joins to `annotation` are rendered as LEFT OUTER JOINs.
        # PostgreSQL does not allow `FOR UPDATE` on the nullable side of such joins,
        # so we lock the assignment row first and then lock the annotation separately.
        annotation = (
            Annotation.objects.select_for_update()
            .filter(assignment=assignment)
            .order_by("-submitted_at", "-id")
            .first()
        )
        if annotation is None:
            raise AccessDeniedError("Отправленная разметка текущего пользователя не найдена.")

        editable, reason = get_submission_editability(task=locked_task, assignment=assignment)
        if not editable:
            raise ConflictError(reason)

        submitted_at = timezone.now()
        annotation.result_payload = result_payload
        annotation.submitted_at = submitted_at
        annotation.save(update_fields=["result_payload", "submitted_at", "updated_at"])

        assignment.submitted_at = submitted_at
        assignment.save(update_fields=["submitted_at", "updated_at"])
        locked_task.save(update_fields=["updated_at"])
        return annotation


def reject_task_annotation(*, task: Task, reviewer: User) -> Task:
    if not can_review_room(room=task.room, user=reviewer):
        raise AccessDeniedError("У тебя нет прав отклонять разметки в этой комнате.")

    with transaction.atomic():
        locked_task = Task.objects.select_for_update().select_related("room").get(id=task.id)
        if not can_review_room(room=locked_task.room, user=reviewer):
            raise AccessDeniedError("У тебя нет прав отклонять разметки в этой комнате.")
        if locked_task.status != Task.Status.SUBMITTED:
            raise ConflictError("Отклонить можно только отправленные на проверку задачи.")

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


def return_task_annotation_for_revision(*, task: Task, reviewer: User, annotator_id: int) -> Task:
    if not can_review_room(room=task.room, user=reviewer):
        raise AccessDeniedError("У тебя нет прав возвращать разметки на исправление в этой комнате.")

    with transaction.atomic():
        locked_task = Task.objects.select_for_update().select_related("room").get(id=task.id)
        if not can_review_room(room=locked_task.room, user=reviewer):
            raise AccessDeniedError("У тебя нет прав возвращать разметки на исправление в этой комнате.")
        if not get_task_is_final_stage(task=locked_task):
            raise ConflictError("Вернуть на исправление можно только задачу финального этапа.")

        target_assignment = (
            TaskAssignment.objects.select_for_update()
            .select_related("annotator")
            .filter(
                task=locked_task,
                annotator_id=annotator_id,
                status=TaskAssignment.Status.SUBMITTED,
                round_number=locked_task.current_round,
            )
            .order_by("-submitted_at", "-id")
            .first()
        )
        if target_assignment is None:
            raise ConflictError("У выбранного разметчика нет отправленной разметки для этой задачи.")

        _assert_joined_membership(room=locked_task.room, annotator=target_assignment.annotator)

        if locked_task.status != Task.Status.SUBMITTED or locked_task.consensus_payload is None:
            Annotation.objects.filter(assignment=target_assignment).delete()
            target_assignment.status = TaskAssignment.Status.IN_PROGRESS
            target_assignment.submitted_at = None
            target_assignment.save(update_fields=["status", "submitted_at", "updated_at"])
            locked_task.status = Task.Status.IN_PROGRESS
            locked_task.validation_score = None
            locked_task.consensus_payload = None
            locked_task.save(update_fields=["status", "validation_score", "consensus_payload", "updated_at"])
            return locked_task

        next_round = locked_task.current_round + 1
        locked_task.status = Task.Status.IN_PROGRESS
        locked_task.current_round = next_round
        locked_task.validation_score = None
        locked_task.consensus_payload = None
        locked_task.input_payload = build_task_input_payload_with_revision_target(
            task=locked_task,
            annotator_id=annotator_id,
        )
        locked_task.save(
            update_fields=[
                "status",
                "current_round",
                "validation_score",
                "consensus_payload",
                "input_payload",
                "updated_at",
            ]
        )

        TaskAssignment.objects.create(
            task=locked_task,
            annotator=target_assignment.annotator,
            round_number=next_round,
            status=TaskAssignment.Status.IN_PROGRESS,
            assigned_at=timezone.now(),
        )
        return locked_task
