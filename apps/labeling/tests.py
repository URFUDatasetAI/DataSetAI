from types import SimpleNamespace

from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from apps.labeling.consensus import evaluate_annotation_consensus
from apps.labeling.distribution import get_task_designated_annotator_ids
from apps.labeling.models import Annotation, Task, TaskAssignment
from apps.labeling.services import get_next_task_for_annotator, reject_task_annotation, submit_annotation
from apps.rooms.models import Room, RoomMembership
from apps.users.models import User


class LabelingConsensusAndDistributionTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(email="owner@example.com", full_name="Owner", password="secret123")

    def test_close_media_annotations_are_merged_into_consensus_payload(self):
        payload_left = {
            "annotations": [
                {
                    "type": "bbox",
                    "label_id": 1,
                    "points": [10, 10, 110, 110],
                    "frame": 0,
                    "attributes": [],
                    "occluded": False,
                }
            ]
        }
        payload_right = {
            "annotations": [
                {
                    "type": "bbox",
                    "label_id": 1,
                    "points": [14, 14, 114, 114],
                    "frame": 0,
                    "attributes": [],
                    "occluded": False,
                }
            ]
        }

        result = evaluate_annotation_consensus(
            annotations=[
                SimpleNamespace(result_payload=payload_left),
                SimpleNamespace(result_payload=payload_right),
            ],
            similarity_threshold=60,
        )

        self.assertTrue(result["accepted"])
        self.assertIsNotNone(result["consensus_payload"])
        self.assertEqual(len(result["consensus_payload"]["annotations"]), 1)
        self.assertEqual(result["consensus_payload"]["annotations"][0]["points"], [12.0, 12.0, 112.0, 112.0])

    def test_distant_media_annotations_are_sent_to_repeat_round(self):
        payload_left = {
            "annotations": [
                {
                    "type": "bbox",
                    "label_id": 1,
                    "points": [10, 10, 60, 60],
                    "frame": 0,
                    "attributes": [],
                    "occluded": False,
                }
            ]
        }
        payload_right = {
            "annotations": [
                {
                    "type": "bbox",
                    "label_id": 1,
                    "points": [210, 210, 260, 260],
                    "frame": 0,
                    "attributes": [],
                    "occluded": False,
                }
            ]
        }

        result = evaluate_annotation_consensus(
            annotations=[
                SimpleNamespace(result_payload=payload_left),
                SimpleNamespace(result_payload=payload_right),
            ],
            similarity_threshold=60,
        )

        self.assertFalse(result["accepted"])
        self.assertIsNone(result["consensus_payload"])

    def test_media_consensus_interpolates_missing_frames(self):
        payload_left = {
            "annotations": [
                {
                    "type": "bbox",
                    "label_id": 1,
                    "points": [10, 10, 30, 30],
                    "frame": 0,
                    "attributes": [],
                    "occluded": False,
                },
                {
                    "type": "bbox",
                    "label_id": 1,
                    "points": [20, 20, 40, 40],
                    "frame": 2,
                    "attributes": [],
                    "occluded": False,
                },
            ]
        }
        payload_right = {
            "annotations": [
                {
                    "type": "bbox",
                    "label_id": 1,
                    "points": [12, 12, 32, 32],
                    "frame": 0,
                    "attributes": [],
                    "occluded": False,
                },
                {
                    "type": "bbox",
                    "label_id": 1,
                    "points": [22, 22, 42, 42],
                    "frame": 2,
                    "attributes": [],
                    "occluded": False,
                },
            ]
        }

        result = evaluate_annotation_consensus(
            annotations=[
                SimpleNamespace(result_payload=payload_left),
                SimpleNamespace(result_payload=payload_right),
            ],
            similarity_threshold=60,
        )

        self.assertTrue(result["accepted"])
        frames = [annotation["frame"] for annotation in result["consensus_payload"]["annotations"]]
        self.assertEqual(frames, [0, 1, 2])

    def test_distribution_evenly_splits_dataset_between_annotators(self):
        room = Room.objects.create(
            title="Balanced room",
            created_by=self.owner,
            cross_validation_enabled=True,
            cross_validation_annotators_count=2,
        )
        annotators = [
            User.objects.create_user(email=f"annotator{index}@example.com", full_name=f"Annotator {index}", password="secret123")
            for index in range(6)
        ]
        for annotator in annotators:
            RoomMembership.objects.create(
                room=room,
                user=annotator,
                invited_by=self.owner,
                status=RoomMembership.Status.JOINED,
                role=RoomMembership.Role.ANNOTATOR,
            )

        tasks = [
            Task.objects.create(
                room=room,
                source_type=Task.SourceType.TEXT,
                input_payload={"dataset": "Balanced", "item_number": index + 1, "text": f"Task #{index + 1}"},
            )
            for index in range(100)
        ]

        task_counts = {annotator.id: 0 for annotator in annotators}
        for task in tasks:
            designated_annotator_ids = get_task_designated_annotator_ids(task=task)
            self.assertEqual(len(designated_annotator_ids), 2)
            self.assertEqual(len(set(designated_annotator_ids)), 2)
            for annotator_id in designated_annotator_ids:
                task_counts[annotator_id] += 1

        counts = list(task_counts.values())
        self.assertEqual(sum(counts), 200)
        self.assertLessEqual(max(counts) - min(counts), 1)

    def test_cross_validation_single_group_assigns_every_task_to_both_annotators(self):
        room = Room.objects.create(
            title="Single group room",
            created_by=self.owner,
            cross_validation_enabled=True,
            cross_validation_annotators_count=2,
        )
        annotators = [
            User.objects.create_user(
                email=f"single-group-{index}@example.com",
                full_name=f"Single Group {index}",
                password="secret123",
            )
            for index in range(1, 3)
        ]
        for annotator in annotators:
            RoomMembership.objects.create(
                room=room,
                user=annotator,
                invited_by=self.owner,
                status=RoomMembership.Status.JOINED,
                role=RoomMembership.Role.ANNOTATOR,
            )

        tasks = [
            Task.objects.create(
                room=room,
                source_type=Task.SourceType.IMAGE,
                input_payload={"dataset": "Vision", "item_number": index + 1, "width": 400, "height": 400},
            )
            for index in range(4)
        ]

        expected_annotator_ids = {annotator.id for annotator in annotators}
        task_counts = {annotator.id: 0 for annotator in annotators}
        for task in tasks:
            designated_annotator_ids = get_task_designated_annotator_ids(task=task)
            self.assertEqual(set(designated_annotator_ids), expected_annotator_ids)
            for annotator_id in designated_annotator_ids:
                task_counts[annotator_id] += 1

        self.assertEqual(task_counts, {annotator.id: 4 for annotator in annotators})

    def test_cross_validation_single_group_next_task_flow_gives_every_task_to_both_annotators(self):
        room = Room.objects.create(
            title="Single group assignment flow",
            created_by=self.owner,
            cross_validation_enabled=True,
            cross_validation_annotators_count=2,
            cross_validation_similarity_threshold=60,
        )
        first_annotator = User.objects.create_user(
            email="single-flow-1@example.com",
            full_name="Single Flow 1",
            password="secret123",
        )
        second_annotator = User.objects.create_user(
            email="single-flow-2@example.com",
            full_name="Single Flow 2",
            password="secret123",
        )
        for annotator in (first_annotator, second_annotator):
            RoomMembership.objects.create(
                room=room,
                user=annotator,
                invited_by=self.owner,
                status=RoomMembership.Status.JOINED,
                role=RoomMembership.Role.ANNOTATOR,
            )

        tasks = [
            Task.objects.create(
                room=room,
                source_type=Task.SourceType.IMAGE,
                input_payload={"dataset": "Vision", "item_number": index + 1, "width": 400, "height": 400},
            )
            for index in range(4)
        ]

        first_seen_task_ids: list[int] = []
        second_seen_task_ids: list[int] = []
        for index in range(4):
            first_task = get_next_task_for_annotator(room=room, annotator=first_annotator)
            second_task = get_next_task_for_annotator(room=room, annotator=second_annotator)
            self.assertIsNotNone(first_task)
            self.assertIsNotNone(second_task)
            self.assertEqual(first_task.id, second_task.id)
            first_seen_task_ids.append(first_task.id)
            second_seen_task_ids.append(second_task.id)
            submit_annotation(
                task=first_task,
                annotator=first_annotator,
                result_payload={
                    "annotations": [
                        {
                            "type": "bbox",
                            "label_id": 1,
                            "points": [10 + index, 10 + index, 80 + index, 80 + index],
                            "frame": 0,
                            "attributes": [],
                            "occluded": False,
                        }
                    ]
                },
            )
            submit_annotation(
                task=second_task,
                annotator=second_annotator,
                result_payload={
                    "annotations": [
                        {
                            "type": "bbox",
                            "label_id": 1,
                            "points": [12 + index, 12 + index, 82 + index, 82 + index],
                            "frame": 0,
                            "attributes": [],
                            "occluded": False,
                        }
                    ]
                },
            )

        expected_task_ids = [task.id for task in tasks]
        self.assertEqual(first_seen_task_ids, expected_task_ids)
        self.assertEqual(second_seen_task_ids, expected_task_ids)

    def test_cross_validation_divides_tasks_between_groups(self):
        room = Room.objects.create(
            title="Grouped room",
            created_by=self.owner,
            cross_validation_enabled=True,
            cross_validation_annotators_count=2,
        )
        annotators = [
            User.objects.create_user(
                email=f"grouped-{index}@example.com",
                full_name=f"Grouped {index}",
                password="secret123",
            )
            for index in range(1, 5)
        ]
        for annotator in annotators:
            RoomMembership.objects.create(
                room=room,
                user=annotator,
                invited_by=self.owner,
                status=RoomMembership.Status.JOINED,
                role=RoomMembership.Role.ANNOTATOR,
            )

        tasks = [
            Task.objects.create(
                room=room,
                source_type=Task.SourceType.IMAGE,
                input_payload={"dataset": "Vision", "item_number": index + 1, "width": 400, "height": 400},
            )
            for index in range(4)
        ]

        task_counts = {annotator.id: 0 for annotator in annotators}
        designated_groups = []
        for task in tasks:
            designated_annotator_ids = get_task_designated_annotator_ids(task=task)
            self.assertEqual(len(designated_annotator_ids), 2)
            self.assertEqual(len(set(designated_annotator_ids)), 2)
            designated_groups.append(tuple(sorted(designated_annotator_ids)))
            for annotator_id in designated_annotator_ids:
                task_counts[annotator_id] += 1

        self.assertEqual(len(set(designated_groups)), 2)
        self.assertEqual(sorted(task_counts.values()), [2, 2, 2, 2])

    def test_repeat_round_reuses_annotators_when_pool_is_exhausted(self):
        room = Room.objects.create(
            title="Consensus room",
            created_by=self.owner,
            cross_validation_enabled=True,
            cross_validation_annotators_count=2,
            cross_validation_similarity_threshold=80,
        )
        first_annotator = User.objects.create_user(
            email="annotator1@example.com",
            full_name="Annotator 1",
            password="secret123",
        )
        second_annotator = User.objects.create_user(
            email="annotator2@example.com",
            full_name="Annotator 2",
            password="secret123",
        )
        for annotator in (first_annotator, second_annotator):
            RoomMembership.objects.create(
                room=room,
                user=annotator,
                invited_by=self.owner,
                status=RoomMembership.Status.JOINED,
                role=RoomMembership.Role.ANNOTATOR,
            )

        task = Task.objects.create(
            room=room,
            source_type=Task.SourceType.IMAGE,
            input_payload={"dataset": "Vision", "item_number": 1, "width": 400, "height": 400},
        )

        self.assertEqual(get_next_task_for_annotator(room=room, annotator=first_annotator).id, task.id)
        self.assertEqual(get_next_task_for_annotator(room=room, annotator=second_annotator).id, task.id)
        self.assertEqual(
            TaskAssignment.objects.filter(task=task, round_number=1).values_list("annotator_id", flat=True).count(),
            2,
        )

        submit_annotation(
            task=task,
            annotator=first_annotator,
            result_payload={
                "annotations": [
                    {
                        "type": "bbox",
                        "label_id": 1,
                        "points": [10, 10, 80, 80],
                        "frame": 0,
                        "attributes": [],
                        "occluded": False,
                    }
                ]
            },
        )
        submit_annotation(
            task=task,
            annotator=second_annotator,
            result_payload={
                "annotations": [
                    {
                        "type": "bbox",
                        "label_id": 1,
                        "points": [200, 200, 280, 280],
                        "frame": 0,
                        "attributes": [],
                        "occluded": False,
                    }
                ]
            },
        )

        task.refresh_from_db()
        self.assertEqual(task.status, Task.Status.PENDING)
        self.assertEqual(task.current_round, 2)

        round_two_first = get_next_task_for_annotator(room=room, annotator=first_annotator)
        round_two_second = get_next_task_for_annotator(room=room, annotator=second_annotator)
        self.assertEqual(round_two_first.id, task.id)
        self.assertEqual(round_two_second.id, task.id)
        self.assertEqual(
            list(
                TaskAssignment.objects.filter(task=task, round_number=2)
                .order_by("annotator_id")
                .values_list("annotator_id", flat=True)
            ),
            [first_annotator.id, second_annotator.id],
        )

    def test_repeat_round_keeps_same_group_when_room_has_more_annotators(self):
        room = Room.objects.create(
            title="Grouped consensus room",
            created_by=self.owner,
            cross_validation_enabled=True,
            cross_validation_annotators_count=2,
            cross_validation_similarity_threshold=80,
        )
        annotators = [
            User.objects.create_user(
                email=f"group-annotator{index}@example.com",
                full_name=f"Group Annotator {index}",
                password="secret123",
            )
            for index in range(1, 5)
        ]
        for annotator in annotators:
            RoomMembership.objects.create(
                room=room,
                user=annotator,
                invited_by=self.owner,
                status=RoomMembership.Status.JOINED,
                role=RoomMembership.Role.ANNOTATOR,
            )

        task = Task.objects.create(
            room=room,
            source_type=Task.SourceType.IMAGE,
            input_payload={"dataset": "Vision", "item_number": 1, "width": 400, "height": 400},
        )

        first_round_annotator_ids = []
        for annotator in annotators:
            assigned_task = get_next_task_for_annotator(room=room, annotator=annotator)
            if assigned_task is not None:
                self.assertEqual(assigned_task.id, task.id)
                first_round_annotator_ids.append(annotator.id)

        self.assertEqual(len(first_round_annotator_ids), 2)

        for index, annotator_id in enumerate(first_round_annotator_ids):
            annotator = next(item for item in annotators if item.id == annotator_id)
            result_payload = {
                "annotations": [
                    {
                        "type": "bbox",
                        "label_id": 1,
                        "points": [10, 10, 80, 80] if index == 0 else [220, 220, 300, 300],
                        "frame": 0,
                        "attributes": [],
                        "occluded": False,
                    }
                ]
            }
            submit_annotation(task=task, annotator=annotator, result_payload=result_payload)

        task.refresh_from_db()
        self.assertEqual(task.status, Task.Status.PENDING)
        self.assertEqual(task.current_round, 2)

        second_round_annotator_ids = []
        for annotator in annotators:
            assigned_task = get_next_task_for_annotator(room=room, annotator=annotator)
            if assigned_task is not None:
                self.assertEqual(assigned_task.id, task.id)
                second_round_annotator_ids.append(annotator.id)

        self.assertEqual(sorted(second_round_annotator_ids), sorted(first_round_annotator_ids))

    def test_reject_task_annotation_deletes_rejected_round_annotations(self):
        room = Room.objects.create(
            title="Review room",
            created_by=self.owner,
            cross_validation_enabled=True,
            cross_validation_annotators_count=2,
            cross_validation_similarity_threshold=60,
        )
        first_annotator = User.objects.create_user(
            email="review-annotator1@example.com",
            full_name="Review Annotator 1",
            password="secret123",
        )
        second_annotator = User.objects.create_user(
            email="review-annotator2@example.com",
            full_name="Review Annotator 2",
            password="secret123",
        )
        for annotator in (first_annotator, second_annotator):
            RoomMembership.objects.create(
                room=room,
                user=annotator,
                invited_by=self.owner,
                status=RoomMembership.Status.JOINED,
                role=RoomMembership.Role.ANNOTATOR,
            )

        task = Task.objects.create(
            room=room,
            source_type=Task.SourceType.IMAGE,
            input_payload={"dataset": "Vision", "item_number": 1, "width": 400, "height": 400},
        )

        self.assertEqual(get_next_task_for_annotator(room=room, annotator=first_annotator).id, task.id)
        self.assertEqual(get_next_task_for_annotator(room=room, annotator=second_annotator).id, task.id)

        close_payload_left = {
            "annotations": [
                {
                    "type": "bbox",
                    "label_id": 1,
                    "points": [10, 10, 80, 80],
                    "frame": 0,
                    "attributes": [],
                    "occluded": False,
                }
            ]
        }
        close_payload_right = {
            "annotations": [
                {
                    "type": "bbox",
                    "label_id": 1,
                    "points": [12, 12, 82, 82],
                    "frame": 0,
                    "attributes": [],
                    "occluded": False,
                }
            ]
        }

        submit_annotation(task=task, annotator=first_annotator, result_payload=close_payload_left)
        submit_annotation(task=task, annotator=second_annotator, result_payload=close_payload_right)

        task.refresh_from_db()
        self.assertEqual(task.status, Task.Status.SUBMITTED)
        self.assertEqual(task.annotations.count(), 2)
        self.assertEqual(TaskAssignment.objects.filter(task=task, round_number=1).count(), 2)

        reject_task_annotation(task=task, reviewer=self.owner)

        task.refresh_from_db()
        self.assertEqual(task.status, Task.Status.PENDING)
        self.assertEqual(task.current_round, 2)
        self.assertEqual(task.annotations.count(), 0)
        self.assertEqual(TaskAssignment.objects.filter(task=task, round_number=1).count(), 0)

    def test_accepted_consensus_removes_old_rejected_round_annotations(self):
        room = Room.objects.create(
            title="Accepted cleanup room",
            created_by=self.owner,
            cross_validation_enabled=True,
            cross_validation_annotators_count=2,
            cross_validation_similarity_threshold=60,
        )
        first_annotator = User.objects.create_user(
            email="cleanup-annotator1@example.com",
            full_name="Cleanup Annotator 1",
            password="secret123",
        )
        second_annotator = User.objects.create_user(
            email="cleanup-annotator2@example.com",
            full_name="Cleanup Annotator 2",
            password="secret123",
        )
        for annotator in (first_annotator, second_annotator):
            RoomMembership.objects.create(
                room=room,
                user=annotator,
                invited_by=self.owner,
                status=RoomMembership.Status.JOINED,
                role=RoomMembership.Role.ANNOTATOR,
            )

        task = Task.objects.create(
            room=room,
            source_type=Task.SourceType.IMAGE,
            input_payload={"dataset": "Vision", "item_number": 1, "width": 400, "height": 400},
        )

        get_next_task_for_annotator(room=room, annotator=first_annotator)
        get_next_task_for_annotator(room=room, annotator=second_annotator)

        submit_annotation(
            task=task,
            annotator=first_annotator,
            result_payload={
                "annotations": [
                    {
                        "type": "bbox",
                        "label_id": 1,
                        "points": [10, 10, 80, 80],
                        "frame": 0,
                        "attributes": [],
                        "occluded": False,
                    }
                ]
            },
        )
        submit_annotation(
            task=task,
            annotator=second_annotator,
            result_payload={
                "annotations": [
                    {
                        "type": "bbox",
                        "label_id": 1,
                        "points": [220, 220, 300, 300],
                        "frame": 0,
                        "attributes": [],
                        "occluded": False,
                    }
                ]
            },
        )

        task.refresh_from_db()
        self.assertEqual(task.status, Task.Status.PENDING)
        self.assertEqual(task.current_round, 2)
        self.assertEqual(task.annotations.count(), 2)

        get_next_task_for_annotator(room=room, annotator=first_annotator)
        get_next_task_for_annotator(room=room, annotator=second_annotator)

        submit_annotation(
            task=task,
            annotator=first_annotator,
            result_payload={
                "annotations": [
                    {
                        "type": "bbox",
                        "label_id": 1,
                        "points": [30, 30, 100, 100],
                        "frame": 0,
                        "attributes": [],
                        "occluded": False,
                    }
                ]
            },
        )
        submit_annotation(
            task=task,
            annotator=second_annotator,
            result_payload={
                "annotations": [
                    {
                        "type": "bbox",
                        "label_id": 1,
                        "points": [32, 32, 102, 102],
                        "frame": 0,
                        "attributes": [],
                        "occluded": False,
                    }
                ]
            },
        )

        task.refresh_from_db()
        self.assertEqual(task.status, Task.Status.SUBMITTED)
        self.assertEqual(task.current_round, 2)
        self.assertEqual(task.annotations.count(), 2)
        self.assertEqual(TaskAssignment.objects.filter(task=task).count(), 2)
        self.assertTrue(all(annotation.assignment.round_number == 2 for annotation in task.annotations.select_related("assignment")))


class LabelingReviewApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = User.objects.create_user(email="owner@example.com", full_name="Owner", password="secret123")
        self.client.force_authenticate(self.owner)
        self.room = Room.objects.create(title="Review room", created_by=self.owner)
        self.annotator = User.objects.create_user(
            email="annotator@example.com",
            full_name="Annotator",
            password="secret123",
        )
        RoomMembership.objects.create(
            room=self.room,
            user=self.annotator,
            invited_by=self.owner,
            status=RoomMembership.Status.JOINED,
            role=RoomMembership.Role.ANNOTATOR,
        )

    def test_review_list_includes_rejected_tasks_with_annotations(self):
        accepted_task = Task.objects.create(
            room=self.room,
            source_type=Task.SourceType.IMAGE,
            status=Task.Status.SUBMITTED,
            consensus_payload={"annotations": [{"type": "bbox", "label_id": 1, "points": [1, 1, 10, 10], "frame": 0}]},
            input_payload={"dataset": "Vision", "item_number": 1},
        )
        rejected_task = Task.objects.create(
            room=self.room,
            source_type=Task.SourceType.IMAGE,
            status=Task.Status.PENDING,
            current_round=2,
            input_payload={"dataset": "Vision", "item_number": 2},
        )

        accepted_assignment = TaskAssignment.objects.create(
            task=accepted_task,
            annotator=self.annotator,
            round_number=1,
            status=TaskAssignment.Status.SUBMITTED,
            assigned_at=accepted_task.created_at,
            submitted_at=accepted_task.created_at,
        )
        rejected_assignment = TaskAssignment.objects.create(
            task=rejected_task,
            annotator=self.annotator,
            round_number=1,
            status=TaskAssignment.Status.SUBMITTED,
            assigned_at=rejected_task.created_at,
            submitted_at=rejected_task.created_at,
        )
        Annotation.objects.create(
            task=accepted_task,
            assignment=accepted_assignment,
            annotator=self.annotator,
            result_payload={"annotations": [{"type": "bbox", "label_id": 1, "points": [1, 1, 10, 10], "frame": 0}]},
            submitted_at=accepted_task.created_at,
        )
        Annotation.objects.create(
            task=rejected_task,
            assignment=rejected_assignment,
            annotator=self.annotator,
            result_payload={"annotations": [{"type": "bbox", "label_id": 1, "points": [2, 2, 12, 12], "frame": 0}]},
            submitted_at=rejected_task.created_at,
        )

        response = self.client.get(f"/api/v1/rooms/{self.room.id}/review/tasks/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        tasks_by_id = {item["id"]: item for item in response.data}
        self.assertEqual(tasks_by_id[accepted_task.id]["review_outcome"], "accepted")
        self.assertEqual(tasks_by_id[rejected_task.id]["review_outcome"], "rejected")

    def test_review_detail_marks_pending_task_with_annotations_as_rejected(self):
        task = Task.objects.create(
            room=self.room,
            source_type=Task.SourceType.IMAGE,
            status=Task.Status.PENDING,
            current_round=2,
            input_payload={"dataset": "Vision", "item_number": 1},
        )
        assignment = TaskAssignment.objects.create(
            task=task,
            annotator=self.annotator,
            round_number=1,
            status=TaskAssignment.Status.SUBMITTED,
            assigned_at=task.created_at,
            submitted_at=task.created_at,
        )
        Annotation.objects.create(
            task=task,
            assignment=assignment,
            annotator=self.annotator,
            result_payload={"annotations": [{"type": "bbox", "label_id": 1, "points": [2, 2, 12, 12], "frame": 0}]},
            submitted_at=task.created_at,
        )

        response = self.client.get(f"/api/v1/tasks/{task.id}/review/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["review_outcome"], "rejected")
        self.assertTrue(all(item["review_outcome"] == "rejected" for item in response.data["annotations"]))

    def test_review_detail_marks_submitted_task_as_accepted(self):
        task = Task.objects.create(
            room=self.room,
            source_type=Task.SourceType.IMAGE,
            status=Task.Status.SUBMITTED,
            consensus_payload={"annotations": [{"type": "bbox", "label_id": 1, "points": [1, 1, 10, 10], "frame": 0}]},
            input_payload={"dataset": "Vision", "item_number": 3},
        )
        assignment = TaskAssignment.objects.create(
            task=task,
            annotator=self.annotator,
            round_number=1,
            status=TaskAssignment.Status.SUBMITTED,
            assigned_at=task.created_at,
            submitted_at=task.created_at,
        )
        Annotation.objects.create(
            task=task,
            assignment=assignment,
            annotator=self.annotator,
            result_payload={"annotations": [{"type": "bbox", "label_id": 1, "points": [1, 1, 10, 10], "frame": 0}]},
            submitted_at=task.created_at,
        )

        response = self.client.get(f"/api/v1/tasks/{task.id}/review/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["review_outcome"], "accepted")
        self.assertEqual(response.data["annotations"][0]["review_outcome"], "accepted")

    def test_review_detail_marks_each_annotation_by_consensus_match(self):
        self.room.cross_validation_similarity_threshold = 50
        self.room.save(update_fields=["cross_validation_similarity_threshold"])

        second_annotator = User.objects.create_user(
            email="annotator-second@example.com",
            full_name="Second Annotator",
            password="secret123",
        )
        RoomMembership.objects.create(
            room=self.room,
            user=second_annotator,
            invited_by=self.owner,
            status=RoomMembership.Status.JOINED,
            role=RoomMembership.Role.ANNOTATOR,
        )

        task = Task.objects.create(
            room=self.room,
            source_type=Task.SourceType.IMAGE,
            status=Task.Status.SUBMITTED,
            consensus_payload={"annotations": [{"type": "bbox", "label_id": 1, "points": [10, 10, 110, 110], "frame": 0}]},
            input_payload={"dataset": "Vision", "item_number": 5},
        )
        accepted_assignment = TaskAssignment.objects.create(
            task=task,
            annotator=self.annotator,
            round_number=3,
            status=TaskAssignment.Status.SUBMITTED,
            assigned_at=task.created_at,
            submitted_at=task.created_at,
        )
        rejected_assignment = TaskAssignment.objects.create(
            task=task,
            annotator=second_annotator,
            round_number=3,
            status=TaskAssignment.Status.SUBMITTED,
            assigned_at=task.created_at,
            submitted_at=task.created_at,
        )
        accepted_annotation = Annotation.objects.create(
            task=task,
            assignment=accepted_assignment,
            annotator=self.annotator,
            result_payload={"annotations": [{"type": "bbox", "label_id": 1, "points": [12, 12, 112, 112], "frame": 0}]},
            submitted_at=task.created_at,
        )
        rejected_annotation = Annotation.objects.create(
            task=task,
            assignment=rejected_assignment,
            annotator=second_annotator,
            result_payload={"annotations": [{"type": "bbox", "label_id": 1, "points": [260, 260, 360, 360], "frame": 0}]},
            submitted_at=task.created_at,
        )

        response = self.client.get(f"/api/v1/tasks/{task.id}/review/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        annotations_by_id = {item["id"]: item for item in response.data["annotations"]}
        self.assertEqual(annotations_by_id[accepted_annotation.id]["review_outcome"], "accepted")
        self.assertEqual(annotations_by_id[rejected_annotation.id]["review_outcome"], "rejected")
