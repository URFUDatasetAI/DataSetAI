from collections import Counter
from datetime import timedelta

from django.db.models import Exists, OuterRef, QuerySet
from django.utils import timezone

from apps.labeling.models import Annotation, Task, TaskAssignment
from apps.labeling.workflows import get_room_final_tasks_queryset, get_room_primary_tasks_queryset

from apps.rooms.models import Room, RoomMembership, RoomPin
from apps.rooms.policies import (
    can_annotate_room,
    can_assign_room_roles,
    can_delete_room,
    can_export_room,
    can_invite_members,
    can_manage_room,
    can_review_room,
    get_room_actor_role,
    get_room_membership,
)
from apps.rooms.services import get_supported_export_formats
from apps.users.models import User
from common.exceptions import NotFoundError

"""
Read-model helpers for the rooms domain.

Convention in this project:
- selectors only read/query/shape data
- services mutate state and enforce write-side business rules
- API views should stay thin and delegate to selectors/services
"""


def list_owned_rooms(*, user: User) -> QuerySet[Room]:
    pinned_subquery = RoomPin.objects.filter(room_id=OuterRef("pk"), user=user)
    return (
        Room.objects.filter(created_by=user)
        .annotate(is_pinned=Exists(pinned_subquery))
        .select_related("created_by")
        .prefetch_related("tasks", "memberships", "labels")
        .order_by("-is_pinned", "-created_at", "-id")
    )


def list_member_rooms(*, user: User) -> QuerySet[Room]:
    pinned_subquery = RoomPin.objects.filter(room_id=OuterRef("pk"), user=user)
    return (
        Room.objects.filter(memberships__user=user)
        .annotate(is_pinned=Exists(pinned_subquery))
        .select_related("created_by")
        .prefetch_related("memberships", "tasks", "labels")
        .distinct()
        .order_by("-is_pinned", "-created_at", "-id")
    )


def get_room_for_owner(*, room_id: int, owner: User) -> Room:
    try:
        return Room.objects.select_related("created_by").get(id=room_id, created_by=owner)
    except Room.DoesNotExist as exc:
        raise NotFoundError("Room not found.") from exc


def get_room_by_id(*, room_id: int) -> Room:
    try:
        return Room.objects.select_related("created_by").prefetch_related("memberships", "labels").get(id=room_id)
    except Room.DoesNotExist as exc:
        raise NotFoundError("Room not found.") from exc


def get_visible_room(*, room_id: int, user: User) -> Room:
    # Hidden rooms intentionally resolve to 404 instead of 403 so the caller
    # cannot distinguish "exists but forbidden" from "does not exist".
    room = get_room_by_id(room_id=room_id)
    if room.created_by_id == user.id:
        return room
    if room.memberships.filter(user=user).exists():
        return room
    raise NotFoundError("Room not found.")


def get_membership(*, room: Room, user: User) -> RoomMembership:
    try:
        return RoomMembership.objects.select_related("room", "user", "invited_by").get(room=room, user=user)
    except RoomMembership.DoesNotExist as exc:
        raise NotFoundError("Membership not found for this room.") from exc


def build_activity_series(*, annotations_qs, days: int = 49) -> list[dict]:
    end_date = timezone.localdate()
    start_date = end_date - timedelta(days=days - 1)
    activity_dates = annotations_qs.filter(submitted_at__date__gte=start_date).values_list("submitted_at__date", flat=True)
    counts = Counter(activity_dates)

    return [
        {
            "date": current_date.isoformat(),
            "count": counts.get(current_date, 0),
        }
        for current_date in (start_date + timedelta(days=offset) for offset in range(days))
    ]


def _count_completed_items_for_user(*, room: Room, user: User) -> int:
    completed_pairs = (
        Task.objects.filter(room=room, annotations__annotator=user)
        .order_by()
        .values_list("id", "parent_task_id")
        .distinct()
    )
    root_task_ids = {parent_task_id or task_id for task_id, parent_task_id in completed_pairs}
    return len(root_task_ids)


