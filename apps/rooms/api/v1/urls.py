from django.urls import path

from apps.rooms.api.v1.views import (
    MyRoomListView,
    RoomAccessView,
    RoomDashboardView,
    RoomDetailView,
    RoomInviteLinkView,
    RoomInviteView,
    RoomInviteRegenerateView,
    RoomJoinView,
    RoomJoinRequestApproveView,
    RoomJoinRequestCreateView,
    RoomJoinRequestRejectView,
    RoomListCreateView,
    RoomMembershipRoleView,
    RoomMembershipDeleteView,
    RoomPinView,
    RoomExportView,
)


urlpatterns = [
    path("rooms/", RoomListCreateView.as_view(), name="room-list-create"),
    path("rooms/access/", RoomAccessView.as_view(), name="room-access"),
    path("rooms/invite/<str:invite_token>/", RoomInviteLinkView.as_view(), name="room-invite-preview"),
    path("rooms/invite/<str:invite_token>/request/", RoomJoinRequestCreateView.as_view(), name="room-invite-request"),
    path("rooms/<int:room_id>/", RoomDetailView.as_view(), name="room-detail"),
    path("rooms/<int:room_id>/dashboard/", RoomDashboardView.as_view(), name="room-dashboard"),
    path("rooms/<int:room_id>/invite/", RoomInviteView.as_view(), name="room-invite"),
    path("rooms/<int:room_id>/invite/regenerate/", RoomInviteRegenerateView.as_view(), name="room-invite-regenerate"),
    path(
        "rooms/<int:room_id>/join-requests/<int:join_request_id>/approve/",
        RoomJoinRequestApproveView.as_view(),
        name="room-join-request-approve",
    ),
    path(
        "rooms/<int:room_id>/join-requests/<int:join_request_id>/reject/",
        RoomJoinRequestRejectView.as_view(),
        name="room-join-request-reject",
    ),
    path("rooms/<int:room_id>/memberships/<int:user_id>/role/", RoomMembershipRoleView.as_view(), name="room-membership-role"),
    path("rooms/<int:room_id>/memberships/<int:user_id>/", RoomMembershipDeleteView.as_view(), name="room-membership-delete"),
    path("rooms/<int:room_id>/pin/", RoomPinView.as_view(), name="room-pin"),
    path("rooms/<int:room_id>/export/", RoomExportView.as_view(), name="room-export"),
    path("me/rooms/", MyRoomListView.as_view(), name="my-rooms"),
    path("rooms/<int:room_id>/join/", RoomJoinView.as_view(), name="room-join"),
]
