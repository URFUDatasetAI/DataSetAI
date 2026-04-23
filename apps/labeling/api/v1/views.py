from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.labeling.api.v1.serializers import (
    AnnotationSerializer,
    AnnotationSubmitSerializer,
    ReviewTaskDetailSerializer,
    ReviewTaskListItemSerializer,
    TaskSerializer,
)
from apps.labeling.consensus import evaluate_annotation_against_consensus
from apps.labeling.selectors import get_task_for_review, get_task_or_404
from apps.labeling.services import get_next_task_for_annotator, reject_task_annotation, submit_annotation
from apps.labeling.workflows import get_room_final_tasks_queryset
from apps.rooms.policies import can_review_room
from apps.rooms.selectors import get_visible_room
from common.exceptions import AccessDeniedError

"""
Labeling endpoints used by the annotator workflow:
- ask for the next available task in a room
- submit an annotation for an assigned task
"""


class RoomNextTaskView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, room_id: int):
        room = get_visible_room(room_id=room_id, user=request.user)
        task = get_next_task_for_annotator(room=room, annotator=request.user)
        if task is None:
            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response(TaskSerializer(task, context={"request": request}).data)


class TaskSubmitView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, task_id: int):
        task = get_task_or_404(task_id=task_id)
        serializer = AnnotationSubmitSerializer(data=request.data, context={"task": task})
        serializer.is_valid(raise_exception=True)
        annotation = submit_annotation(
            task=task,
            annotator=request.user,
            result_payload=serializer.validated_data["result_payload"],
        )
        return Response(AnnotationSerializer(annotation).data, status=status.HTTP_201_CREATED)


class RoomReviewTaskListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, room_id: int):
        room = get_visible_room(room_id=room_id, user=request.user)
        if not can_review_room(room=room, user=request.user):
            raise AccessDeniedError("You do not have permission to review tasks in this room.")
        tasks = (
            get_room_final_tasks_queryset(room=room)
            .filter(annotations__isnull=False)
            .prefetch_related("annotations")
            .distinct()
            .order_by("-updated_at", "-id")
        )
        serializer = ReviewTaskListItemSerializer(tasks, many=True, context={"request": request})
        return Response(serializer.data)


class TaskReviewDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, task_id: int):
        task = get_task_for_review(task_id=task_id, reviewer=request.user)
        task = task.__class__.objects.select_related("room").prefetch_related("annotations__annotator", "annotations__assignment").get(
            id=task.id
        )
        review_outcome = "accepted" if task.status == task.Status.SUBMITTED and task.consensus_payload is not None else "rejected"
        serialized_annotations = []
        for annotation in task.annotations.order_by("-submitted_at", "-id"):
            annotation_outcome = "rejected"
            if review_outcome == "accepted" and task.consensus_payload is not None:
                annotation_consensus = evaluate_annotation_against_consensus(
                    annotation_payload=annotation.result_payload,
                    consensus_payload=task.consensus_payload,
                    similarity_threshold=task.room.cross_validation_similarity_threshold,
                )
                annotation_outcome = "accepted" if annotation_consensus["accepted"] else "rejected"
            serialized_annotations.append(
                {
                    **AnnotationSerializer(annotation).data,
                    "review_outcome": annotation_outcome,
                }
            )
        payload = {
            "task": task,
            "consensus_payload": task.consensus_payload,
            "annotations": serialized_annotations,
            "review_outcome": review_outcome,
        }
        return Response(ReviewTaskDetailSerializer(payload, context={"request": request}).data)


class TaskRejectView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, task_id: int):
        task = get_task_for_review(task_id=task_id, reviewer=request.user)
        task = reject_task_annotation(task=task, reviewer=request.user)
        return Response(TaskSerializer(task, context={"request": request}).data)
