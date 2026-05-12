from django.http import HttpResponse
from rest_framework import status
from django.db.models import Q
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.labeling.api.v1.serializers import (
    AnnotationSerializer,
    AnnotationSubmitSerializer,
    EditableSubmissionDetailSerializer,
    EditableSubmissionListItemSerializer,
    FrameAnnotationSaveSerializer,
    FrameAnnotationTaskSerializer,
    ReturnForRevisionSerializer,
    ReviewTaskDetailSerializer,
    ReviewTaskListItemSerializer,
    TaskSerializer,
    ValidationVoteSubmitSerializer,
    VideoSelectionSerializer,
    VideoSelectionWriteSerializer,
)
from apps.labeling.consensus import evaluate_annotation_against_consensus
from apps.labeling.models import TaskAssignment, VideoSelection
from apps.labeling.selectors import (
    REVIEW_FILTER_FINAL,
    REVIEW_FILTER_VALUES,
    get_current_submitted_assignment_for_annotator,
    get_task_review_annotations,
    get_task_review_counts,
    get_task_review_outcome,
    get_task_for_review,
    get_task_or_404,
    get_task_review_state,
    get_task_validation_vote_summary,
    list_current_submitted_assignments_for_annotator,
    task_matches_review_filter_for_actor,
)
from apps.labeling.services import (
    approve_generated_video_frame,
    get_next_task_for_annotator,
    get_submission_editability,
    mark_generated_video_frame_no_object,
    reject_generated_video_frame,
    reject_task_annotation,
    return_task_annotation_for_revision,
    skip_task_for_annotator,
    submit_annotation,
    submit_validation_vote,
    update_submitted_annotation,
)
from apps.labeling.video_services import (
    create_video_selection,
    delete_video_selection,
    ensure_frame_image,
    export_frame_annotations_json,
    generate_frame_tasks_from_selection,
    generate_frame_tasks_from_selections,
    get_frame_task_or_404,
    get_video_for_workspace,
    list_frame_tasks,
    save_frame_annotation,
    serialize_video,
    update_video_selection,
)
from apps.labeling.workflows import get_room_final_tasks_queryset
from apps.rooms.policies import can_review_room
from apps.rooms.selectors import get_visible_room
from common.exceptions import AccessDeniedError, NotFoundError

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


class TaskSkipView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, task_id: int):
        task = get_task_or_404(task_id=task_id)
        task = skip_task_for_annotator(task=task, annotator=request.user)
        return Response(TaskSerializer(task, context={"request": request}).data)


class RoomSubmittedTaskListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, room_id: int):
        room = get_visible_room(room_id=room_id, user=request.user)
        assignments = list_current_submitted_assignments_for_annotator(room=room, annotator=request.user)
        serializer = EditableSubmissionListItemSerializer(assignments, many=True, context={"request": request})
        return Response(serializer.data)


def _build_submission_detail_payload(*, assignment):
    editable, editable_reason = get_submission_editability(task=assignment.task, assignment=assignment)
    return {
        "task": assignment.task,
        "annotation": assignment.annotation,
        "editable": editable,
        "editable_reason": editable_reason,
    }


class TaskMySubmissionView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, task_id: int):
        assignment = get_current_submitted_assignment_for_annotator(task_id=task_id, annotator=request.user)
        payload = _build_submission_detail_payload(assignment=assignment)
        return Response(EditableSubmissionDetailSerializer(payload, context={"request": request}).data)

    def put(self, request, task_id: int):
        assignment = get_current_submitted_assignment_for_annotator(task_id=task_id, annotator=request.user)
        serializer = AnnotationSubmitSerializer(data=request.data, context={"task": assignment.task})
        serializer.is_valid(raise_exception=True)
        update_submitted_annotation(
            task=assignment.task,
            annotator=request.user,
            result_payload=serializer.validated_data["result_payload"],
        )
        refreshed_assignment = get_current_submitted_assignment_for_annotator(task_id=task_id, annotator=request.user)
        payload = _build_submission_detail_payload(assignment=refreshed_assignment)
        return Response(EditableSubmissionDetailSerializer(payload, context={"request": request}).data)


class RoomReviewTaskListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, room_id: int):
        room = get_visible_room(room_id=room_id, user=request.user)
        if not can_review_room(room=room, user=request.user):
            raise AccessDeniedError("У тебя нет прав проверять задачи в этой комнате.")
        review_filter = request.query_params.get("filter") or REVIEW_FILTER_FINAL
        if review_filter not in REVIEW_FILTER_VALUES:
            review_filter = REVIEW_FILTER_FINAL

        candidate_tasks = (
            get_room_final_tasks_queryset(room=room)
            .select_related("video_frame", "video_frame__video_asset")
            .filter(
                Q(
                    annotations__isnull=False,
                    annotations__assignment__status=TaskAssignment.Status.SUBMITTED,
                )
                | Q(video_frame__state="generated_review")
            )
            .prefetch_related("annotations", "assignments")
            .distinct()
            .order_by("-updated_at", "-id")
        )
        tasks = [
            task
            for task in candidate_tasks
            if task_matches_review_filter_for_actor(
                task=task,
                review_filter=review_filter,
                reviewer=request.user,
            )
        ]
        serializer = ReviewTaskListItemSerializer(tasks, many=True, context={"request": request})
        return Response(serializer.data)


class TaskReviewDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, task_id: int):
        task = get_task_for_review(task_id=task_id, reviewer=request.user)
        task = task.__class__.objects.select_related("room").prefetch_related("annotations__annotator", "annotations__assignment").get(
            id=task.id
        )
        review_state = get_task_review_state(task=task)
        review_outcome = get_task_review_outcome(task=task)
        consensus_available = task.consensus_payload is not None and review_outcome in ("accepted", "validation", "generated")
        counts = get_task_review_counts(task=task)
        vote_summary = get_task_validation_vote_summary(task=task, reviewer=request.user)
        serialized_annotations = []
        for annotation in get_task_review_annotations(task=task):
            annotation_outcome = "pending"
            if review_outcome == "accepted" and task.consensus_payload is not None:
                annotation_consensus = evaluate_annotation_against_consensus(
                    annotation_payload=annotation.result_payload,
                    consensus_payload=task.consensus_payload,
                    similarity_threshold=task.room.cross_validation_similarity_threshold,
                )
                annotation_outcome = "accepted" if annotation_consensus["accepted"] else "rejected"
            elif review_outcome == "rejected":
                annotation_outcome = "rejected"
            serialized_annotations.append(
                {
                    **AnnotationSerializer(annotation).data,
                    "review_outcome": annotation_outcome,
                }
            )
        payload = {
            "task": task,
            "consensus_payload": task.consensus_payload if consensus_available else None,
            "consensus_available": consensus_available,
            "can_reject_all": review_outcome == "accepted",
            "review_state": review_state,
            **counts,
            **vote_summary,
            "annotations": serialized_annotations,
            "review_outcome": review_outcome,
        }
        try:
            video_frame = task.video_frame
        except Exception:
            video_frame = None
        if video_frame is not None:
            payload.update(
                {
                    "video_frame_state": video_frame.state,
                    "generated_payload": video_frame.generated_payload,
                    "generated_from_frames": video_frame.generated_from_frames,
                    "trajectory_warnings": video_frame.trajectory_warnings,
                }
            )
        return Response(ReviewTaskDetailSerializer(payload, context={"request": request}).data)


class TaskValidationVoteView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, task_id: int):
        task = get_task_for_review(task_id=task_id, reviewer=request.user)
        serializer = ValidationVoteSubmitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        submit_validation_vote(
            task=task,
            reviewer=request.user,
            decision=serializer.validated_data["decision"],
            comment=serializer.validated_data.get("comment", ""),
        )
        refreshed_task = get_task_for_review(task_id=task_id, reviewer=request.user)
        return Response(TaskSerializer(refreshed_task, context={"request": request}).data)


class TaskRejectView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, task_id: int):
        task = get_task_for_review(task_id=task_id, reviewer=request.user)
        task = reject_task_annotation(task=task, reviewer=request.user)
        return Response(TaskSerializer(task, context={"request": request}).data)


class TaskReturnForRevisionView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, task_id: int):
        task = get_task_for_review(task_id=task_id, reviewer=request.user)
        serializer = ReturnForRevisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        task = return_task_annotation_for_revision(
            task=task,
            reviewer=request.user,
            annotator_id=serializer.validated_data["annotator_id"],
        )
        return Response(TaskSerializer(task, context={"request": request}).data)



class TaskGeneratedApproveView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, task_id: int):
        task = get_task_for_review(task_id=task_id, reviewer=request.user)
        task = approve_generated_video_frame(task=task, reviewer=request.user)
        return Response(TaskSerializer(task, context={"request": request}).data)


class TaskGeneratedRejectView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, task_id: int):
        task = get_task_for_review(task_id=task_id, reviewer=request.user)
        task = reject_generated_video_frame(task=task, reviewer=request.user)
        return Response(TaskSerializer(task, context={"request": request}).data)


class TaskGeneratedNoObjectView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, task_id: int):
        task = get_task_for_review(task_id=task_id, reviewer=request.user)
        task = mark_generated_video_frame_no_object(task=task, reviewer=request.user)
        return Response(TaskSerializer(task, context={"request": request}).data)

