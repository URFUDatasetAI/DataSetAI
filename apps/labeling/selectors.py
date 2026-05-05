from django.db.models import F

from apps.labeling.distribution import get_effective_reviews_for_task, get_task_assignment_pool_ids
from apps.labeling.models import Annotation, Task, TaskAssignment, ValidationVote
from apps.labeling.workflows import get_task_is_final_stage
from apps.rooms.policies import can_annotate_room, can_review_room, get_room_membership
from common.exceptions import NotFoundError
from common.exceptions import AccessDeniedError

"""Read helpers for the labeling domain."""


REVIEW_FILTER_FINAL = "final"
REVIEW_FILTER_INCOMPLETE = "incomplete"
REVIEW_FILTER_VALIDATION = "validation"
REVIEW_FILTER_VALUES = (REVIEW_FILTER_VALIDATION, REVIEW_FILTER_FINAL, REVIEW_FILTER_INCOMPLETE)


def get_task_or_404(*, task_id: int) -> Task:
    try:
        return Task.objects.select_related("room").get(id=task_id)
    except Task.DoesNotExist as exc:
        raise NotFoundError("Task not found.") from exc


def get_task_for_owner_review(*, task_id: int, owner) -> Task:
    task = get_task_or_404(task_id=task_id)
    if task.room.created_by_id != owner.id:
        raise NotFoundError("Task not found.")
    return task


def get_task_for_review(*, task_id: int, reviewer) -> Task:
    task = get_task_or_404(task_id=task_id)
    if not can_review_room(room=task.room, user=reviewer):
        raise AccessDeniedError("You do not have permission to review tasks in this room.")
    if not get_task_is_final_stage(task=task):
        raise NotFoundError("Task not found.")
    return task


def get_task_current_round_review_counts(*, task: Task) -> dict:
    round_assignments = list(
        TaskAssignment.objects.filter(task=task, round_number=task.current_round).order_by("id")
    )
    submitted_count = sum(
        1
        for assignment in round_assignments
        if assignment.status == TaskAssignment.Status.SUBMITTED
    )
    skipped_annotator_ids = {
        assignment.annotator_id
        for assignment in round_assignments
        if assignment.status == TaskAssignment.Status.SKIPPED
    }
    assignment_pool_ids = [
        annotator_id
        for annotator_id in get_task_assignment_pool_ids(task=task)
        if annotator_id not in skipped_annotator_ids
    ]
    required_count = get_effective_reviews_for_task(
        task=task,
        assignment_pool_ids=assignment_pool_ids,
    )
    return {
        "submitted_annotations_count": submitted_count,
        "required_annotations_count": required_count,
    }


def task_has_reviewable_submitted_annotations(*, task: Task) -> bool:
    return Annotation.objects.filter(
        task=task,
        assignment__status=TaskAssignment.Status.SUBMITTED,
    ).exists()


def task_has_current_round_review_annotations(*, task: Task) -> bool:
    return Annotation.objects.filter(
        task=task,
        assignment__round_number=task.current_round,
        assignment__status=TaskAssignment.Status.SUBMITTED,
    ).exists()


def get_task_review_state(*, task: Task) -> str:
    if task.status == Task.Status.IN_REVIEW and task.consensus_payload is not None:
        return REVIEW_FILTER_VALIDATION

    if task.status == Task.Status.SUBMITTED and task.consensus_payload is not None:
        return REVIEW_FILTER_FINAL

    counts = get_task_current_round_review_counts(task=task)
    if counts["submitted_annotations_count"] > 0:
        return REVIEW_FILTER_INCOMPLETE

    if task.status == Task.Status.PENDING and task_has_reviewable_submitted_annotations(task=task):
        return REVIEW_FILTER_FINAL

    return "pending"


def get_task_review_outcome(*, task: Task) -> str:
    review_state = get_task_review_state(task=task)
    if review_state == REVIEW_FILTER_VALIDATION:
        return "validation"
    if task.status == Task.Status.SUBMITTED and task.consensus_payload is not None:
        return "accepted"
    if review_state == REVIEW_FILTER_FINAL:
        return "rejected"
    if review_state == REVIEW_FILTER_INCOMPLETE:
        return "incomplete"
    return "pending"


