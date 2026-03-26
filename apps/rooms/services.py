from itertools import cycle

from django.db import transaction
from django.utils import timezone

from apps.labeling.models import Task
from apps.rooms.models import Room, RoomMembership
from apps.users.models import User
from common.exceptions import AccessDeniedError, ConflictError, NotFoundError


DEMO_DATASET_SAMPLES = [
    "Пользователь оставил положительный отзыв о качестве сервиса.",
    "Нужно определить тематику короткого сообщения из поддержки.",
    "Определи тональность комментария под товаром.",
    "Классифицируй новостной заголовок по теме публикации.",
    "Отметь, содержит ли текст токсичную лексику.",
    "Определи язык сообщения в пользовательском фидбэке.",
    "Разметь интент обращения клиента в поддержку.",
    "Определи, относится ли сообщение к жалобе или благодарности.",
]


def create_room(
    *,
    creator: User,
    title: str,
    description: str = "",
    password: str = "",
    deadline=None,
    annotator_ids: list[int] | None = None,
    dataset_mode: str = "demo",
    test_task_count: int = 12,
    dataset_label: str = "",
) -> Room:
    normalized_label = dataset_label or "Тестовый датасет"
    unique_annotator_ids = list(dict.fromkeys(annotator_ids or []))

    with transaction.atomic():
        room = Room(
            title=title,
            description=description,
            created_by=creator,
            deadline=deadline,
            dataset_label=normalized_label,
        )
        room.set_access_password(password)
        room.save()

        if dataset_mode == "demo":
            _create_demo_tasks(room=room, task_count=test_task_count, dataset_label=normalized_label)

        for annotator_id in unique_annotator_ids:
            invite_user_to_room(room=room, inviter=creator, invited_user_id=annotator_id)

        return room


def invite_user_to_room(*, room: Room, inviter: User, invited_user_id: int) -> RoomMembership:
    if room.created_by_id != inviter.id:
        raise AccessDeniedError("Only the room owner can invite participants.")

    try:
        invited_user = User.objects.get(id=invited_user_id)
    except User.DoesNotExist as exc:
        raise NotFoundError("Invited user not found.") from exc

    if invited_user.id == room.created_by_id:
        raise ConflictError("Room owner already has access to this room.")

    membership, created = RoomMembership.objects.get_or_create(
        room=room,
        user=invited_user,
        defaults={
            "invited_by": inviter,
            "status": RoomMembership.Status.INVITED,
        },
    )

    if not created and membership.status == RoomMembership.Status.INVITED:
        membership.invited_by = inviter
        membership.save(update_fields=["invited_by", "updated_at"])

    return membership


def validate_room_password(*, room: Room, password: str = "") -> None:
    if not room.check_access_password(password):
        raise AccessDeniedError("Incorrect room password.")


def join_room(*, room: Room, annotator: User, password: str | None = None) -> RoomMembership:
    if password is not None:
        validate_room_password(room=room, password=password)

    membership, _ = RoomMembership.objects.get_or_create(
        room=room,
        user=annotator,
        defaults={
            "invited_by": room.created_by,
            "status": RoomMembership.Status.JOINED,
            "joined_at": timezone.now(),
        },
    )

    if membership.status != RoomMembership.Status.JOINED or membership.joined_at is None:
        membership.status = RoomMembership.Status.JOINED
        membership.joined_at = timezone.now()
        membership.save(update_fields=["status", "joined_at", "updated_at"])

    return membership


def _create_demo_tasks(*, room: Room, task_count: int, dataset_label: str) -> None:
    sample_iterator = cycle(DEMO_DATASET_SAMPLES)
    tasks = []
    for index in range(task_count):
        tasks.append(
            Task(
                room=room,
                input_payload={
                    "dataset": dataset_label,
                    "item_number": index + 1,
                    "text": next(sample_iterator),
                },
            )
        )

    Task.objects.bulk_create(tasks)
