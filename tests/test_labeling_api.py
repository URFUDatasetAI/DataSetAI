from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.labeling.models import Annotation, Task, TaskAssignment
from apps.rooms.models import RoomMembership
from apps.users.models import User
from tests.factories import invite_annotator, make_room, make_task, make_user


class LabelingApiTests(APITestCase):
    def setUp(self):
        self.customer = make_user(username="customer", role=User.Role.CUSTOMER)
        self.annotator = make_user(username="annotator", role=User.Role.ANNOTATOR)
        self.other_annotator = make_user(username="annotator2", role=User.Role.ANNOTATOR)
        self.admin_user = make_user(username="roomadmin", role=User.Role.ANNOTATOR)
        self.tester_user = make_user(username="roomtester", role=User.Role.ANNOTATOR)
        self.room = make_room(customer=self.customer, title="Dataset room")
        invite_annotator(room=self.room, annotator=self.annotator, invited_by=self.customer, joined=True)
        invite_annotator(room=self.room, annotator=self.other_annotator, invited_by=self.customer)
        self.task_1 = make_task(room=self.room, payload={"text": "first sample"})
        self.task_2 = make_task(room=self.room, payload={"text": "second sample"})
        self.image_room = make_room(customer=self.customer, title="Image room", dataset_type="image")
        invite_annotator(room=self.image_room, annotator=self.annotator, invited_by=self.customer, joined=True)
        self.image_label = self.image_room.labels.create(name="car", color="#FF6B6B", sort_order=0)
        self.image_task = make_task(
            room=self.image_room,
            payload={"width": 640, "height": 480, "source_name": "car-1.jpg"},
            source_type=Task.SourceType.IMAGE,
            source_name="car-1.jpg",
        )

    def auth(self, user):
        return {"HTTP_X_USER_ID": str(user.id)}

    def test_annotator_can_get_next_task(self):
        response = self.client.get(
            reverse("room-next-task", kwargs={"room_id": self.room.id}),
            **self.auth(self.annotator),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["id"], self.task_1.id)

        self.task_1.refresh_from_db()
        self.assertEqual(self.task_1.status, Task.Status.IN_PROGRESS)
        self.assertTrue(
            TaskAssignment.objects.filter(
                task=self.task_1,
                annotator=self.annotator,
                status=TaskAssignment.Status.IN_PROGRESS,
            ).exists()
        )

    def test_annotator_can_submit_annotation(self):
        self.client.get(reverse("room-next-task", kwargs={"room_id": self.room.id}), **self.auth(self.annotator))

        response = self.client.post(
            reverse("task-submit", kwargs={"task_id": self.task_1.id}),
            {"result_payload": {"label": "positive"}},
            format="json",
            **self.auth(self.annotator),
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(Annotation.objects.filter(task=self.task_1, annotator=self.annotator).exists())

        self.task_1.refresh_from_db()
        self.assertEqual(self.task_1.status, Task.Status.SUBMITTED)
        self.assertEqual(
            TaskAssignment.objects.get(task=self.task_1, annotator=self.annotator).status,
            TaskAssignment.Status.SUBMITTED,
        )

    def test_room_owner_can_get_next_task_and_submit_annotation(self):
        response = self.client.get(
            reverse("room-next-task", kwargs={"room_id": self.room.id}),
            **self.auth(self.customer),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["id"], self.task_1.id)
        self.assertTrue(
            TaskAssignment.objects.filter(
                task=self.task_1,
                annotator=self.customer,
                status=TaskAssignment.Status.IN_PROGRESS,
            ).exists()
        )

        submit_response = self.client.post(
            reverse("task-submit", kwargs={"task_id": self.task_1.id}),
            {"result_payload": {"label": "owner-review"}},
            format="json",
            **self.auth(self.customer),
        )

        self.assertEqual(submit_response.status_code, status.HTTP_201_CREATED)
        self.task_1.refresh_from_db()
        self.assertEqual(self.task_1.status, Task.Status.SUBMITTED)

    def test_cross_validation_requires_multiple_matching_annotations(self):
        cross_room = make_room(
            customer=self.customer,
            title="Cross room",
            cross_validation_enabled=True,
            cross_validation_annotators_count=2,
            cross_validation_similarity_threshold=80,
        )
        invite_annotator(room=cross_room, annotator=self.annotator, invited_by=self.customer, joined=True)
        invite_annotator(room=cross_room, annotator=self.other_annotator, invited_by=self.customer, joined=True)
        task = make_task(room=cross_room, payload={"text": "cross sample"})

        self.client.get(reverse("room-next-task", kwargs={"room_id": cross_room.id}), **self.auth(self.annotator))
        first_submit = self.client.post(
            reverse("task-submit", kwargs={"task_id": task.id}),
            {"result_payload": {"label": "positive"}},
            format="json",
            **self.auth(self.annotator),
        )

        self.assertEqual(first_submit.status_code, status.HTTP_201_CREATED)
        task.refresh_from_db()
        self.assertEqual(task.status, Task.Status.IN_PROGRESS)

        second_next = self.client.get(
            reverse("room-next-task", kwargs={"room_id": cross_room.id}),
            **self.auth(self.other_annotator),
        )
        self.assertEqual(second_next.status_code, status.HTTP_200_OK)
        self.assertEqual(second_next.data["id"], task.id)

        second_submit = self.client.post(
            reverse("task-submit", kwargs={"task_id": task.id}),
            {"result_payload": {"label": "positive"}},
            format="json",
            **self.auth(self.other_annotator),
        )

        self.assertEqual(second_submit.status_code, status.HTTP_201_CREATED)
        task.refresh_from_db()
        self.assertEqual(task.status, Task.Status.SUBMITTED)
        self.assertGreaterEqual(task.validation_score, 80)

    def test_unjoined_annotator_cannot_get_next_task(self):
        response = self.client.get(
            reverse("room-next-task", kwargs={"room_id": self.room.id}),
            **self.auth(self.other_annotator),
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_annotator_can_submit_image_bbox_annotation(self):
        self.client.get(reverse("room-next-task", kwargs={"room_id": self.image_room.id}), **self.auth(self.annotator))

        response = self.client.post(
            reverse("task-submit", kwargs={"task_id": self.image_task.id}),
            {
                "result_payload": {
                    "annotations": [
                        {
                            "type": "bbox",
                            "label_id": self.image_label.id,
                            "points": [12, 18, 150, 170],
                            "frame": 0,
                            "attributes": [],
                            "occluded": False,
                        }
                    ]
                }
            },
            format="json",
            **self.auth(self.annotator),
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.image_task.refresh_from_db()
        self.assertEqual(self.image_task.status, Task.Status.SUBMITTED)

    def test_image_annotation_rejects_unknown_label_id(self):
        self.client.get(reverse("room-next-task", kwargs={"room_id": self.image_room.id}), **self.auth(self.annotator))

        response = self.client.post(
            reverse("task-submit", kwargs={"task_id": self.image_task.id}),
            {
                "result_payload": {
                    "annotations": [
                        {
                            "type": "bbox",
                            "label_id": 99999,
                            "points": [12, 18, 150, 170],
                            "frame": 0,
                            "attributes": [],
                            "occluded": False,
                        }
                    ]
                }
            },
            format="json",
            **self.auth(self.annotator),
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_admin_can_review_and_reject_submitted_tasks(self):
        review_room = make_room(customer=self.customer, title="Admin review room", dataset_type="image")
        invite_annotator(
            room=review_room,
            annotator=self.admin_user,
            invited_by=self.customer,
            joined=True,
            role=RoomMembership.Role.ADMIN,
        )
        label = review_room.labels.create(name="car", color="#FF6B6B", sort_order=0)
        task = make_task(
            room=review_room,
            payload={"width": 640, "height": 480, "source_name": "review-admin.jpg"},
            source_type=Task.SourceType.IMAGE,
            source_name="review-admin.jpg",
        )
        task.status = Task.Status.SUBMITTED
        task.consensus_payload = {
            "annotations": [
                {"type": "bbox", "label_id": label.id, "points": [10, 10, 100, 100], "frame": 0, "attributes": [], "occluded": False}
            ]
        }
        task.validation_score = 88.0
        task.save(update_fields=["status", "consensus_payload", "validation_score", "updated_at"])
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
            reverse("room-review-tasks", kwargs={"room_id": review_room.id}),
            **self.auth(self.admin_user),
        )
        reject_response = self.client.post(
            reverse("task-reject", kwargs={"task_id": task.id}),
            format="json",
            **self.auth(self.admin_user),
        )

        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(reject_response.status_code, status.HTTP_200_OK)
        task.refresh_from_db()
        self.assertEqual(task.status, Task.Status.PENDING)

    def test_tester_can_review_submitted_tasks(self):
        review_room = make_room(customer=self.customer, title="Tester review room", dataset_type="image")
        invite_annotator(
            room=review_room,
            annotator=self.tester_user,
            invited_by=self.customer,
            joined=True,
            role=RoomMembership.Role.TESTER,
        )
        label = review_room.labels.create(name="car", color="#FF6B6B", sort_order=0)
        task = make_task(
            room=review_room,
            payload={"width": 640, "height": 480, "source_name": "review-tester.jpg"},
            source_type=Task.SourceType.IMAGE,
            source_name="review-tester.jpg",
        )
        task.status = Task.Status.SUBMITTED
        task.consensus_payload = {
            "annotations": [
                {"type": "bbox", "label_id": label.id, "points": [15, 15, 115, 115], "frame": 0, "attributes": [], "occluded": False}
            ]
        }
        task.validation_score = 91.0
        task.save(update_fields=["status", "consensus_payload", "validation_score", "updated_at"])
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

        detail_response = self.client.get(
            reverse("task-review-detail", kwargs={"task_id": task.id}),
            **self.auth(self.tester_user),
        )

        self.assertEqual(detail_response.status_code, status.HTTP_200_OK)
        self.assertEqual(detail_response.data["task"]["id"], task.id)

    def test_tester_cannot_get_next_task_for_labeling(self):
        tester_room = make_room(customer=self.customer, title="Tester labeling room")
        invite_annotator(
            room=tester_room,
            annotator=self.tester_user,
            invited_by=self.customer,
            joined=True,
            role=RoomMembership.Role.TESTER,
        )
        make_task(room=tester_room, payload={"item_number": 1, "source_name": "tester-item"})

        response = self.client.get(
            reverse("room-next-task", kwargs={"room_id": tester_room.id}),
            **self.auth(self.tester_user),
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
