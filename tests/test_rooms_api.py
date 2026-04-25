import io
import json
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.labeling.models import Annotation, Task, TaskAssignment
from apps.rooms.models import RoomAssignmentQuota, RoomMembership, RoomPin
from apps.users.models import User
from tests.factories import invite_annotator, make_room, make_task, make_user


class RoomsApiTests(APITestCase):
    def setUp(self):
        self.media_dir = tempfile.TemporaryDirectory()
        self.override = override_settings(MEDIA_ROOT=self.media_dir.name)
        self.override.enable()
        self.addCleanup(self.override.disable)
        self.addCleanup(self.media_dir.cleanup)
        self.customer = make_user(username="customer", full_name="Customer")
        self.annotator = make_user(username="annotator", full_name="Annotator")
        self.other_annotator = make_user(username="annotator2", full_name="Annotator 2")
        self.admin_user = make_user(username="roomadmin", full_name="Room Admin")
        self.tester_user = make_user(username="roomtester", full_name="Room Tester")

    def auth(self, user):
        return {"HTTP_X_USER_ID": str(user.id)}

    def make_zip_upload(self, name: str, files: dict[str, bytes]):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            for file_name, content in files.items():
                archive.writestr(file_name, content)
        return SimpleUploadedFile(name, buffer.getvalue(), content_type="application/zip")

    def test_customer_can_create_room(self):
        response = self.client.post(
            reverse("room-list-create"),
            {"title": "New room", "description": "MVP room"},
            format="json",
            **self.auth(self.customer),
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["title"], "New room")
        self.assertEqual(response.data["created_by_id"], self.customer.id)

    def test_customer_can_create_room_with_cross_validation_settings(self):
        response = self.client.post(
            reverse("room-list-create"),
            {
                "title": "Cross room",
                "cross_validation_enabled": True,
                "cross_validation_annotators_count": 3,
                "cross_validation_similarity_threshold": 85,
            },
            format="json",
            **self.auth(self.customer),
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data["cross_validation_enabled"])
        self.assertEqual(response.data["cross_validation_annotators_count"], 3)
        self.assertEqual(response.data["cross_validation_similarity_threshold"], 85)

    def test_customer_can_invite_annotator(self):
        room = make_room(customer=self.customer, title="Room 1")

        response = self.client.post(
            reverse("room-invite", kwargs={"room_id": room.id}),
            {"annotator_id": self.annotator.id},
            format="json",
            **self.auth(self.customer),
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        membership = RoomMembership.objects.get(room=room, user=self.annotator)
        self.assertEqual(membership.status, RoomMembership.Status.INVITED)

    def test_owner_can_update_room_metadata(self):
        room = make_room(customer=self.customer, title="Initial room", description="Before update")

        response = self.client.patch(
            reverse("room-detail", kwargs={"room_id": room.id}),
            {
                "title": "Updated room",
                "description": "After update",
                "dataset_label": "Updated dataset",
                "password_changed": True,
                "password": "new-secret",
            },
            format="json",
            **self.auth(self.customer),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        room.refresh_from_db()
        self.assertEqual(room.title, "Updated room")
        self.assertEqual(room.description, "After update")
        self.assertEqual(room.dataset_label, "Updated dataset")
        self.assertTrue(room.check_access_password("new-secret"))

    def test_non_owner_cannot_update_room_metadata(self):
        room = make_room(customer=self.customer, title="Locked room")
        invite_annotator(room=room, annotator=self.admin_user, invited_by=self.customer, joined=True, role=RoomMembership.Role.ADMIN)

        response = self.client.patch(
            reverse("room-detail", kwargs={"room_id": room.id}),
            {
                "title": "Should fail",
            },
            format="json",
            **self.auth(self.admin_user),
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        room.refresh_from_db()
        self.assertEqual(room.title, "Locked room")

    def test_owner_can_assign_admin_and_tester_roles(self):
        room = make_room(customer=self.customer, title="Role room")
        invite_annotator(room=room, annotator=self.admin_user, invited_by=self.customer, joined=True)
        invite_annotator(room=room, annotator=self.tester_user, invited_by=self.customer, joined=True)

        admin_response = self.client.post(
            reverse("room-membership-role", kwargs={"room_id": room.id, "user_id": self.admin_user.id}),
            {"role": RoomMembership.Role.ADMIN},
            format="json",
            **self.auth(self.customer),
        )
        tester_response = self.client.post(
            reverse("room-membership-role", kwargs={"room_id": room.id, "user_id": self.tester_user.id}),
            {"role": RoomMembership.Role.TESTER},
            format="json",
            **self.auth(self.customer),
        )

        self.assertEqual(admin_response.status_code, status.HTTP_200_OK)
        self.assertEqual(tester_response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            RoomMembership.objects.get(room=room, user=self.admin_user).role,
            RoomMembership.Role.ADMIN,
        )
        self.assertEqual(
            RoomMembership.objects.get(room=room, user=self.tester_user).role,
            RoomMembership.Role.TESTER,
        )

    def test_admin_can_invite_participants_but_cannot_assign_roles(self):
        room = make_room(customer=self.customer, title="Admin room")
        invite_annotator(
            room=room,
            annotator=self.admin_user,
            invited_by=self.customer,
            joined=True,
            role=RoomMembership.Role.ADMIN,
        )

        invite_response = self.client.post(
            reverse("room-invite", kwargs={"room_id": room.id}),
            {"annotator_id": self.annotator.id},
            format="json",
            **self.auth(self.admin_user),
        )
        role_response = self.client.post(
            reverse("room-membership-role", kwargs={"room_id": room.id, "user_id": self.annotator.id}),
            {"role": RoomMembership.Role.TESTER},
            format="json",
            **self.auth(self.admin_user),
        )

        self.assertEqual(invite_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(role_response.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_can_set_annotator_assignment_quota(self):
        room = make_room(customer=self.customer, title="Quota room")
        invite_annotator(
            room=room,
            annotator=self.admin_user,
            invited_by=self.customer,
            joined=True,
            role=RoomMembership.Role.ADMIN,
        )
        invite_annotator(room=room, annotator=self.annotator, invited_by=self.customer, joined=True)

        response = self.client.post(
            reverse("room-assignment-quota", kwargs={"room_id": room.id, "user_id": self.annotator.id}),
            {"task_quota": 3},
            format="json",
            **self.auth(self.admin_user),
        )
        dashboard_response = self.client.get(
            reverse("room-dashboard", kwargs={"room_id": room.id}),
            **self.auth(self.admin_user),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["task_quota"], 3)
        self.assertTrue(RoomAssignmentQuota.objects.filter(room=room, user=self.annotator, task_quota=3).exists())
        self.assertEqual(dashboard_response.status_code, status.HTTP_200_OK)
        self.assertTrue(dashboard_response.data["actor"]["can_assign_quotas"])
        annotator_payload = next(item for item in dashboard_response.data["annotators"] if item["user_id"] == self.annotator.id)
        self.assertEqual(annotator_payload["task_quota"], 3)

    def test_annotator_sees_only_invited_rooms(self):
        visible_room = make_room(customer=self.customer, title="Visible room")
        hidden_room = make_room(customer=self.customer, title="Hidden room")
        invite_annotator(room=visible_room, annotator=self.annotator, invited_by=self.customer)
        invite_annotator(room=hidden_room, annotator=self.other_annotator, invited_by=self.customer)

        response = self.client.get(reverse("my-rooms"), **self.auth(self.annotator))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["id"], visible_room.id)

    def test_user_can_pin_room_and_pinned_rooms_appear_first(self):
        first_room = make_room(customer=self.customer, title="First room")
        second_room = make_room(customer=self.customer, title="Second room")
        invite_annotator(room=first_room, annotator=self.annotator, invited_by=self.customer)
        invite_annotator(room=second_room, annotator=self.annotator, invited_by=self.customer)

        pin_response = self.client.post(
            reverse("room-pin", kwargs={"room_id": first_room.id}),
            {"is_pinned": True},
            format="json",
            **self.auth(self.annotator),
        )
        list_response = self.client.get(reverse("my-rooms"), **self.auth(self.annotator))

        self.assertEqual(pin_response.status_code, status.HTTP_200_OK)
        self.assertTrue(RoomPin.objects.filter(room=first_room, user=self.annotator).exists())
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual([item["id"] for item in list_response.data], [first_room.id, second_room.id])
        self.assertTrue(list_response.data[0]["is_pinned"])
        self.assertFalse(list_response.data[1]["is_pinned"])

    def test_room_pinning_is_per_user(self):
        room = make_room(customer=self.customer, title="Shared room")
        invite_annotator(room=room, annotator=self.annotator, invited_by=self.customer)
        invite_annotator(room=room, annotator=self.other_annotator, invited_by=self.customer)

        self.client.post(
            reverse("room-pin", kwargs={"room_id": room.id}),
            {"is_pinned": True},
            format="json",
            **self.auth(self.annotator),
        )

        annotator_response = self.client.get(reverse("my-rooms"), **self.auth(self.annotator))
        other_response = self.client.get(reverse("my-rooms"), **self.auth(self.other_annotator))

        self.assertEqual(annotator_response.status_code, status.HTTP_200_OK)
        self.assertEqual(other_response.status_code, status.HTTP_200_OK)
        self.assertTrue(annotator_response.data[0]["is_pinned"])
        self.assertFalse(other_response.data[0]["is_pinned"])

    def test_annotator_cannot_join_uninvited_room(self):
        room = make_room(customer=self.customer, title="Locked room")

        response = self.client.post(
            reverse("room-join", kwargs={"room_id": room.id}),
            format="json",
            **self.auth(self.annotator),
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertFalse(RoomMembership.objects.filter(room=room, user=self.annotator).exists())

    def test_invited_annotator_can_join_room(self):
        room = make_room(customer=self.customer, title="Invited room")
        invite_annotator(room=room, annotator=self.annotator, invited_by=self.customer)

        response = self.client.post(
            reverse("room-join", kwargs={"room_id": room.id}),
            format="json",
            **self.auth(self.annotator),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        membership = RoomMembership.objects.get(room=room, user=self.annotator)
        self.assertEqual(membership.status, RoomMembership.Status.JOINED)

    def test_user_can_request_access_by_invite_link_and_owner_can_approve(self):
        room = make_room(customer=self.customer, title="Invite room")

        preview_response = self.client.get(reverse("room-invite-preview", kwargs={"invite_token": room.invite_token}))
        request_response = self.client.post(
            reverse("room-invite-request", kwargs={"invite_token": room.invite_token}),
            format="json",
            **self.auth(self.annotator),
        )

        join_request_id = request_response.data["id"]
        approve_response = self.client.post(
            reverse("room-join-request-approve", kwargs={"room_id": room.id, "join_request_id": join_request_id}),
            format="json",
            **self.auth(self.customer),
        )

        self.assertEqual(preview_response.status_code, status.HTTP_200_OK)
        self.assertEqual(preview_response.data["room"]["id"], room.id)
        self.assertEqual(request_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(request_response.data["status"], "pending")
        self.assertEqual(approve_response.status_code, status.HTTP_200_OK)
        membership = RoomMembership.objects.get(room=room, user=self.annotator)
        self.assertEqual(membership.status, RoomMembership.Status.JOINED)

    def test_owner_can_regenerate_room_invite(self):
        room = make_room(customer=self.customer, title="Regenerate invite room")
        old_token = str(room.invite_token)

        response = self.client.post(
            reverse("room-invite-regenerate", kwargs={"room_id": room.id}),
            format="json",
            **self.auth(self.customer),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        room.refresh_from_db()
        self.assertNotEqual(str(room.invite_token), old_token)

    def test_customer_can_create_image_room_with_labels_and_uploads(self):
        response = self.client.post(
            reverse("room-list-create"),
            {
                "title": "Image room",
                "dataset_mode": "image",
                "dataset_label": "Cars",
                "labels": json.dumps(
                    [
                        {"name": "car", "color": "#FF6B6B"},
                        {"name": "truck", "color": "#4ECDC4"},
                    ]
                ),
                "media_manifest": json.dumps(
                    [
                        {"name": "car-1.jpg", "width": 1920, "height": 1080},
                        {"name": "car-2.jpg", "width": 1280, "height": 720},
                    ]
                ),
                "dataset_files": [
                    SimpleUploadedFile("car-1.jpg", b"fake-image-1", content_type="image/jpeg"),
                    SimpleUploadedFile("car-2.jpg", b"fake-image-2", content_type="image/jpeg"),
                ],
            },
            format="multipart",
            **self.auth(self.customer),
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        room = self.customer.created_rooms.get(id=response.data["id"])
        self.assertEqual(room.dataset_type, "image")
        self.assertEqual(room.labels.count(), 2)
        self.assertEqual(room.tasks.count(), 2)
        first_task = room.tasks.order_by("id").first()
        self.assertEqual(first_task.source_type, Task.SourceType.IMAGE)
        self.assertTrue(first_task.source_file.name)
        self.assertEqual(first_task.input_payload["width"], 1920)

    def test_customer_can_create_image_room_from_zip_archive(self):
        response = self.client.post(
            reverse("room-list-create"),
            {
                "title": "Archive image room",
                "dataset_mode": "image",
                "dataset_label": "Archive cars",
                "labels": json.dumps([{"name": "car", "color": "#FF6B6B"}]),
                "dataset_files": [
                    self.make_zip_upload(
                        "images.zip",
                        {
                            "nested/car-zip-1.jpg": b"fake-image-1",
                            "car-zip-2.png": b"fake-image-2",
                            "__MACOSX/ignored.jpg": b"ignored",
                            "notes.txt": b"ignored",
                        },
                    ),
                ],
            },
            format="multipart",
            **self.auth(self.customer),
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        room = self.customer.created_rooms.get(id=response.data["id"])
        self.assertEqual(room.dataset_type, "image")
        self.assertEqual(room.tasks.count(), 2)
        self.assertEqual(
            list(room.tasks.order_by("id").values_list("source_name", flat=True)),
            ["car-zip-1.jpg", "car-zip-2.png"],
        )
        self.assertEqual(
            list(room.tasks.order_by("id").values_list("input_payload__item_number", flat=True)),
            [1, 2],
        )

    def test_owner_can_add_images_to_existing_room_dataset(self):
        room = make_room(customer=self.customer, title="Editable dataset", dataset_type="image")
        room.labels.create(name="car", color="#FF6B6B", sort_order=0)
        Task.objects.create(
            room=room,
            source_type=Task.SourceType.IMAGE,
            source_name="existing.jpg",
            input_payload={"item_number": 7, "source_name": "existing.jpg"},
        )

        response = self.client.post(
            reverse("room-dataset-upload", kwargs={"room_id": room.id}),
            {
                "media_manifest": json.dumps([{"name": "loose.jpg", "width": 640, "height": 480}]),
                "dataset_files": [
                    SimpleUploadedFile("loose.jpg", b"fake-image-3", content_type="image/jpeg"),
                    self.make_zip_upload(
                        "more-images.zip",
                        {
                            "batch/zip-1.jpg": b"fake-image-1",
                            "batch/zip-2.webp": b"fake-image-2",
                        },
                    ),
                ],
            },
            format="multipart",
            **self.auth(self.customer),
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["added_count"], 3)
        self.assertEqual(room.tasks.count(), 4)
        created_tasks = room.tasks.exclude(source_name="existing.jpg").order_by("id")
        self.assertEqual(list(created_tasks.values_list("source_name", flat=True)), ["loose.jpg", "zip-1.jpg", "zip-2.webp"])
        self.assertEqual(list(created_tasks.values_list("input_payload__item_number", flat=True)), [8, 9, 10])
        self.assertEqual(created_tasks.first().input_payload["width"], 640)

    def test_owner_can_list_and_delete_room_dataset_tasks(self):
        room = make_room(customer=self.customer, title="Delete dataset", dataset_type="image")
        first_task = Task.objects.create(
            room=room,
            source_type=Task.SourceType.IMAGE,
            source_name="first.jpg",
            source_file=SimpleUploadedFile("first.jpg", b"first", content_type="image/jpeg"),
            input_payload={"item_number": 1, "source_name": "first.jpg"},
        )
        second_task = Task.objects.create(
            room=room,
            source_type=Task.SourceType.IMAGE,
            source_name="second.jpg",
            source_file=SimpleUploadedFile("second.jpg", b"second", content_type="image/jpeg"),
            input_payload={"item_number": 2, "source_name": "second.jpg"},
        )

        list_response = self.client.get(
            reverse("room-dataset-task-list", kwargs={"room_id": room.id}),
            **self.auth(self.customer),
        )
        delete_response = self.client.post(
            reverse("room-dataset-delete", kwargs={"room_id": room.id}),
            {"task_ids": [first_task.id]},
            format="json",
            **self.auth(self.customer),
        )

        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual([item["id"] for item in list_response.data], [first_task.id, second_task.id])
        self.assertEqual(delete_response.status_code, status.HTTP_200_OK)
        self.assertEqual(delete_response.data["deleted_count"], 1)
        self.assertFalse(Task.objects.filter(id=first_task.id).exists())
        self.assertTrue(Task.objects.filter(id=second_task.id).exists())

    def test_non_owner_cannot_edit_room_dataset(self):
        room = make_room(customer=self.customer, title="Owner-only dataset", dataset_type="image")
        invite_annotator(
            room=room,
            annotator=self.admin_user,
            invited_by=self.customer,
            joined=True,
            role=RoomMembership.Role.ADMIN,
        )
        task = Task.objects.create(
            room=room,
            source_type=Task.SourceType.IMAGE,
            source_name="first.jpg",
            input_payload={"item_number": 1, "source_name": "first.jpg"},
        )

        upload_response = self.client.post(
            reverse("room-dataset-upload", kwargs={"room_id": room.id}),
            {"dataset_files": [SimpleUploadedFile("other.jpg", b"other", content_type="image/jpeg")]},
            format="multipart",
            **self.auth(self.admin_user),
        )
        delete_response = self.client.post(
            reverse("room-dataset-delete", kwargs={"room_id": room.id}),
            {"task_ids": [task.id]},
            format="json",
            **self.auth(self.admin_user),
        )
        list_response = self.client.get(
            reverse("room-dataset-task-list", kwargs={"room_id": room.id}),
            **self.auth(self.admin_user),
        )

        self.assertEqual(upload_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(delete_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(list_response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(room.tasks.count(), 1)

    def test_customer_can_create_detect_text_image_room_without_manual_labels(self):
        response = self.client.post(
            reverse("room-list-create"),
            {
                "title": "Detect text room",
                "dataset_mode": "image",
                "annotation_workflow": "text_detect_text",
                "dataset_label": "OCR",
                "media_manifest": json.dumps(
                    [
                        {"name": "ocr-1.jpg", "width": 1280, "height": 720},
                    ]
                ),
                "dataset_files": [
                    SimpleUploadedFile("ocr-1.jpg", b"fake-image-ocr", content_type="image/jpeg"),
                ],
            },
            format="multipart",
            **self.auth(self.customer),
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        room = self.customer.created_rooms.get(id=response.data["id"])
        self.assertEqual(room.annotation_workflow, "text_detect_text")
        self.assertEqual(room.labels.count(), 1)
        self.assertEqual(room.labels.first().name, "text")
        task = room.tasks.first()
        self.assertEqual(task.workflow_stage, Task.WorkflowStage.TEXT_DETECTION)

    def test_customer_can_create_video_room_and_split_it_into_frame_tasks(self):
        if not shutil.which("ffmpeg"):
            self.skipTest("ffmpeg is not available in the current environment")

        video_path = Path(self.media_dir.name) / "sample.mp4"
        subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=32x32:d=0.2:r=5",
                str(video_path),
            ],
            check=True,
            capture_output=True,
        )

        with video_path.open("rb") as video_handle:
            response = self.client.post(
                reverse("room-list-create"),
                {
                    "title": "Video room",
                    "dataset_mode": "video",
                    "dataset_label": "Frames",
                    "labels": json.dumps([{"name": "car", "color": "#FF6B6B"}]),
                    "media_manifest": json.dumps(
                        [
                            {
                                "name": "sample.mp4",
                                "width": 32,
                                "height": 32,
                                "duration": 0.2,
                                "frame_rate": 5,
                            }
                        ]
                    ),
                    "dataset_files": [
                        SimpleUploadedFile("sample.mp4", video_handle.read(), content_type="video/mp4"),
                    ],
                },
                format="multipart",
                **self.auth(self.customer),
            )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        room = self.customer.created_rooms.get(id=response.data["id"])
        self.assertEqual(room.dataset_type, "video")
        self.assertGreater(room.tasks.count(), 0)
        first_task = room.tasks.order_by("id").first()
        self.assertEqual(first_task.source_type, Task.SourceType.IMAGE)
        self.assertEqual(first_task.input_payload["origin_source_type"], Task.SourceType.VIDEO)
        self.assertTrue(first_task.source_file.name.endswith(".jpg"))

    def test_customer_can_export_native_room_dataset(self):
        room = make_room(customer=self.customer, title="Export room", dataset_type="image")
        label = room.labels.create(name="car", color="#FF6B6B", sort_order=0)
        task = Task.objects.create(
            room=room,
            source_type=Task.SourceType.IMAGE,
            source_name="car-1.jpg",
            input_payload={"width": 640, "height": 480, "source_name": "car-1.jpg"},
        )
        assignment = TaskAssignment.objects.create(
            task=task,
            annotator=self.annotator,
            round_number=1,
            status=TaskAssignment.Status.SUBMITTED,
            assigned_at=timezone.now(),
            submitted_at=timezone.now(),
        )
        Annotation.objects.create(
            task=task,
            assignment=assignment,
            annotator=self.annotator,
            result_payload={
                "annotations": [
                    {
                        "type": "bbox",
                        "label_id": label.id,
                        "points": [10, 12, 110, 112],
                        "frame": 0,
                        "attributes": [],
                        "occluded": False,
                    }
                ]
            },
            submitted_at=timezone.now(),
        )
        task.consensus_payload = {
            "annotations": [
                {
                    "type": "bbox",
                    "label_id": label.id,
                    "points": [10, 12, 110, 112],
                    "frame": 0,
                    "attributes": [],
                    "occluded": False,
                }
            ]
        }
        task.validation_score = 100.0
        task.status = Task.Status.SUBMITTED
        task.save(update_fields=["consensus_payload", "validation_score", "status", "updated_at"])

        response = self.client.get(
            f'{reverse("room-export", kwargs={"room_id": room.id})}?export_format=native_json',
            **self.auth(self.customer),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("attachment;", response["Content-Disposition"])
        payload = json.loads(response.content)
        self.assertEqual(payload["room"]["id"], room.id)
        self.assertEqual(payload["labels"][0]["name"], "car")
        self.assertEqual(payload["tasks"][0]["annotation"]["annotations"][0]["label_id"], label.id)

    def test_room_dashboard_lists_new_export_formats(self):
        room = make_room(customer=self.customer, title="Export formats room", dataset_type="image")

        response = self.client.get(
            reverse("room-dashboard", kwargs={"room_id": room.id}),
            **self.auth(self.customer),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            [item["value"] for item in response.data["export_formats"]],
            ["native_json", "jsonl", "coco_json", "yolo_zip", "pascal_voc_zip"],
        )

    def test_customer_can_export_room_dataset_as_jsonl(self):
        room = make_room(customer=self.customer, title="Export JSONL room", dataset_type="image")
        label = room.labels.create(name="car", color="#FF6B6B", sort_order=0)
        task = Task.objects.create(
            room=room,
            status=Task.Status.SUBMITTED,
            source_type=Task.SourceType.IMAGE,
            source_name="car-1.jpg",
            input_payload={"width": 640, "height": 480, "source_name": "car-1.jpg"},
            consensus_payload={
                "annotations": [
                    {
                        "type": "bbox",
                        "label_id": label.id,
                        "points": [10, 12, 110, 112],
                        "frame": 0,
                        "attributes": [],
                        "occluded": False,
                    }
                ]
            },
            validation_score=100.0,
        )

        response = self.client.get(
            f'{reverse("room-export", kwargs={"room_id": room.id})}?export_format=jsonl',
            **self.auth(self.customer),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "application/x-ndjson; charset=utf-8")
        lines = response.content.decode("utf-8").strip().splitlines()
        self.assertEqual(len(lines), 1)
        payload = json.loads(lines[0])
        self.assertEqual(payload["task_id"], task.id)
        self.assertEqual(payload["annotations"][0]["label"]["name"], "car")

    def test_customer_can_export_room_dataset_as_pascal_voc_zip(self):
        room = make_room(customer=self.customer, title="Export VOC room", dataset_type="image")
        label = room.labels.create(name="car", color="#FF6B6B", sort_order=0)
        Task.objects.create(
            room=room,
            status=Task.Status.SUBMITTED,
            source_type=Task.SourceType.IMAGE,
            source_name="car-1.jpg",
            input_payload={"width": 640, "height": 480, "source_name": "car-1.jpg"},
            consensus_payload={
                "annotations": [
                    {
                        "type": "bbox",
                        "label_id": label.id,
                        "points": [10, 12, 110, 112],
                        "frame": 0,
                        "attributes": [],
                        "occluded": False,
                    }
                ]
            },
            validation_score=100.0,
        )

        response = self.client.get(
            f'{reverse("room-export", kwargs={"room_id": room.id})}?export_format=pascal_voc_zip',
            **self.auth(self.customer),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "application/zip")
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            self.assertIn("Annotations/car-1.xml", archive.namelist())
            xml_payload = archive.read("Annotations/car-1.xml")

        root = ElementTree.fromstring(xml_payload)
        self.assertEqual(root.findtext("filename"), "car-1.jpg")
        self.assertEqual(root.findtext("object/name"), "car")
        self.assertEqual(root.findtext("object/bndbox/xmin"), "10")
        self.assertEqual(root.findtext("object/bndbox/ymax"), "112")

    def test_export_ignores_non_validated_annotations(self):
        room = make_room(customer=self.customer, title="Export filtered room", dataset_type="image")
        label = room.labels.create(name="car", color="#FF6B6B", sort_order=0)

        valid_task = Task.objects.create(
            room=room,
            status=Task.Status.SUBMITTED,
            source_type=Task.SourceType.IMAGE,
            source_name="valid.jpg",
            input_payload={"width": 640, "height": 480, "source_name": "valid.jpg"},
            consensus_payload={
                "annotations": [
                    {
                        "type": "bbox",
                        "label_id": label.id,
                        "points": [10, 10, 100, 100],
                        "frame": 0,
                        "attributes": [],
                        "occluded": False,
                    }
                ]
            },
            validation_score=100.0,
        )
        pending_task = Task.objects.create(
            room=room,
            status=Task.Status.PENDING,
            source_type=Task.SourceType.IMAGE,
            source_name="pending.jpg",
            input_payload={"width": 640, "height": 480, "source_name": "pending.jpg"},
        )

        submitted_assignment = TaskAssignment.objects.create(
            task=pending_task,
            annotator=self.annotator,
            round_number=1,
            status=TaskAssignment.Status.SUBMITTED,
            assigned_at=timezone.now(),
            submitted_at=timezone.now(),
        )
        Annotation.objects.create(
            task=pending_task,
            assignment=submitted_assignment,
            annotator=self.annotator,
            result_payload={
                "annotations": [
                    {
                        "type": "bbox",
                        "label_id": label.id,
                        "points": [20, 20, 120, 120],
                        "frame": 0,
                        "attributes": [],
                        "occluded": False,
                    }
                ]
            },
            submitted_at=timezone.now(),
        )

        native_response = self.client.get(
            f'{reverse("room-export", kwargs={"room_id": room.id})}?export_format=native_json',
            **self.auth(self.customer),
        )
        coco_response = self.client.get(
            f'{reverse("room-export", kwargs={"room_id": room.id})}?export_format=coco_json',
            **self.auth(self.customer),
        )

        self.assertEqual(native_response.status_code, status.HTTP_200_OK)
        self.assertEqual(coco_response.status_code, status.HTTP_200_OK)

        native_payload = json.loads(native_response.content)
        coco_payload = json.loads(coco_response.content)

        self.assertEqual([item["task_id"] for item in native_payload["tasks"]], [valid_task.id])
        self.assertEqual([item["id"] for item in coco_payload["images"]], [valid_task.id])
        self.assertEqual([item["image_id"] for item in coco_payload["annotations"]], [valid_task.id])

    def test_owner_can_review_and_reject_submitted_task(self):
        room = make_room(customer=self.customer, title="Review room", dataset_type="image")
        label = room.labels.create(name="car", color="#FF6B6B", sort_order=0)
        task = Task.objects.create(
            room=room,
            status=Task.Status.SUBMITTED,
            source_type=Task.SourceType.IMAGE,
            source_name="review.jpg",
            input_payload={"width": 640, "height": 480, "source_name": "review.jpg"},
            consensus_payload={
                "annotations": [
                    {
                        "type": "bbox",
                        "label_id": label.id,
                        "points": [10, 10, 100, 100],
                        "frame": 0,
                        "attributes": [],
                        "occluded": False,
                    }
                ]
            },
            validation_score=92.0,
        )
        assignment = TaskAssignment.objects.create(
            task=task,
            annotator=self.annotator,
            round_number=1,
            status=TaskAssignment.Status.SUBMITTED,
            assigned_at=timezone.now(),
            submitted_at=timezone.now(),
        )
        Annotation.objects.create(
            task=task,
            assignment=assignment,
            annotator=self.annotator,
            result_payload=task.consensus_payload,
            submitted_at=timezone.now(),
        )

        list_response = self.client.get(
            reverse("room-review-tasks", kwargs={"room_id": room.id}),
            **self.auth(self.customer),
        )
        detail_response = self.client.get(
            reverse("task-review-detail", kwargs={"task_id": task.id}),
            **self.auth(self.customer),
        )
        reject_response = self.client.post(
            reverse("task-reject", kwargs={"task_id": task.id}),
            format="json",
            **self.auth(self.customer),
        )

        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(list_response.data[0]["id"], task.id)
        self.assertEqual(detail_response.status_code, status.HTTP_200_OK)
        self.assertEqual(detail_response.data["task"]["id"], task.id)
        self.assertEqual(len(detail_response.data["annotations"]), 1)
        self.assertEqual(reject_response.status_code, status.HTTP_200_OK)

        task.refresh_from_db()
        self.assertEqual(task.status, Task.Status.PENDING)
        self.assertEqual(task.current_round, 2)
        self.assertIsNone(task.consensus_payload)

    def test_return_for_revision_removes_task_from_final_export_state(self):
        room = make_room(customer=self.customer, title="Revision export room", dataset_type="image")
        invite_annotator(room=room, annotator=self.annotator, invited_by=self.customer, joined=True)
        label = room.labels.create(name="car", color="#FF6B6B", sort_order=0)
        task = Task.objects.create(
            room=room,
            status=Task.Status.SUBMITTED,
            source_type=Task.SourceType.IMAGE,
            source_name="revision-export.jpg",
            input_payload={"width": 640, "height": 480, "source_name": "revision-export.jpg"},
            consensus_payload={
                "annotations": [
                    {
                        "type": "bbox",
                        "label_id": label.id,
                        "points": [10, 10, 100, 100],
                        "frame": 0,
                        "attributes": [],
                        "occluded": False,
                    }
                ]
            },
            validation_score=92.0,
        )
        assignment = TaskAssignment.objects.create(
            task=task,
            annotator=self.annotator,
            round_number=1,
            status=TaskAssignment.Status.SUBMITTED,
            assigned_at=timezone.now(),
            submitted_at=timezone.now(),
        )
        Annotation.objects.create(
            task=task,
            assignment=assignment,
            annotator=self.annotator,
            result_payload=task.consensus_payload,
            submitted_at=timezone.now(),
        )

        return_response = self.client.post(
            reverse("task-return-for-revision", kwargs={"task_id": task.id}),
            {"annotator_id": self.annotator.id},
            format="json",
            **self.auth(self.customer),
        )
        export_response = self.client.get(
            reverse("room-export", kwargs={"room_id": room.id}),
            {"export_format": "native_json"},
            **self.auth(self.customer),
        )

        self.assertEqual(return_response.status_code, status.HTTP_200_OK)
        self.assertEqual(export_response.status_code, status.HTTP_200_OK)
        payload = json.loads(export_response.content.decode("utf-8"))
        self.assertEqual(payload["tasks"], [])

    def test_detect_text_room_progress_uses_only_final_stage_tasks(self):
        room = make_room(
            customer=self.customer,
            title="Detect+Text progress room",
            dataset_type="image",
            annotation_workflow="text_detect_text",
        )
        detection_task = make_task(
            room=room,
            payload={"width": 640, "height": 480, "source_name": "ocr-progress.jpg"},
            source_type=Task.SourceType.IMAGE,
            source_name="ocr-progress.jpg",
            workflow_stage=Task.WorkflowStage.TEXT_DETECTION,
        )
        detection_task.status = Task.Status.SUBMITTED
        detection_task.consensus_payload = {
            "annotations": [
                {"type": "bbox", "label_id": 1, "points": [10, 10, 100, 50], "frame": 0, "attributes": [], "occluded": False}
            ]
        }
        detection_task.save(update_fields=["status", "consensus_payload", "updated_at"])
        make_task(
            room=room,
            parent_task=detection_task,
            payload={
                "detected_annotations": detection_task.consensus_payload["annotations"],
                "excluded_annotator_ids": [self.annotator.id],
            },
            source_type=Task.SourceType.IMAGE,
            source_name="ocr-progress.jpg",
            workflow_stage=Task.WorkflowStage.TEXT_TRANSCRIPTION,
        )

        response = self.client.get(
            reverse("room-dashboard", kwargs={"room_id": room.id}),
            **self.auth(self.customer),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["overview"]["total_tasks"], 1)
        self.assertEqual(response.data["overview"]["completed_tasks"], 0)
        self.assertEqual(response.data["overview"]["remaining_tasks"], 1)

    def test_detect_text_export_includes_only_final_transcription_stage(self):
        room = make_room(
            customer=self.customer,
            title="Detect+Text export room",
            dataset_type="image",
            annotation_workflow="text_detect_text",
        )
        label = room.labels.create(name="text", color="#FFC919", sort_order=0)
        detection_task = make_task(
            room=room,
            payload={"width": 640, "height": 480, "source_name": "ocr-export.jpg"},
            source_type=Task.SourceType.IMAGE,
            source_name="ocr-export.jpg",
            workflow_stage=Task.WorkflowStage.TEXT_DETECTION,
        )
        detection_task.status = Task.Status.SUBMITTED
        detection_task.consensus_payload = {
            "annotations": [
                {"type": "bbox", "label_id": label.id, "points": [10, 10, 100, 50], "frame": 0, "attributes": [], "occluded": False}
            ]
        }
        detection_task.save(update_fields=["status", "consensus_payload", "updated_at"])
        transcription_task = make_task(
            room=room,
            parent_task=detection_task,
            payload={
                "detected_annotations": detection_task.consensus_payload["annotations"],
                "excluded_annotator_ids": [self.annotator.id],
            },
            source_type=Task.SourceType.IMAGE,
            source_name="ocr-export.jpg",
            workflow_stage=Task.WorkflowStage.TEXT_TRANSCRIPTION,
        )
        transcription_task.status = Task.Status.SUBMITTED
        transcription_task.consensus_payload = {
            "annotations": [
                {
                    "type": "bbox",
                    "label_id": label.id,
                    "points": [10, 10, 100, 50],
                    "frame": 0,
                    "attributes": [],
                    "occluded": False,
                    "text": "Итоговый текст",
                }
            ]
        }
        transcription_task.save(update_fields=["status", "consensus_payload", "updated_at"])

        response = self.client.get(
            reverse("room-export", kwargs={"room_id": room.id}),
            {"export_format": "native_json"},
            **self.auth(self.customer),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = json.loads(response.content.decode("utf-8"))
        self.assertEqual(len(payload["tasks"]), 1)
        self.assertEqual(payload["tasks"][0]["task_id"], transcription_task.id)
        self.assertEqual(payload["tasks"][0]["annotation"]["annotations"][0]["text"], "Итоговый текст")
