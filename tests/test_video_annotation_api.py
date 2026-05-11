import json

from django.core.files.base import ContentFile
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.labeling.models import FrameAnnotation, FrameAnnotationTask, Task
from apps.labeling.video_services import build_frame_annotation_export, expand_frame_range, validate_bbox_object
from apps.rooms.models import Room
from common.exceptions import ConflictError
from tests.factories import invite_annotator, make_room, make_task, make_user


class VideoAnnotationApiTests(APITestCase):
    def setUp(self):
        self.customer = make_user(username="video_customer", full_name="Video Customer")
        self.annotator = make_user(username="video_annotator", full_name="Video Annotator")
        self.room = make_room(customer=self.customer, title="Video room", dataset_type=Room.DatasetType.VIDEO)
        invite_annotator(room=self.room, annotator=self.annotator, invited_by=self.customer, joined=True)
        self.video = make_task(
            room=self.room,
            payload={
                "source_name": "clip.mp4",
                "fps": 25,
                "frame_rate": 25,
                "frame_count": 10,
                "duration": 0.4,
                "width": 640,
                "height": 480,
            },
            source_type=Task.SourceType.VIDEO,
            source_name="clip.mp4",
        )

    def auth(self, user):
        return {"HTTP_X_USER_ID": str(user.id)}

    def test_create_selected_frame_and_interval(self):
        frame_response = self.client.post(
            reverse("video-selection-list-create", kwargs={"video_id": self.video.id}),
            {"start_frame": 3, "end_frame": 3},
            format="json",
            **self.auth(self.annotator),
        )
        interval_response = self.client.post(
            reverse("video-selection-list-create", kwargs={"video_id": self.video.id}),
            {"start_frame": 6, "end_frame": 4},
            format="json",
            **self.auth(self.annotator),
        )

        self.assertEqual(frame_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(frame_response.data["start_frame"], 3)
        self.assertEqual(frame_response.data["end_frame"], 3)
        self.assertEqual(interval_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(interval_response.data["start_frame"], 4)
        self.assertEqual(interval_response.data["end_frame"], 6)

    def test_generate_tasks_from_interval_and_skip_duplicates(self):
        self.client.post(
            reverse("video-selection-list-create", kwargs={"video_id": self.video.id}),
            {"start_frame": 2, "end_frame": 4},
            format="json",
            **self.auth(self.annotator),
        )

        first_response = self.client.post(
            reverse("video-generate-frame-tasks", kwargs={"video_id": self.video.id}),
            {},
            format="json",
            **self.auth(self.annotator),
        )
        second_response = self.client.post(
            reverse("video-generate-frame-tasks", kwargs={"video_id": self.video.id}),
            {},
            format="json",
            **self.auth(self.annotator),
        )

        self.assertEqual(first_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(first_response.data["created_count"], 3)
        self.assertEqual(FrameAnnotationTask.objects.filter(video=self.video).count(), 3)
        self.assertEqual(second_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second_response.data["created_count"], 0)
        self.assertEqual(second_response.data["skipped_duplicates_count"], 3)

    def test_get_frame_by_index_returns_cached_frame_url(self):
        frame_task = FrameAnnotationTask.objects.create(video=self.video, frame_index=5, time_ms=200)
        frame_task.frame_image.save("frame_000005.jpg", ContentFile(b"fake-jpeg"), save=True)

        response = self.client.get(
            reverse("video-frame-detail", kwargs={"video_id": self.video.id, "frame_index": 5}),
            **self.auth(self.annotator),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["frame_index"], 5)
        self.assertTrue(response.data["frame_image_url"])

    def test_save_bbox_annotation(self):
        frame_task = FrameAnnotationTask.objects.create(video=self.video, frame_index=1, time_ms=40)

        response = self.client.put(
            reverse("frame-task-annotation", kwargs={"task_id": frame_task.id}),
            {
                "status": "annotated",
                "objects": [
                    {
                        "label": "object",
                        "bbox": {"x": 0.42, "y": 0.31, "width": 0.08, "height": 0.06},
                    }
                ],
            },
            format="json",
            **self.auth(self.annotator),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        annotation = FrameAnnotation.objects.get(task=frame_task)
        self.assertEqual(annotation.status, FrameAnnotation.Status.ANNOTATED)
        self.assertEqual(annotation.objects_payload[0]["bbox"]["x"], 0.42)
        frame_task.refresh_from_db()
        self.assertEqual(frame_task.status, FrameAnnotationTask.Status.DONE)

    def test_reject_invalid_bbox(self):
        frame_task = FrameAnnotationTask.objects.create(video=self.video, frame_index=1, time_ms=40)

        response = self.client.put(
            reverse("frame-task-annotation", kwargs={"task_id": frame_task.id}),
            {
                "status": "annotated",
                "objects": [
                    {
                        "label": "object",
                        "bbox": {"x": 0.98, "y": 0.2, "width": 0.08, "height": 0.1},
                    }
                ],
            },
            format="json",
            **self.auth(self.annotator),
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_save_empty_status(self):
        frame_task = FrameAnnotationTask.objects.create(video=self.video, frame_index=2, time_ms=80)

        response = self.client.put(
            reverse("frame-task-annotation", kwargs={"task_id": frame_task.id}),
            {"status": "empty", "objects": []},
            format="json",
            **self.auth(self.annotator),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        annotation = FrameAnnotation.objects.get(task=frame_task)
        self.assertEqual(annotation.status, FrameAnnotation.Status.EMPTY)
        self.assertEqual(annotation.objects_payload, [])

    def test_save_uncertain_status_without_bbox(self):
        frame_task = FrameAnnotationTask.objects.create(video=self.video, frame_index=3, time_ms=120)

        response = self.client.put(
            reverse("frame-task-annotation", kwargs={"task_id": frame_task.id}),
            {"status": "uncertain", "objects": []},
            format="json",
            **self.auth(self.annotator),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        annotation = FrameAnnotation.objects.get(task=frame_task)
        self.assertEqual(annotation.status, FrameAnnotation.Status.UNCERTAIN)
        frame_task.refresh_from_db()
        self.assertEqual(frame_task.status, FrameAnnotationTask.Status.UNCERTAIN)

    def test_export_frame_annotations_json(self):
        task_1 = FrameAnnotationTask.objects.create(video=self.video, frame_index=1, time_ms=40)
        task_2 = FrameAnnotationTask.objects.create(video=self.video, frame_index=2, time_ms=80)
        FrameAnnotation.objects.create(
            task=task_1,
            video=self.video,
            frame_index=1,
            status=FrameAnnotation.Status.ANNOTATED,
            objects_payload=[
                {
                    "label": "object",
                    "bbox": {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4},
                }
            ],
            created_by=self.annotator,
        )
        FrameAnnotation.objects.create(
            task=task_2,
            video=self.video,
            frame_index=2,
            status=FrameAnnotation.Status.EMPTY,
            objects_payload=[],
            created_by=self.annotator,
        )

        response = self.client.get(
            reverse("video-frame-annotation-export", kwargs={"video_id": self.video.id}),
            **self.auth(self.customer),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        content = json.loads(response.content.decode("utf-8"))
        self.assertEqual(content["video_id"], str(self.video.id))
        self.assertEqual([item["frame_index"] for item in content["annotations"]], [1, 2])
        self.assertEqual(content["annotations"][0]["status"], "annotated")
        self.assertEqual(content["annotations"][1]["objects"], [])


class VideoAnnotationUnitTests(APITestCase):
    def test_expand_frame_range(self):
        self.assertEqual(expand_frame_range(start_frame=4, end_frame=2, frame_count=10), [2, 3, 4])

    def test_validate_bbox_object_rejects_out_of_bounds(self):
        with self.assertRaises(ConflictError):
            validate_bbox_object({"label": "object", "bbox": {"x": 0.9, "y": 0.1, "width": 0.2, "height": 0.1}})

    def test_build_export_is_ordered(self):
        customer = make_user(username="export_customer", full_name="Export Customer")
        room = make_room(customer=customer, title="Export room", dataset_type=Room.DatasetType.VIDEO)
        video = make_task(
            room=room,
            payload={"fps": 25, "frame_count": 10},
            source_type=Task.SourceType.VIDEO,
            source_name="ordered.mp4",
        )
        FrameAnnotationTask.objects.create(video=video, frame_index=4, time_ms=160)
        FrameAnnotationTask.objects.create(video=video, frame_index=2, time_ms=80)

        content = build_frame_annotation_export(video=video)

        self.assertEqual([item["frame_index"] for item in content["annotations"]], [2, 4])