def _get_video_selection_or_404(*, selection_id: int) -> VideoSelection:
    try:
        return VideoSelection.objects.select_related("video__room").get(id=selection_id)
    except VideoSelection.DoesNotExist as exc:
        raise NotFoundError("Выбранный интервал не найден.") from exc


class VideoDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, video_id: int):
        video = get_video_for_workspace(video_id=video_id, actor=request.user)
        return Response(serialize_video(video=video, request=request))


class VideoSelectionListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, video_id: int):
        video = get_video_for_workspace(video_id=video_id, actor=request.user)
        selections = video.video_selections.select_related("created_by").order_by("start_frame", "end_frame", "id")
        return Response(VideoSelectionSerializer(selections, many=True).data)

    def post(self, request, video_id: int):
        video = get_video_for_workspace(video_id=video_id, actor=request.user)
        serializer = VideoSelectionWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        selection = create_video_selection(
            video=video,
            actor=request.user,
            start_frame=serializer.validated_data["start_frame"],
            end_frame=serializer.validated_data["end_frame"],
        )
        return Response(VideoSelectionSerializer(selection).data, status=status.HTTP_201_CREATED)


class VideoSelectionDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, selection_id: int):
        selection = _get_video_selection_or_404(selection_id=selection_id)
        serializer = VideoSelectionWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        selection = update_video_selection(
            selection=selection,
            actor=request.user,
            start_frame=serializer.validated_data["start_frame"],
            end_frame=serializer.validated_data["end_frame"],
        )
        return Response(VideoSelectionSerializer(selection).data)

    def delete(self, request, selection_id: int):
        selection = _get_video_selection_or_404(selection_id=selection_id)
        delete_video_selection(selection=selection, actor=request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class VideoGenerateFrameTasksView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, video_id: int):
        video = get_video_for_workspace(video_id=video_id, actor=request.user)
        result = generate_frame_tasks_from_selections(video=video, actor=request.user)
        return Response(
            {
                "created_count": result["created_count"],
                "skipped_duplicates_count": result["skipped_duplicates_count"],
                "tasks": FrameAnnotationTaskSerializer(result["tasks"], many=True, context={"request": request}).data,
            },
            status=status.HTTP_201_CREATED,
        )


class VideoSelectionGenerateFrameTasksView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, selection_id: int):
        selection = _get_video_selection_or_404(selection_id=selection_id)
        result = generate_frame_tasks_from_selection(selection=selection, actor=request.user)
        return Response(
            {
                "created_count": result["created_count"],
                "skipped_duplicates_count": result["skipped_duplicates_count"],
                "tasks": FrameAnnotationTaskSerializer(result["tasks"], many=True, context={"request": request}).data,
            },
            status=status.HTTP_201_CREATED,
        )


class FrameTaskListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        raw_video_id = request.query_params.get("video_id")
        try:
            video_id = int(raw_video_id) if raw_video_id else None
        except (TypeError, ValueError) as exc:
            raise NotFoundError("Видео не найдено.") from exc
        tasks = list_frame_tasks(actor=request.user, video_id=video_id)
        return Response(FrameAnnotationTaskSerializer(tasks, many=True, context={"request": request}).data)


class FrameTaskDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, task_id: int):
        task = get_frame_task_or_404(task_id=task_id, actor=request.user)
        return Response(FrameAnnotationTaskSerializer(task, context={"request": request}).data)


class VideoFrameView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, video_id: int, frame_index: int):
        video = get_video_for_workspace(video_id=video_id, actor=request.user)
        frame_task = ensure_frame_image(video=video, frame_index=frame_index)
        return Response(FrameAnnotationTaskSerializer(frame_task, context={"request": request}).data)


class FrameTaskAnnotationView(APIView):
    permission_classes = [IsAuthenticated]

    def put(self, request, task_id: int):
        task = get_frame_task_or_404(task_id=task_id, actor=request.user)
        serializer = FrameAnnotationSaveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        annotation = save_frame_annotation(
            frame_task=task,
            actor=request.user,
            status=serializer.validated_data["status"],
            objects=serializer.validated_data.get("objects") or [],
        )
        refreshed_task = get_frame_task_or_404(task_id=task.id, actor=request.user)
        serialized_task = FrameAnnotationTaskSerializer(refreshed_task, context={"request": request}).data
        return Response(
            {
                "task": serialized_task,
                "annotation": serialized_task["annotation"],
                "annotation_id": annotation.id,
            }
        )


class VideoFrameAnnotationExportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, video_id: int):
        video = get_video_for_workspace(video_id=video_id, actor=request.user)
        content = export_frame_annotations_json(video=video, actor=request.user)
        response = HttpResponse(content, content_type="application/json; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="video_{video.id}_frame_annotations.json"'
        return response

