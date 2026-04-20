import json
import tempfile
from pathlib import Path

from django.conf import settings
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.labeling.models import Task
from apps.rooms.models import Room, RoomMembership, RoomPin, RoomVisit
from apps.users.models import User


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class RoomListCreateViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(email="owner@example.com", full_name="Owner", password="secret123")
        self.client.force_authenticate(self.user)

    def tearDown(self):
        media_root = Path(settings.MEDIA_ROOT)
        if media_root.exists():
            for path in sorted(media_root.rglob("*"), reverse=True):
                if path.is_file():
                    path.unlink()
                elif path.is_dir():
                    path.rmdir()
            media_root.rmdir()

    def test_multipart_request_with_dataset_files_creates_image_room(self):
        response = self.client.post(
            "/api/v1/rooms/",
            data={
                "title": "Vision room",
                "dataset_mode": Room.DatasetType.IMAGE,
                "labels": json.dumps([{"name": "Car", "color": "#FF0000"}]),
                "media_manifest": json.dumps([{"name": "sample.png", "width": 100, "height": 50}]),
                "dataset_files": [self._uploaded_file("sample.png")],
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        room = Room.objects.get(title="Vision room")
        self.assertEqual(room.dataset_type, Room.DatasetType.IMAGE)
        self.assertEqual(room.labels.count(), 1)
        self.assertEqual(room.tasks.count(), 1)
        task = Task.objects.get(room=room)
        self.assertEqual(task.source_name, "sample.png")
        self.assertEqual(task.input_payload["width"], 100)
        self.assertEqual(task.input_payload["height"], 50)

    def test_multipart_request_with_single_annotator_id_creates_membership(self):
        annotator = User.objects.create_user(email="annotator@example.com", full_name="Annotator", password="secret123")

        response = self.client.post(
            "/api/v1/rooms/",
            data={
                "title": "Demo room",
                "dataset_mode": Room.DatasetType.DEMO,
                "annotator_ids": [str(annotator.id)],
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        room = Room.objects.get(title="Demo room")
        membership = RoomMembership.objects.get(room=room, user=annotator)
        self.assertEqual(membership.status, RoomMembership.Status.INVITED)

    def test_owner_can_delete_room(self):
        room = Room.objects.create(title="Delete me", created_by=self.user)

        response = self.client.delete(
            f"/api/v1/rooms/{room.id}/",
            data={"password": "secret123"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Room.objects.filter(id=room.id).exists())

    def test_owner_cannot_delete_room_without_valid_password(self):
        room = Room.objects.create(title="Delete me", created_by=self.user)

        response = self.client.delete(
            f"/api/v1/rooms/{room.id}/",
            data={"password": "wrong-password"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(Room.objects.filter(id=room.id).exists())

    def test_owner_can_update_room_settings(self):
        room = Room.objects.create(
            title="Original room",
            description="Old description",
            dataset_label="Old dataset",
            created_by=self.user,
        )
        room.set_access_password("old-secret")
        room.save(update_fields=["access_password_hash", "updated_at"])

        response = self.client.patch(
            f"/api/v1/rooms/{room.id}/",
            data={
                "title": "Updated room",
                "description": "Fresh description",
                "dataset_label": "Vision batch",
                "deadline": "2026-05-01T09:30:00Z",
                "has_password": True,
                "password": "new-secret",
                "cross_validation_enabled": True,
                "cross_validation_annotators_count": 2,
                "cross_validation_similarity_threshold": 91,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        room.refresh_from_db()
        self.assertEqual(room.title, "Updated room")
        self.assertEqual(room.description, "Fresh description")
        self.assertEqual(room.dataset_label, "Vision batch")
        self.assertTrue(room.cross_validation_enabled)
        self.assertEqual(room.cross_validation_annotators_count, 2)
        self.assertEqual(room.cross_validation_similarity_threshold, 91)
        self.assertTrue(room.check_access_password("new-secret"))

    def test_owner_can_disable_room_password(self):
        room = Room.objects.create(title="Protected room", created_by=self.user)
        room.set_access_password("top-secret")
        room.save(update_fields=["access_password_hash", "updated_at"])

        response = self.client.patch(
            f"/api/v1/rooms/{room.id}/",
            data={"has_password": False},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        room.refresh_from_db()
        self.assertFalse(room.has_password)
        self.assertTrue(room.check_access_password(""))

    def test_owner_can_remove_room_member(self):
        room = Room.objects.create(title="Review room", created_by=self.user)
        annotator = User.objects.create_user(email="annotator@example.com", full_name="Annotator", password="secret123")
        RoomMembership.objects.create(
            room=room,
            user=annotator,
            invited_by=self.user,
            status=RoomMembership.Status.JOINED,
            role=RoomMembership.Role.ANNOTATOR,
        )

        response = self.client.delete(f"/api/v1/rooms/{room.id}/memberships/{annotator.id}/")

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(RoomMembership.objects.filter(room=room, user=annotator).exists())

    def test_owner_cannot_remove_self_from_room(self):
        room = Room.objects.create(title="Review room", created_by=self.user)

        response = self.client.delete(f"/api/v1/rooms/{room.id}/memberships/{self.user.id}/")

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_non_owner_cannot_update_room_settings(self):
        outsider = User.objects.create_user(email="outsider@example.com", full_name="Outsider", password="secret123")
        room = Room.objects.create(title="Owner room", created_by=self.user)

        self.client.force_authenticate(outsider)
        response = self.client.patch(
            f"/api/v1/rooms/{room.id}/",
            data={"title": "Should not work"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        room.refresh_from_db()
        self.assertEqual(room.title, "Owner room")

    def test_cross_validation_update_requires_at_least_two_annotators(self):
        room = Room.objects.create(title="Review room", created_by=self.user)

        response = self.client.patch(
            f"/api/v1/rooms/{room.id}/",
            data={
                "cross_validation_enabled": True,
                "cross_validation_annotators_count": 1,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("cross_validation_annotators_count", response.data)

    def test_create_room_rejects_too_long_description(self):
        response = self.client.post(
            "/api/v1/rooms/",
            data={
                "title": "Room with oversized description",
                "description": "x" * 2001,
                "dataset_mode": Room.DatasetType.DEMO,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("description", response.data)

    def test_update_room_rejects_too_long_dataset_label(self):
        room = Room.objects.create(title="Update target", created_by=self.user)

        response = self.client.patch(
            f"/api/v1/rooms/{room.id}/",
            data={
                "title": "Updated title",
                "dataset_label": "x" * 256,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("dataset_label", response.data)

    def test_create_room_rejects_past_deadline(self):
        response = self.client.post(
            "/api/v1/rooms/",
            data={
                "title": "Past deadline room",
                "dataset_mode": Room.DatasetType.DEMO,
                "deadline": (timezone.now() - timezone.timedelta(hours=1)).isoformat(),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("deadline", response.data)

    def test_user_cannot_pin_more_than_five_rooms(self):
        rooms = [Room.objects.create(title=f"Room {index}", created_by=self.user) for index in range(6)]
        for room in rooms[:5]:
            response = self.client.post(
                f"/api/v1/rooms/{room.id}/pin/",
                data={"is_pinned": True},
                format="json",
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK)

        response = self.client.post(
            f"/api/v1/rooms/{rooms[5].id}/pin/",
            data={"is_pinned": True},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(RoomPin.objects.filter(user=self.user).count(), 5)

    def test_user_can_reorder_pinned_rooms(self):
        first = Room.objects.create(title="First", created_by=self.user)
        second = Room.objects.create(title="Second", created_by=self.user)
        self.client.post(f"/api/v1/rooms/{first.id}/pin/", data={"is_pinned": True}, format="json")
        self.client.post(f"/api/v1/rooms/{second.id}/pin/", data={"is_pinned": True}, format="json")

        response = self.client.post(
            f"/api/v1/rooms/{second.id}/pin/reorder/",
            data={"direction": "up"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ordered_ids = list(RoomPin.objects.filter(user=self.user).order_by("sort_order", "id").values_list("room_id", flat=True))
        self.assertEqual(ordered_ids, [second.id, first.id])

    def test_rooms_are_sorted_by_last_access_for_unpinned_items(self):
        first = Room.objects.create(title="First", created_by=self.user)
        second = Room.objects.create(title="Second", created_by=self.user)
        RoomVisit.objects.create(room=first, user=self.user, last_accessed_at=timezone.now() - timezone.timedelta(days=1))
        RoomVisit.objects.create(room=second, user=self.user, last_accessed_at=timezone.now())

        response = self.client.get("/api/v1/rooms/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([item["id"] for item in response.data[:2]], [second.id, first.id])

    def test_update_room_rejects_too_distant_deadline(self):
        room = Room.objects.create(title="Far future room", created_by=self.user)

        response = self.client.patch(
            f"/api/v1/rooms/{room.id}/",
            data={
                "deadline": (timezone.now() + timezone.timedelta(days=366)).isoformat(),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("deadline", response.data)

    @staticmethod
    def _uploaded_file(name: str):
        from django.core.files.uploadedfile import SimpleUploadedFile

        return SimpleUploadedFile(name, b"fake-image-bytes", content_type="image/png")
