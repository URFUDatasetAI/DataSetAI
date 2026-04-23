import random

from apps.labeling.models import Task, TaskAssignment
from apps.labeling.workflows import get_task_revision_target_annotator_id
from apps.rooms.models import Room, RoomMembership


def get_room_assignment_pool_ids(*, room: Room, excluded_annotator_ids: set[int] | None = None) -> list[int]:
    excluded_annotator_ids = excluded_annotator_ids or set()
    membership_annotator_ids = list(
        RoomMembership.objects.filter(
            room=room,
            status=RoomMembership.Status.JOINED,
            role__in=(RoomMembership.Role.ANNOTATOR, RoomMembership.Role.ADMIN),
        )
        .order_by("user_id")
        .values_list("user_id", flat=True)
    )

    ordered_annotator_ids = membership_annotator_ids
    if room.owner_is_annotator:
        ordered_annotator_ids = [room.created_by_id, *ordered_annotator_ids]

    annotator_ids: list[int] = []
    seen_annotator_ids: set[int] = set()
    for annotator_id in ordered_annotator_ids:
        if annotator_id in excluded_annotator_ids or annotator_id in seen_annotator_ids:
            continue
        annotator_ids.append(annotator_id)
        seen_annotator_ids.add(annotator_id)

    if not annotator_ids:
        return []

    rng = random.Random(f"room-assignment-pool:{room.id}")
    shuffled_annotators = list(annotator_ids)
    rng.shuffle(shuffled_annotators)
    return shuffled_annotators


def get_task_assignment_pool_ids(*, task: Task) -> list[int]:
    excluded_annotator_ids = set(task.input_payload.get("excluded_annotator_ids") or [])
    return get_room_assignment_pool_ids(room=task.room, excluded_annotator_ids=excluded_annotator_ids)


def get_effective_reviews_per_item(*, room: Room, assignment_pool_ids: list[int] | None = None) -> int:
    assignment_pool_ids = assignment_pool_ids if assignment_pool_ids is not None else get_room_assignment_pool_ids(room=room)
    if not assignment_pool_ids:
        return 0
    return min(room.required_reviews_per_item, len(assignment_pool_ids))


def get_effective_reviews_for_task(*, task: Task, assignment_pool_ids: list[int] | None = None) -> int:
    assignment_pool_ids = assignment_pool_ids if assignment_pool_ids is not None else get_task_assignment_pool_ids(task=task)
    if not assignment_pool_ids:
        return 0
    return min(task.room.required_reviews_per_item, len(assignment_pool_ids))


def _get_grouped_round_designated_annotator_ids(
    *,
    task: Task,
    current_round_annotator_ids: set[int],
    assignment_pool_ids: list[int],
    reviews_per_round: int,
) -> list[int]:
    """
    For cross-validation we distribute tasks between *groups* of annotators.

    Example:
    - 4 tasks
    - 4 annotators
    - 2 reviews per item

    Annotators are deterministically shuffled once for the room and then split
    into groups of 2. Tasks are distributed between those groups evenly, and
    every member of the selected group annotates the same task.

    If the annotator pool cannot be split into full groups, caller falls back
    to the legacy balanced-per-annotator strategy.
    """
    if reviews_per_round <= 1:
        return []
    if len(assignment_pool_ids) < reviews_per_round:
        return []
    if len(assignment_pool_ids) % reviews_per_round != 0:
        return []

    groups = [
        assignment_pool_ids[index : index + reviews_per_round]
        for index in range(0, len(assignment_pool_ids), reviews_per_round)
    ]
    if not groups:
        return []

    item_number = int(task.input_payload.get("item_number") or task.id or 1)
    item_index = max(item_number - 1, 0)
    group_index = item_index % len(groups)
    designated_group = groups[group_index]
    return [annotator_id for annotator_id in designated_group if annotator_id not in current_round_annotator_ids]


def get_task_designated_annotator_ids(
    *,
    task: Task,
    current_round_annotator_ids: set[int] | None = None,
    assignment_pool_ids: list[int] | None = None,
) -> list[int]:
    current_round_annotator_ids = current_round_annotator_ids or set()
    revision_target_annotator_id = get_task_revision_target_annotator_id(task=task)
    if revision_target_annotator_id is not None:
        if revision_target_annotator_id in current_round_annotator_ids:
            return []
        return [revision_target_annotator_id]

    assignment_pool_ids = assignment_pool_ids if assignment_pool_ids is not None else get_task_assignment_pool_ids(task=task)
    reviews_per_round = get_effective_reviews_for_task(task=task, assignment_pool_ids=assignment_pool_ids)
    if not assignment_pool_ids or reviews_per_round <= 0:
        return []

    if reviews_per_round == 1:
        return [annotator_id for annotator_id in assignment_pool_ids if annotator_id not in current_round_annotator_ids]

    designated_annotator_ids: list[int] = []

    if task.current_round > 1:
        previous_round_annotator_ids = list(
            TaskAssignment.objects.filter(task=task, round_number=task.current_round - 1)
            .order_by("annotator_id")
            .values_list("annotator_id", flat=True)
        )
        assignment_pool_set = set(assignment_pool_ids)
        remaining_slots = max(0, reviews_per_round - len(current_round_annotator_ids))
        for annotator_id in previous_round_annotator_ids:
            if annotator_id not in assignment_pool_set:
                continue
            if annotator_id in current_round_annotator_ids or annotator_id in designated_annotator_ids:
                continue
            designated_annotator_ids.append(annotator_id)
            if len(designated_annotator_ids) >= remaining_slots:
                return designated_annotator_ids[:remaining_slots]

    grouped_round_annotator_ids = _get_grouped_round_designated_annotator_ids(
        task=task,
        current_round_annotator_ids=current_round_annotator_ids,
        assignment_pool_ids=assignment_pool_ids,
        reviews_per_round=reviews_per_round,
    )
    if grouped_round_annotator_ids:
        return grouped_round_annotator_ids

    item_number = int(task.input_payload.get("item_number") or task.id or 1)
    item_index = max(item_number - 1, 0)
    round_offset = (max(task.current_round, 1) - 1) * reviews_per_round
    start_index = ((item_index * reviews_per_round) + round_offset) % len(assignment_pool_ids)

    for offset in range(len(assignment_pool_ids)):
        annotator_id = assignment_pool_ids[(start_index + offset) % len(assignment_pool_ids)]
        if annotator_id in current_round_annotator_ids or annotator_id in designated_annotator_ids:
            continue
        designated_annotator_ids.append(annotator_id)
        if len(designated_annotator_ids) >= reviews_per_round:
            break

    return designated_annotator_ids
