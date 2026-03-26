from django.urls import path

from apps.users.api.v1.views import MyProfileView


urlpatterns = [
    path("me/profile/", MyProfileView.as_view(), name="my-profile"),
]
