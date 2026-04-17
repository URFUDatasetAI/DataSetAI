from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from tests.factories import make_user


class UsersApiTests(APITestCase):
    def setUp(self):
        self.user = make_user(username="profile_user", full_name="Profile User")

    def auth(self, user):
        return {"HTTP_X_USER_ID": str(user.id)}

    def test_user_can_update_own_profile(self):
        response = self.client.patch(
            reverse("my-profile"),
            {
                "full_name": "Updated Profile User",
                "email": "updated.profile@example.com",
            },
            format="json",
            **self.auth(self.user),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertEqual(self.user.full_name, "Updated Profile User")
        self.assertEqual(self.user.email, "updated.profile@example.com")
        self.assertEqual(response.data["display_name"], "Updated Profile User")
