from django.urls import path

from apps.ui.views import (
    LandingView,
    LoginPageView,
    ProfileView,
    RegisterPageView,
    RoomInviteLandingView,
    RoomCreateView,
    RoomEditView,
    RoomWorkView,
    RoomsView,
    RoomWorkspaceView,
    UserLogoutView,
)


urlpatterns = [
    path("", LandingView.as_view(), name="landing"),
    path("auth/login/", LoginPageView.as_view(), name="ui-login"),
    path("auth/register/", RegisterPageView.as_view(), name="ui-register"),
    path("auth/logout/", UserLogoutView.as_view(), name="ui-logout"),
    path("invite/<uuid:invite_token>/", RoomInviteLandingView.as_view(), name="ui-room-invite"),
    path("rooms/", RoomsView.as_view(), name="ui-rooms"),
    path("rooms/create/", RoomCreateView.as_view(), name="ui-room-create"),
    path("rooms/<int:room_id>/edit/", RoomEditView.as_view(), name="ui-room-edit"),
    path("rooms/<int:room_id>/", RoomWorkspaceView.as_view(), name="ui-room-detail"),
    path("rooms/<int:room_id>/work/", RoomWorkView.as_view(), name="ui-room-work"),
    path("profile/", ProfileView.as_view(), name="ui-profile"),
    path("users/<int:user_id>/profile/", ProfileView.as_view(), name="ui-user-profile"),
]
