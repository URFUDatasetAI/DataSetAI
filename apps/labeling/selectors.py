from django.db.models import F

from apps.labeling.models import Task, TaskAssignment
from apps.labeling.workflows import get_task_is_final_stage
from apps.rooms.policies import can_annotate_room, can_review_room, get_room_membership
from common.exceptions import NotFoundError
from common.exceptions import AccessDeniedError

"""Read helpers for the labeling domain."""


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
