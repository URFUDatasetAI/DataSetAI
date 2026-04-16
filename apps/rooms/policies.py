from apps.rooms.models import Room, RoomMembership
from apps.users.models import User


def get_room_membership(*, room: Room, user: User) -> RoomMembership | None:
    if room.created_by_id == user.id:
        return None
    return room.memberships.filter(user=user).first()


def is_room_owner(*, room: Room, user: User) -> bool:
    return room.created_by_id == user.id


def is_joined_member(*, room: Room, user: User, membership: RoomMembership | None = None) -> bool:
    membership = membership if membership is not None else get_room_membership(room=room, user=user)
    return bool(membership and membership.status == RoomMembership.Status.JOINED)


def get_room_actor_role(*, room: Room, user: User, membership: RoomMembership | None = None) -> str | None:
    if is_room_owner(room=room, user=user):
        return "owner"
    membership = membership if membership is not None else get_room_membership(room=room, user=user)
    return membership.role if membership else None


def can_annotate_room(*, room: Room, user: User, membership: RoomMembership | None = None) -> bool:
    if is_room_owner(room=room, user=user):
        return True
    membership = membership if membership is not None else get_room_membership(room=room, user=user)
    return bool(
        membership
        and membership.status == RoomMembership.Status.JOINED
        and membership.role in (RoomMembership.Role.ANNOTATOR, RoomMembership.Role.ADMIN)
    )


def can_manage_room(*, room: Room, user: User, membership: RoomMembership | None = None) -> bool:
    if is_room_owner(room=room, user=user):
        return True
    membership = membership if membership is not None else get_room_membership(room=room, user=user)
    return bool(
        membership
        and membership.status == RoomMembership.Status.JOINED
        and membership.role == RoomMembership.Role.ADMIN
    )


def can_review_room(*, room: Room, user: User, membership: RoomMembership | None = None) -> bool:
    if is_room_owner(room=room, user=user):
        return True
    membership = membership if membership is not None else get_room_membership(room=room, user=user)
    return bool(
        membership
        and membership.status == RoomMembership.Status.JOINED
        and membership.role in (RoomMembership.Role.ADMIN, RoomMembership.Role.TESTER)
    )


def can_invite_members(*, room: Room, user: User, membership: RoomMembership | None = None) -> bool:
    return is_room_owner(room=room, user=user) or can_manage_room(room=room, user=user, membership=membership)


def can_assign_room_roles(*, room: Room, user: User) -> bool:
    return is_room_owner(room=room, user=user)


def can_export_room(*, room: Room, user: User) -> bool:
    return is_room_owner(room=room, user=user)


def can_edit_room(*, room: Room, user: User) -> bool:
    return is_room_owner(room=room, user=user)


def can_delete_room(*, room: Room, user: User) -> bool:
    return is_room_owner(room=room, user=user)