def build_room_dashboard(*, room: Room, actor: User) -> dict:
    # Dashboard payload is intentionally assembled here instead of serializers:
    # it mixes room metadata, aggregate stats and actor-specific slices.
    total_tasks = get_room_primary_tasks_queryset(room=room).count()
    completed_tasks = get_room_final_tasks_queryset(room=room).filter(status=Task.Status.SUBMITTED).count()
    remaining_tasks = max(total_tasks - completed_tasks, 0)
    progress_percent = round((completed_tasks / total_tasks) * 100, 1) if total_tasks else 0.0

    overview = {
        "total_tasks": total_tasks,
        "completed_tasks": completed_tasks,
        "remaining_tasks": remaining_tasks,
        "progress_percent": progress_percent,
    }

    actor_membership = get_room_membership(room=room, user=actor)
    actor_membership_status = actor_membership.status if actor_membership else None
    actor_room_role = get_room_actor_role(room=room, user=actor, membership=actor_membership) or RoomMembership.Role.ANNOTATOR
    actor_can_manage = can_manage_room(room=room, user=actor, membership=actor_membership)
    actor_can_review = can_review_room(room=room, user=actor, membership=actor_membership)
    actor_can_annotate = can_annotate_room(room=room, user=actor, membership=actor_membership)

    payload = {
        "room": {
            "id": room.id,
            "title": room.title,
            "description": room.description,
            "dataset_label": room.dataset_label,
            "dataset_type": room.dataset_type,
            "annotation_workflow": room.annotation_workflow,
            "cross_validation_enabled": room.cross_validation_enabled,
            "cross_validation_annotators_count": room.cross_validation_annotators_count,
            "cross_validation_similarity_threshold": room.cross_validation_similarity_threshold,
            "deadline": room.deadline.isoformat() if room.deadline else None,
            "has_password": room.has_password,
            "is_pinned": RoomPin.objects.filter(room=room, user=actor).exists(),
            "created_by_id": room.created_by_id,
            "membership_status": "owner" if room.created_by_id == actor.id else actor_membership_status,
            "membership_role": actor_room_role,
        },
        "labels": [
            {
                "id": label.id,
                "name": label.name,
                "color": label.color,
                "sort_order": label.sort_order,
            }
            for label in room.labels.all()
        ],
        "export_formats": get_supported_export_formats(room=room),
        "overview": overview,
        "membership_role_options": [
            {"value": RoomMembership.Role.ANNOTATOR, "label": "Исполнитель"},
            {"value": RoomMembership.Role.ADMIN, "label": "Админ"},
            {"value": RoomMembership.Role.TESTER, "label": "Тестировщик"},
        ],
        "actor": {
            "id": actor.id,
            "username": actor.username,
            "role": actor_room_role,
            "can_manage": actor_can_manage,
            "can_review": actor_can_review,
            "can_annotate": actor_can_annotate,
            "can_invite": can_invite_members(room=room, user=actor, membership=actor_membership),
            "can_assign_roles": can_assign_room_roles(room=room, user=actor),
            "can_export": can_export_room(room=room, user=actor),
            "can_delete_room": can_delete_room(room=room, user=actor),
        },
    }

    if actor_can_annotate:
        actor_completed = _count_completed_items_for_user(room=room, user=actor)
        actor_in_progress = TaskAssignment.objects.filter(
            task__room=room,
            annotator=actor,
            status=TaskAssignment.Status.IN_PROGRESS,
        ).count()
        actor_remaining = max(total_tasks - actor_completed, 0)
        actor_progress = round((actor_completed / total_tasks) * 100, 1) if total_tasks else 0.0
        activity = build_activity_series(
            annotations_qs=Annotation.objects.filter(task__room=room, annotator=actor),
        )

        payload["annotator_stats"] = {
            "completed_tasks": actor_completed,
            "in_progress_tasks": actor_in_progress,
            "remaining_tasks": actor_remaining,
            "progress_percent": actor_progress,
            "activity": activity,
        }
        if not (actor_can_manage or actor_can_review):
            return payload

    annotators = []
    memberships = RoomMembership.objects.filter(room=room).select_related("user").order_by("user__username")
    for membership in memberships:
        user = membership.user
        user_completed = _count_completed_items_for_user(room=room, user=user)
        user_in_progress = TaskAssignment.objects.filter(
            task__room=room,
            annotator=user,
            status=TaskAssignment.Status.IN_PROGRESS,
        ).count()
        user_remaining = max(total_tasks - user_completed, 0)
        user_progress = round((user_completed / total_tasks) * 100, 1) if total_tasks else 0.0

        annotators.append(
            {
                "user_id": user.id,
                "username": user.username,
                "status": membership.status,
                "role": membership.role,
                "joined_at": membership.joined_at.isoformat() if membership.joined_at else None,
                "completed_tasks": user_completed,
                "in_progress_tasks": user_in_progress,
                "remaining_tasks": user_remaining,
                "progress_percent": user_progress,
                "activity": build_activity_series(
                    annotations_qs=Annotation.objects.filter(task__room=room, annotator=user),
                ),
            }
        )

    payload["annotators"] = annotators
    return payload