def get_task_review_round_number(*, task: Task) -> int | None:
    if task_has_current_round_review_annotations(task=task):
        return task.current_round
    return (
        Annotation.objects.filter(
            task=task,
            assignment__status=TaskAssignment.Status.SUBMITTED,
        )
        .order_by("-assignment__round_number", "-submitted_at", "-id")
        .values_list("assignment__round_number", flat=True)
        .first()
    )


def get_task_review_counts(*, task: Task) -> dict:
    counts = get_task_current_round_review_counts(task=task)
    review_round_number = get_task_review_round_number(task=task)
    if review_round_number is None or review_round_number == task.current_round:
        return {
            **counts,
            "review_round_number": review_round_number or task.current_round,
        }

    return {
        **counts,
        "review_round_number": review_round_number,
        "submitted_annotations_count": Annotation.objects.filter(
            task=task,
            assignment__round_number=review_round_number,
            assignment__status=TaskAssignment.Status.SUBMITTED,
        ).count(),
    }


def get_task_review_annotations(*, task: Task):
    review_round_number = get_task_review_round_number(task=task)
    if review_round_number is None:
        return Annotation.objects.none()

    return (
        Annotation.objects.select_related("annotator", "assignment")
        .filter(
            task=task,
            assignment__round_number=review_round_number,
            assignment__status=TaskAssignment.Status.SUBMITTED,
        )
        .order_by("-submitted_at", "-id")
    )


def get_task_validation_vote_summary(*, task: Task, reviewer=None) -> dict:
    votes = list(
        ValidationVote.objects.select_related("voter")
        .filter(task=task, round_number=task.current_round)
        .order_by("created_at", "id")
    )
    approve_count = sum(1 for vote in votes if vote.decision == ValidationVote.Decision.APPROVE)
    reject_count = sum(1 for vote in votes if vote.decision == ValidationVote.Decision.REJECT)
    actor_vote = None
    if reviewer is not None:
        actor_vote = next((vote for vote in votes if vote.voter_id == reviewer.id), None)

    actor_has_current_annotation = False
    if reviewer is not None:
        actor_has_current_annotation = Annotation.objects.filter(
            task=task,
            annotator=reviewer,
            assignment__round_number=task.current_round,
            assignment__status=TaskAssignment.Status.SUBMITTED,
        ).exists()

    can_vote = bool(
        reviewer is not None
        and task.status == Task.Status.IN_REVIEW
        and task.consensus_payload is not None
        and not actor_has_current_annotation
        and can_review_room(room=task.room, user=reviewer)
    )

    return {
        "validation_votes_required": task.room.review_votes_required,
        "validation_acceptance_threshold": task.room.review_acceptance_threshold,
        "validation_votes_count": len(votes),
        "validation_approve_votes_count": approve_count,
        "validation_reject_votes_count": reject_count,
        "actor_validation_vote": actor_vote.decision if actor_vote else None,
        "can_vote": can_vote,
    }


def get_current_submitted_assignment_for_annotator(*, task_id: int, annotator) -> TaskAssignment:
    try:
        assignment = (
            TaskAssignment.objects.select_related("task__room", "annotation", "annotator")
            .get(
            task_id=task_id,
            annotator=annotator,
            annotation__isnull=False,
            status=TaskAssignment.Status.SUBMITTED,
            round_number=F("task__current_round"),
        )
        )
    except TaskAssignment.DoesNotExist as exc:
        raise NotFoundError("Submitted annotation not found.") from exc

    membership = get_room_membership(room=assignment.task.room, user=annotator)
    if not can_annotate_room(room=assignment.task.room, user=annotator, membership=membership):
        raise AccessDeniedError("You do not have permission to edit annotations in this room.")
    return assignment


def list_current_submitted_assignments_for_annotator(*, room, annotator):
    membership = get_room_membership(room=room, user=annotator)
    if not can_annotate_room(room=room, user=annotator, membership=membership):
        raise AccessDeniedError("You do not have permission to edit annotations in this room.")

    return (
        TaskAssignment.objects.select_related("task__room", "annotation", "annotator")
        .filter(
            task__room=room,
            annotator=annotator,
            annotation__isnull=False,
            status=TaskAssignment.Status.SUBMITTED,
            round_number=F("task__current_round"),
        )
        .order_by("-submitted_at", "-id")
    )
