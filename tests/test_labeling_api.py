from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.labeling.models import Annotation, Task, TaskAssignment
from apps.rooms.models import RoomAssignmentQuota, RoomMembership
from apps.users.models import User
from tests.factories import invite_annotator, make_room, make_task, make_user


class LabelingApiTests(APITestCase):
    def setUp(self):
        self.customer = make_user(username="customer", full_name="Customer")
        self.annotator = make_user(username="annotator", full_name="Annotator")
        self.other_annotator = make_user(username="annotator2", full_name="Annotator 2")
        self.admin_user = make_user(username="roomadmin", full_name="Room Admin")
        self.tester_user = make_user(username="roomtester", full_name="Room Tester")
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
            owner_is_annotator=False,
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

    def test_assignment_quota_caps_new_tasks_and_restores_after_rejection(self):
        quota_room = make_room(
            customer=self.customer,
            title="Quota labeling room",
            owner_is_annotator=False,
        )
        invite_annotator(room=quota_room, annotator=self.annotator, invited_by=self.customer, joined=True)
        RoomAssignmentQuota.objects.create(room=quota_room, user=self.annotator, task_quota=1)
        first_task = make_task(room=quota_room, payload={"text": "quota first"})
        make_task(room=quota_room, payload={"text": "quota second"})

        first_next = self.client.get(
            reverse("room-next-task", kwargs={"room_id": quota_room.id}),
            **self.auth(self.annotator),
        )
        first_submit = self.client.post(
            reverse("task-submit", kwargs={"task_id": first_task.id}),
            {"result_payload": {"label": "done"}},
            format="json",
            **self.auth(self.annotator),
        )
        quota_blocked = self.client.get(
            reverse("room-next-task", kwargs={"room_id": quota_room.id}),
            **self.auth(self.annotator),
        )
        reject_response = self.client.post(
            reverse("task-reject", kwargs={"task_id": first_task.id}),
            format="json",
            **self.auth(self.customer),
        )
        restored_next = self.client.get(
            reverse("room-next-task", kwargs={"room_id": quota_room.id}),
            **self.auth(self.annotator),
        )

        self.assertEqual(first_next.status_code, status.HTTP_200_OK)
        self.assertEqual(first_submit.status_code, status.HTTP_201_CREATED)
        self.assertEqual(quota_blocked.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(reject_response.status_code, status.HTTP_200_OK)
        self.assertEqual(restored_next.status_code, status.HTTP_200_OK)
        self.assertEqual(restored_next.data["id"], first_task.id)

    def test_room_default_assignment_quota_caps_new_tasks(self):
        quota_room = make_room(
            customer=self.customer,
            title="Default quota labeling room",
            owner_is_annotator=False,
            default_assignment_quota=1,
        )
        invite_annotator(room=quota_room, annotator=self.annotator, invited_by=self.customer, joined=True)
        first_task = make_task(room=quota_room, payload={"text": "default quota first"})
        make_task(room=quota_room, payload={"text": "default quota second"})

        first_next = self.client.get(
            reverse("room-next-task", kwargs={"room_id": quota_room.id}),
            **self.auth(self.annotator),
        )
        first_submit = self.client.post(
            reverse("task-submit", kwargs={"task_id": first_task.id}),
            {"result_payload": {"label": "done"}},
            format="json",
            **self.auth(self.annotator),
        )
        quota_blocked = self.client.get(
            reverse("room-next-task", kwargs={"room_id": quota_room.id}),
            **self.auth(self.annotator),
        )

        self.assertEqual(first_next.status_code, status.HTTP_200_OK)
        self.assertEqual(first_submit.status_code, status.HTTP_201_CREATED)
        self.assertEqual(quota_blocked.status_code, status.HTTP_204_NO_CONTENT)

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

    def test_annotator_can_skip_image_task_without_receiving_same_round_again(self):
        second_image_task = make_task(
            room=self.image_room,
            payload={"width": 320, "height": 240, "source_name": "car-2.jpg"},
            source_type=Task.SourceType.IMAGE,
            source_name="car-2.jpg",
        )
        self.client.get(reverse("room-next-task", kwargs={"room_id": self.image_room.id}), **self.auth(self.annotator))

        skip_response = self.client.post(
            reverse("task-skip", kwargs={"task_id": self.image_task.id}),
            format="json",
            **self.auth(self.annotator),
        )
        next_response = self.client.get(
            reverse("room-next-task", kwargs={"room_id": self.image_room.id}),
            **self.auth(self.annotator),
        )

        self.assertEqual(skip_response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            TaskAssignment.objects.get(task=self.image_task, annotator=self.annotator).status,
            TaskAssignment.Status.SKIPPED,
        )
        self.image_task.refresh_from_db()
        self.assertEqual(self.image_task.status, Task.Status.PENDING)
        self.assertEqual(next_response.status_code, status.HTTP_200_OK)
        self.assertEqual(next_response.data["id"], second_image_task.id)

    def test_skipped_images_count_against_new_image_quota_until_retried(self):
        quota_room = make_room(
            customer=self.customer,
            title="Skip quota room",
            dataset_type="image",
            owner_is_annotator=False,
            default_assignment_quota=2,
        )
        invite_annotator(room=quota_room, annotator=self.annotator, invited_by=self.customer, joined=True)
        first_task = make_task(
            room=quota_room,
            payload={"width": 320, "height": 240, "source_name": "skip-1.jpg"},
            source_type=Task.SourceType.IMAGE,
            source_name="skip-1.jpg",
        )
        second_task = make_task(
            room=quota_room,
            payload={"width": 320, "height": 240, "source_name": "skip-2.jpg"},
            source_type=Task.SourceType.IMAGE,
            source_name="skip-2.jpg",
        )
        third_task = make_task(
            room=quota_room,
            payload={"width": 320, "height": 240, "source_name": "skip-3.jpg"},
            source_type=Task.SourceType.IMAGE,
            source_name="skip-3.jpg",
        )

        first_next = self.client.get(reverse("room-next-task", kwargs={"room_id": quota_room.id}), **self.auth(self.annotator))
        first_skip = self.client.post(reverse("task-skip", kwargs={"task_id": first_task.id}), format="json", **self.auth(self.annotator))
        second_next = self.client.get(reverse("room-next-task", kwargs={"room_id": quota_room.id}), **self.auth(self.annotator))
        second_skip = self.client.post(reverse("task-skip", kwargs={"task_id": second_task.id}), format="json", **self.auth(self.annotator))
        retry_next = self.client.get(reverse("room-next-task", kwargs={"room_id": quota_room.id}), **self.auth(self.annotator))

        self.assertEqual(first_next.status_code, status.HTTP_200_OK)
        self.assertEqual(first_next.data["id"], first_task.id)
        self.assertEqual(first_skip.status_code, status.HTTP_200_OK)
        self.assertEqual(second_next.status_code, status.HTTP_200_OK)
        self.assertEqual(second_next.data["id"], second_task.id)
        self.assertEqual(second_skip.status_code, status.HTTP_200_OK)
        self.assertEqual(retry_next.status_code, status.HTTP_200_OK)
        self.assertEqual(retry_next.data["id"], first_task.id)
        self.assertNotEqual(retry_next.data["id"], third_task.id)

    def test_skipped_image_completed_by_other_annotator_frees_new_image_slot(self):
        quota_room = make_room(
            customer=self.customer,
            title="Skip quota refill room",
            dataset_type="image",
            owner_is_annotator=False,
            default_assignment_quota=2,
        )
        invite_annotator(room=quota_room, annotator=self.annotator, invited_by=self.customer, joined=True)
        invite_annotator(room=quota_room, annotator=self.other_annotator, invited_by=self.customer, joined=True)
        label = quota_room.labels.create(name="car", color="#FF6B6B", sort_order=0)
        first_task = make_task(
            room=quota_room,
            payload={"width": 320, "height": 240, "source_name": "refill-1.jpg"},
            source_type=Task.SourceType.IMAGE,
            source_name="refill-1.jpg",
        )
        second_task = make_task(
            room=quota_room,
            payload={"width": 320, "height": 240, "source_name": "refill-2.jpg"},
            source_type=Task.SourceType.IMAGE,
            source_name="refill-2.jpg",
        )
        third_task = make_task(
            room=quota_room,
            payload={"width": 320, "height": 240, "source_name": "refill-3.jpg"},
            source_type=Task.SourceType.IMAGE,
            source_name="refill-3.jpg",
        )
        payload = {
            "result_payload": {
                "annotations": [
                    {
                        "type": "bbox",
                        "label_id": label.id,
                        "points": [10, 10, 120, 120],
                        "frame": 0,
                        "attributes": [],
                        "occluded": False,
                    }
                ]
            }
        }

        self.client.get(reverse("room-next-task", kwargs={"room_id": quota_room.id}), **self.auth(self.annotator))
        self.client.post(reverse("task-skip", kwargs={"task_id": first_task.id}), format="json", **self.auth(self.annotator))
        self.client.get(reverse("room-next-task", kwargs={"room_id": quota_room.id}), **self.auth(self.annotator))
        self.client.post(reverse("task-skip", kwargs={"task_id": second_task.id}), format="json", **self.auth(self.annotator))

        other_next = self.client.get(reverse("room-next-task", kwargs={"room_id": quota_room.id}), **self.auth(self.other_annotator))
        other_submit = self.client.post(
            reverse("task-submit", kwargs={"task_id": first_task.id}),
            payload,
            format="json",
            **self.auth(self.other_annotator),
        )
        refill_next = self.client.get(reverse("room-next-task", kwargs={"room_id": quota_room.id}), **self.auth(self.annotator))

        self.assertEqual(other_next.status_code, status.HTTP_200_OK)
        self.assertEqual(other_next.data["id"], first_task.id)
        self.assertEqual(other_submit.status_code, status.HTTP_201_CREATED)
        self.assertEqual(refill_next.status_code, status.HTTP_200_OK)
        self.assertEqual(refill_next.data["id"], third_task.id)

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

    def test_annotator_can_list_and_update_own_submitted_annotation_before_task_is_finalized(self):
        cross_room = make_room(
            customer=self.customer,
            title="Editable cross room",
            cross_validation_enabled=True,
            cross_validation_annotators_count=2,
            cross_validation_similarity_threshold=80,
            owner_is_annotator=False,
        )
        invite_annotator(room=cross_room, annotator=self.annotator, invited_by=self.customer, joined=True)
        invite_annotator(room=cross_room, annotator=self.other_annotator, invited_by=self.customer, joined=True)
        task = make_task(room=cross_room, payload={"text": "editable sample"})

        self.client.get(reverse("room-next-task", kwargs={"room_id": cross_room.id}), **self.auth(self.annotator))
        first_submit = self.client.post(
            reverse("task-submit", kwargs={"task_id": task.id}),
            {"result_payload": {"label": "positive"}},
            format="json",
            **self.auth(self.annotator),
        )

        self.assertEqual(first_submit.status_code, status.HTTP_201_CREATED)

        list_response = self.client.get(
            reverse("room-submitted-mine", kwargs={"room_id": cross_room.id}),
            **self.auth(self.annotator),
        )
        detail_response = self.client.get(
            reverse("task-my-submission", kwargs={"task_id": task.id}),
            **self.auth(self.annotator),
        )
        update_response = self.client.put(
            reverse("task-my-submission", kwargs={"task_id": task.id}),
            {"result_payload": {"label": "negative"}},
            format="json",
            **self.auth(self.annotator),
        )

        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(list_response.data), 1)
        self.assertEqual(list_response.data[0]["id"], task.id)
        self.assertTrue(list_response.data[0]["editable"])
        self.assertEqual(detail_response.status_code, status.HTTP_200_OK)
        self.assertTrue(detail_response.data["editable"])
        self.assertEqual(update_response.status_code, status.HTTP_200_OK)
        self.assertEqual(update_response.data["annotation"]["result_payload"], {"label": "negative"})

        annotation = Annotation.objects.get(task=task, annotator=self.annotator)
        self.assertEqual(annotation.result_payload, {"label": "negative"})

    def test_finalized_submitted_annotation_becomes_read_only_without_revision(self):
        self.client.get(reverse("room-next-task", kwargs={"room_id": self.room.id}), **self.auth(self.annotator))
        submit_response = self.client.post(
            reverse("task-submit", kwargs={"task_id": self.task_1.id}),
            {"result_payload": {"label": "final"}},
            format="json",
            **self.auth(self.annotator),
        )
        self.assertEqual(submit_response.status_code, status.HTTP_201_CREATED)

        detail_response = self.client.get(
            reverse("task-my-submission", kwargs={"task_id": self.task_1.id}),
            **self.auth(self.annotator),
        )
        update_response = self.client.put(
            reverse("task-my-submission", kwargs={"task_id": self.task_1.id}),
            {"result_payload": {"label": "changed"}},
            format="json",
            **self.auth(self.annotator),
        )

        self.assertEqual(detail_response.status_code, status.HTTP_200_OK)
        self.assertFalse(detail_response.data["editable"])
        self.assertEqual(update_response.status_code, status.HTTP_409_CONFLICT)

    def test_reviewer_can_return_final_task_to_specific_annotator_for_revision(self):
        cross_room = make_room(
            customer=self.customer,
            title="Revision room",
            cross_validation_enabled=True,
            cross_validation_annotators_count=2,
            cross_validation_similarity_threshold=80,
            owner_is_annotator=False,
        )
        invite_annotator(room=cross_room, annotator=self.annotator, invited_by=self.customer, joined=True)
        invite_annotator(room=cross_room, annotator=self.other_annotator, invited_by=self.customer, joined=True)
        task = make_task(room=cross_room, payload={"text": "revision sample"})

        first_next = self.client.get(
            reverse("room-next-task", kwargs={"room_id": cross_room.id}),
            **self.auth(self.annotator),
        )
        first_submit = self.client.post(
            reverse("task-submit", kwargs={"task_id": task.id}),
            {"result_payload": {"label": "positive"}},
            format="json",
            **self.auth(self.annotator),
        )
        second_next = self.client.get(
            reverse("room-next-task", kwargs={"room_id": cross_room.id}),
            **self.auth(self.other_annotator),
        )
        second_submit = self.client.post(
            reverse("task-submit", kwargs={"task_id": task.id}),
            {"result_payload": {"label": "positive"}},
            format="json",
            **self.auth(self.other_annotator),
        )

        self.assertEqual(first_next.status_code, status.HTTP_200_OK)
        self.assertEqual(first_next.data["id"], task.id)
        self.assertEqual(first_submit.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second_next.status_code, status.HTTP_200_OK)
        self.assertEqual(second_next.data["id"], task.id)
        self.assertEqual(second_submit.status_code, status.HTTP_201_CREATED)

        task.refresh_from_db()
        self.assertEqual(task.status, Task.Status.SUBMITTED)

        return_response = self.client.post(
            reverse("task-return-for-revision", kwargs={"task_id": task.id}),
            {"annotator_id": self.annotator.id},
            format="json",
            **self.auth(self.customer),
        )

        self.assertEqual(return_response.status_code, status.HTTP_200_OK)
        task.refresh_from_db()
        self.assertEqual(task.status, Task.Status.IN_PROGRESS)
        self.assertEqual(task.current_round, 2)
        self.assertIsNone(task.consensus_payload)
        self.assertIsNone(task.validation_score)
        self.assertEqual(task.input_payload["revision_target_annotator_id"], self.annotator.id)
        self.assertTrue(
            TaskAssignment.objects.filter(
                task=task,
                annotator=self.annotator,
                round_number=2,
                status=TaskAssignment.Status.IN_PROGRESS,
            ).exists()
        )

        annotator_next = self.client.get(
            reverse("room-next-task", kwargs={"room_id": cross_room.id}),
            **self.auth(self.annotator),
        )
        other_next = self.client.get(
            reverse("room-next-task", kwargs={"room_id": cross_room.id}),
            **self.auth(self.other_annotator),
        )

        self.assertEqual(annotator_next.status_code, status.HTTP_200_OK)
        self.assertEqual(annotator_next.data["id"], task.id)
        self.assertEqual(other_next.status_code, status.HTTP_204_NO_CONTENT)

    def test_returned_cross_validation_task_reenters_normal_consensus_round(self):
        cross_room = make_room(
            customer=self.customer,
            title="Revision consensus room",
            cross_validation_enabled=True,
            cross_validation_annotators_count=2,
            cross_validation_similarity_threshold=80,
            owner_is_annotator=False,
        )
        invite_annotator(room=cross_room, annotator=self.annotator, invited_by=self.customer, joined=True)
        invite_annotator(room=cross_room, annotator=self.other_annotator, invited_by=self.customer, joined=True)
        task = make_task(room=cross_room, payload={"text": "revision consensus sample"})

        first_next = self.client.get(
            reverse("room-next-task", kwargs={"room_id": cross_room.id}),
            **self.auth(self.annotator),
        )
        first_submit = self.client.post(
            reverse("task-submit", kwargs={"task_id": task.id}),
            {"result_payload": {"label": "positive"}},
            format="json",
            **self.auth(self.annotator),
        )
        second_next = self.client.get(
            reverse("room-next-task", kwargs={"room_id": cross_room.id}),
            **self.auth(self.other_annotator),
        )
        second_submit = self.client.post(
            reverse("task-submit", kwargs={"task_id": task.id}),
            {"result_payload": {"label": "positive"}},
            format="json",
            **self.auth(self.other_annotator),
        )

        self.assertEqual(first_next.status_code, status.HTTP_200_OK)
        self.assertEqual(first_next.data["id"], task.id)
        self.assertEqual(first_submit.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second_next.status_code, status.HTTP_200_OK)
        self.assertEqual(second_next.data["id"], task.id)
        self.assertEqual(second_submit.status_code, status.HTTP_201_CREATED)

        return_response = self.client.post(
            reverse("task-return-for-revision", kwargs={"task_id": task.id}),
            {"annotator_id": self.annotator.id},
            format="json",
            **self.auth(self.customer),
        )
        self.assertEqual(return_response.status_code, status.HTTP_200_OK)

        first_revision_submit = self.client.post(
            reverse("task-submit", kwargs={"task_id": task.id}),
            {"result_payload": {"label": "positive"}},
            format="json",
            **self.auth(self.annotator),
        )

        self.assertEqual(first_revision_submit.status_code, status.HTTP_201_CREATED)
        task.refresh_from_db()
        self.assertEqual(task.status, Task.Status.IN_PROGRESS)
        self.assertEqual(task.current_round, 2)
        self.assertNotIn("revision_target_annotator_id", task.input_payload)

        second_round_next = self.client.get(
            reverse("room-next-task", kwargs={"room_id": cross_room.id}),
            **self.auth(self.other_annotator),
        )
        self.assertEqual(second_round_next.status_code, status.HTTP_200_OK)
        self.assertEqual(second_round_next.data["id"], task.id)

        second_revision_submit = self.client.post(
            reverse("task-submit", kwargs={"task_id": task.id}),
            {"result_payload": {"label": "positive"}},
            format="json",
            **self.auth(self.other_annotator),
        )

        self.assertEqual(second_revision_submit.status_code, status.HTTP_201_CREATED)
        task.refresh_from_db()
        self.assertEqual(task.status, Task.Status.SUBMITTED)

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

    def test_incomplete_cross_validation_review_hides_consensus_and_reject_all(self):
        review_room = make_room(
            customer=self.customer,
            title="Incomplete review room",
            dataset_type="image",
            cross_validation_enabled=True,
            cross_validation_annotators_count=2,
            owner_is_annotator=False,
        )
        invite_annotator(room=review_room, annotator=self.annotator, invited_by=self.customer, joined=True)
        invite_annotator(room=review_room, annotator=self.other_annotator, invited_by=self.customer, joined=True)
        label = review_room.labels.create(name="car", color="#FF6B6B", sort_order=0)
        task = make_task(
            room=review_room,
            payload={"width": 640, "height": 480, "source_name": "incomplete.jpg"},
            source_type=Task.SourceType.IMAGE,
            source_name="incomplete.jpg",
        )

        self.client.get(reverse("room-next-task", kwargs={"room_id": review_room.id}), **self.auth(self.annotator))
        submit_response = self.client.post(
            reverse("task-submit", kwargs={"task_id": task.id}),
            {
                "result_payload": {
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
                }
            },
            format="json",
            **self.auth(self.annotator),
        )
        final_list_response = self.client.get(
            reverse("room-review-tasks", kwargs={"room_id": review_room.id}),
            {"filter": "final"},
            **self.auth(self.customer),
        )
        incomplete_list_response = self.client.get(
            reverse("room-review-tasks", kwargs={"room_id": review_room.id}),
            {"filter": "incomplete"},
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
        return_response = self.client.post(
            reverse("task-return-for-revision", kwargs={"task_id": task.id}),
            {"annotator_id": self.annotator.id},
            format="json",
            **self.auth(self.customer),
        )

        self.assertEqual(submit_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(final_list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(final_list_response.data, [])
        self.assertEqual(incomplete_list_response.status_code, status.HTTP_200_OK)
        self.assertEqual([item["id"] for item in incomplete_list_response.data], [task.id])
        self.assertEqual(detail_response.status_code, status.HTTP_200_OK)
        self.assertFalse(detail_response.data["consensus_available"])
        self.assertFalse(detail_response.data["can_reject_all"])
        self.assertIsNone(detail_response.data["consensus_payload"])
        self.assertEqual(detail_response.data["review_outcome"], "incomplete")
        self.assertEqual(detail_response.data["submitted_annotations_count"], 1)
        self.assertEqual(detail_response.data["required_annotations_count"], 2)
        self.assertEqual(reject_response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(return_response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            TaskAssignment.objects.get(task=task, annotator=self.annotator, round_number=1).status,
            TaskAssignment.Status.IN_PROGRESS,
        )
        self.assertFalse(Annotation.objects.filter(task=task, annotator=self.annotator).exists())

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

    def test_detect_text_workflow_creates_transcription_stage_for_different_executor(self):
        detect_room = make_room(
            customer=self.customer,
            title="Detect + text room",
            dataset_type="image",
            annotation_workflow="text_detect_text",
        )
        detect_label = detect_room.labels.create(name="text", color="#FFC919", sort_order=0)
        invite_annotator(room=detect_room, annotator=self.annotator, invited_by=self.customer, joined=True)
        invite_annotator(room=detect_room, annotator=self.other_annotator, invited_by=self.customer, joined=True)
        detect_task = make_task(
            room=detect_room,
            payload={"width": 640, "height": 480, "source_name": "ocr-1.jpg"},
            source_type=Task.SourceType.IMAGE,
            source_name="ocr-1.jpg",
            workflow_stage=Task.WorkflowStage.TEXT_DETECTION,
        )

        first_response = self.client.get(
            reverse("room-next-task", kwargs={"room_id": detect_room.id}),
            **self.auth(self.annotator),
        )
        self.assertEqual(first_response.status_code, status.HTTP_200_OK)
        self.assertEqual(first_response.data["id"], detect_task.id)
        self.assertEqual(first_response.data["workflow_stage"], Task.WorkflowStage.TEXT_DETECTION)

        submit_detection = self.client.post(
            reverse("task-submit", kwargs={"task_id": detect_task.id}),
            {
                "result_payload": {
                    "annotations": [
                        {
                            "type": "bbox",
                            "label_id": detect_label.id,
                            "points": [20, 30, 220, 120],
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
        self.assertEqual(submit_detection.status_code, status.HTTP_201_CREATED)

        detect_task.refresh_from_db()
        self.assertEqual(detect_task.status, Task.Status.SUBMITTED)

        transcription_task = Task.objects.get(parent_task=detect_task, workflow_stage=Task.WorkflowStage.TEXT_TRANSCRIPTION)
        self.assertEqual(transcription_task.status, Task.Status.PENDING)
        self.assertEqual(
            transcription_task.input_payload["excluded_annotator_ids"],
            [self.annotator.id],
        )

        same_annotator_response = self.client.get(
            reverse("room-next-task", kwargs={"room_id": detect_room.id}),
            **self.auth(self.annotator),
        )
        self.assertEqual(same_annotator_response.status_code, status.HTTP_204_NO_CONTENT)

        transcription_response = self.client.get(
            reverse("room-next-task", kwargs={"room_id": detect_room.id}),
            **self.auth(self.other_annotator),
        )
        self.assertEqual(transcription_response.status_code, status.HTTP_200_OK)
        self.assertEqual(transcription_response.data["id"], transcription_task.id)
        self.assertEqual(transcription_response.data["workflow_stage"], Task.WorkflowStage.TEXT_TRANSCRIPTION)

        submit_text = self.client.post(
            reverse("task-submit", kwargs={"task_id": transcription_task.id}),
            {
                "result_payload": {
                    "annotations": [
                        {
                            "type": "bbox",
                            "label_id": detect_label.id,
                            "points": [20, 30, 220, 120],
                            "frame": 0,
                            "attributes": [],
                            "occluded": False,
                            "text": "Пример текста",
                        }
                    ]
                }
            },
            format="json",
            **self.auth(self.other_annotator),
        )

        self.assertEqual(submit_text.status_code, status.HTTP_201_CREATED)
        transcription_task.refresh_from_db()
        self.assertEqual(transcription_task.status, Task.Status.SUBMITTED)
        self.assertEqual(
            transcription_task.consensus_payload["annotations"][0]["text"],
            "Пример текста",
        )

    def test_detect_text_workflow_can_return_to_same_executor_when_only_one_actor_can_annotate(self):
        detect_room = make_room(
            customer=self.customer,
            title="Detect + text owner room",
            dataset_type="image",
            annotation_workflow="text_detect_text",
        )
        detect_label = detect_room.labels.create(name="text", color="#FFC919", sort_order=0)
        detect_task = make_task(
            room=detect_room,
            payload={"width": 640, "height": 480, "source_name": "ocr-owner.jpg"},
            source_type=Task.SourceType.IMAGE,
            source_name="ocr-owner.jpg",
            workflow_stage=Task.WorkflowStage.TEXT_DETECTION,
        )

        first_response = self.client.get(
            reverse("room-next-task", kwargs={"room_id": detect_room.id}),
            **self.auth(self.customer),
        )
        self.assertEqual(first_response.status_code, status.HTTP_200_OK)
        self.assertEqual(first_response.data["id"], detect_task.id)

        submit_detection = self.client.post(
            reverse("task-submit", kwargs={"task_id": detect_task.id}),
            {
                "result_payload": {
                    "annotations": [
                        {
                            "type": "bbox",
                            "label_id": detect_label.id,
                            "points": [30, 40, 260, 140],
                            "frame": 0,
                            "attributes": [],
                            "occluded": False,
                        }
                    ]
                }
            },
            format="json",
            **self.auth(self.customer),
        )
        self.assertEqual(submit_detection.status_code, status.HTTP_201_CREATED)

        transcription_task = Task.objects.get(parent_task=detect_task, workflow_stage=Task.WorkflowStage.TEXT_TRANSCRIPTION)
        self.assertEqual(transcription_task.input_payload["excluded_annotator_ids"], [])

        transcription_response = self.client.get(
            reverse("room-next-task", kwargs={"room_id": detect_room.id}),
            **self.auth(self.customer),
        )
        self.assertEqual(transcription_response.status_code, status.HTTP_200_OK)
        self.assertEqual(transcription_response.data["id"], transcription_task.id)
        self.assertEqual(transcription_response.data["workflow_stage"], Task.WorkflowStage.TEXT_TRANSCRIPTION)
