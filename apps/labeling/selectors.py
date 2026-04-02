from apps.labeling.models import Task
from apps.rooms.policies import can_review_room
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
    return task
