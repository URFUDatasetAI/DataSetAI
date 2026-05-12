from rest_framework import serializers

from apps.labeling.selectors import (
    get_task_review_counts,
    get_task_review_outcome,
    get_task_review_state,
    get_task_validation_vote_summary,
)
from apps.labeling.models import Annotation, Task, TaskAssignment, ValidationVote, VideoFrame
from apps.labeling.services import get_submission_editability


class TaskSerializer(serializers.ModelSerializer):
    room_id = serializers.IntegerField(read_only=True)
    parent_task_id = serializers.IntegerField(read_only=True)
    source_file_url = serializers.SerializerMethodField()
    video_frame_context = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = (
            "id",
            "room_id",
            "parent_task_id",
            "status",
            "current_round",
            "validation_score",
            "input_payload",
            "source_type",
            "workflow_stage",
            "source_name",
            "source_file_url",
            "video_frame_context",
            "created_at",
            "updated_at",
        )

    def get_source_file_url(self, obj):
        if not obj.source_file:
            return None
        request = self.context.get("request")
        if request is None:
            return obj.source_file.url
        return request.build_absolute_uri(obj.source_file.url)

    def _build_frame_item(self, frame):
        if frame is None:
            return None
        source_url = frame.task.source_file.url if frame.task.source_file else None
        request = self.context.get("request")
        if request is not None and source_url:
            source_url = request.build_absolute_uri(source_url)
        return {
            "task_id": frame.task_id,
            "source_name": frame.task.source_name,
            "source_file_url": source_url,
            "frame_number": frame.frame_number,
            "timestamp": frame.timestamp,
            "role": frame.role,
            "state": frame.state,
            "generated_from_frames": frame.generated_from_frames,
            "trajectory_warnings": frame.trajectory_warnings,
        }

    def get_video_frame_context(self, obj):
        try:
            video_frame = obj.video_frame
        except VideoFrame.DoesNotExist:
            return None
        previous_frame = (
            VideoFrame.objects.select_related("task")
            .filter(video_asset=video_frame.video_asset, frame_number__lt=video_frame.frame_number)
            .order_by("-frame_number", "-id")
            .first()
        )
        next_frame = (
            VideoFrame.objects.select_related("task")
            .filter(video_asset=video_frame.video_asset, frame_number__gt=video_frame.frame_number)
            .order_by("frame_number", "id")
            .first()
        )
        return {
            "video_asset_id": video_frame.video_asset_id,
            "video_name": video_frame.video_asset.source_name,
            "current": self._build_frame_item(video_frame),
            "previous": self._build_frame_item(previous_frame),
            "next": self._build_frame_item(next_frame),
        }


class ValidationVoteSubmitSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=ValidationVote.Decision.values)
    comment = serializers.CharField(required=False, allow_blank=True, max_length=2000, trim_whitespace=True)


class BoundingBoxAnnotationSerializer(serializers.Serializer):
    type = serializers.ChoiceField(choices=("bbox",))
    label_id = serializers.IntegerField(min_value=1)
    points = serializers.ListField(
        child=serializers.FloatField(),
        min_length=4,
        max_length=4,
    )
    frame = serializers.IntegerField(min_value=0)
    attributes = serializers.ListField(child=serializers.JSONField(), required=False, allow_empty=True)
    occluded = serializers.BooleanField(required=False, default=False)
    track_id = serializers.CharField(required=False, allow_blank=True, max_length=64)

    def validate_points(self, value):
        x_min, y_min, x_max, y_max = value
        if x_max <= x_min or y_max <= y_min:
            raise serializers.ValidationError("Bounding box points must form a positive-size rectangle.")
        return value


class TextTranscriptionAnnotationSerializer(BoundingBoxAnnotationSerializer):
    text = serializers.CharField(allow_blank=True, trim_whitespace=False)


class AnnotationSubmitSerializer(serializers.Serializer):
    result_payload = serializers.JSONField()

    def validate_result_payload(self, value):
        task: Task = self.context["task"]
        if task.source_type not in (Task.SourceType.IMAGE, Task.SourceType.VIDEO):
            return value

        if not isinstance(value, dict):
            raise serializers.ValidationError("Media annotation payload must be a JSON object.")

        annotations = value.get("annotations")
        if annotations is None:
            raise serializers.ValidationError("Media annotation payload must contain an annotations array.")
        if not isinstance(annotations, list):
            raise serializers.ValidationError("Annotations must be an array.")

        is_video_frame_task = (task.input_payload or {}).get("origin_source_type") == Task.SourceType.VIDEO
        if is_video_frame_task and value.get("frame_state") == VideoFrame.State.NO_OBJECT:
            if annotations:
                raise serializers.ValidationError("No-object video frame payload must not contain annotations.")
            return {
                "annotations": [],
                "frame_state": VideoFrame.State.NO_OBJECT,
            }

        if task.workflow_stage == Task.WorkflowStage.TEXT_TRANSCRIPTION:
            serializer = TextTranscriptionAnnotationSerializer(data=annotations, many=True)
            serializer.is_valid(raise_exception=True)

            expected_annotations = task.input_payload.get("detected_annotations") or []
            if len(serializer.validated_data) != len(expected_annotations):
                raise serializers.ValidationError("Transcription payload must contain all detected text regions.")

            for submitted_item, expected_item in zip(serializer.validated_data, expected_annotations):
                if (
                    submitted_item["label_id"] != expected_item.get("label_id")
                    or list(submitted_item["points"]) != list(expected_item.get("points", []))
                    or int(submitted_item["frame"]) != int(expected_item.get("frame", 0))
                ):
                    raise serializers.ValidationError(
                        "Text transcription stage cannot change detected boxes, labels or frames."
                    )

            return {
                "annotations": serializer.validated_data,
            }

        serializer = BoundingBoxAnnotationSerializer(data=annotations, many=True)
        serializer.is_valid(raise_exception=True)
        if is_video_frame_task:
            missing_track_ids = [
                index + 1
                for index, item in enumerate(serializer.validated_data)
                if not str(item.get("track_id") or "").strip()
            ]
            if missing_track_ids:
                raise serializers.ValidationError("Video bbox annotations must contain track_id for every box.")

        valid_label_ids = set(task.room.labels.values_list("id", flat=True))
        invalid_label_ids = {
            item["label_id"]
            for item in serializer.validated_data
            if item["label_id"] not in valid_label_ids
        }
        if invalid_label_ids:
            raise serializers.ValidationError(f"Unknown label ids: {', '.join(map(str, sorted(invalid_label_ids)))}.")

        return {
            "annotations": serializer.validated_data,
        }


class AnnotationSerializer(serializers.ModelSerializer):
    task_id = serializers.IntegerField(read_only=True)
    annotator_id = serializers.IntegerField(read_only=True)
    assignment_id = serializers.IntegerField(read_only=True)
    annotator_display_name = serializers.SerializerMethodField()
    round_number = serializers.IntegerField(source="assignment.round_number", read_only=True)

    class Meta:
        model = Annotation
        fields = (
            "id",
            "task_id",
            "assignment_id",
            "annotator_id",
            "annotator_display_name",
            "round_number",
            "result_payload",
            "submitted_at",
            "created_at",
            "updated_at",
        )

    def get_annotator_display_name(self, obj):
        if isinstance(obj, dict):
            return obj.get("annotator_display_name") or f"#{obj.get('annotator_id')}"
        return obj.annotator.display_name


class ReviewTaskListItemSerializer(serializers.ModelSerializer):
    source_file_url = serializers.SerializerMethodField()
    annotations_count = serializers.SerializerMethodField()
    annotator_ids = serializers.SerializerMethodField()
    review_state = serializers.SerializerMethodField()
    required_annotations_count = serializers.SerializerMethodField()
    submitted_annotations_count = serializers.SerializerMethodField()
    review_outcome = serializers.SerializerMethodField()
    validation_votes_required = serializers.SerializerMethodField()
    validation_acceptance_threshold = serializers.SerializerMethodField()
    validation_votes_count = serializers.SerializerMethodField()
    validation_approve_votes_count = serializers.SerializerMethodField()
    validation_reject_votes_count = serializers.SerializerMethodField()
    actor_validation_vote = serializers.SerializerMethodField()
    can_vote = serializers.SerializerMethodField()
    video_frame_state = serializers.SerializerMethodField()
    trajectory_warnings = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = (
            "id",
            "status",
            "current_round",
            "validation_score",
            "source_type",
            "workflow_stage",
            "source_name",
            "source_file_url",
            "annotations_count",
            "annotator_ids",
            "review_state",
            "required_annotations_count",
            "submitted_annotations_count",
            "review_outcome",
            "validation_votes_required",
            "validation_acceptance_threshold",
            "validation_votes_count",
            "validation_approve_votes_count",
            "validation_reject_votes_count",
            "actor_validation_vote",
            "can_vote",
            "video_frame_state",
            "trajectory_warnings",
            "updated_at",
        )

    def get_source_file_url(self, obj):
        if not obj.source_file:
            return None
        request = self.context.get("request")
        if request is None:
            return obj.source_file.url
        return request.build_absolute_uri(obj.source_file.url)

    def get_annotations_count(self, obj):
        return get_task_review_counts(task=obj)["submitted_annotations_count"]

    def get_annotator_ids(self, obj):
        review_round_number = get_task_review_counts(task=obj).get("review_round_number")
        return list(
            obj.annotations.filter(
                assignment__round_number=review_round_number or obj.current_round,
                assignment__status=TaskAssignment.Status.SUBMITTED,
            )
            .order_by()
            .values_list("annotator_id", flat=True)
            .distinct()
        )

    def get_review_state(self, obj):
        return get_task_review_state(task=obj)

    def get_required_annotations_count(self, obj):
        return get_task_review_counts(task=obj)["required_annotations_count"]

    def get_submitted_annotations_count(self, obj):
        return get_task_review_counts(task=obj)["submitted_annotations_count"]

    def get_review_outcome(self, obj):
        return get_task_review_outcome(task=obj)

    def _get_vote_summary(self, obj):
        cache = self.context.setdefault("_validation_vote_summary_by_task_id", {})
        if obj.id in cache:
            return cache[obj.id]
        request = self.context.get("request")
        reviewer = getattr(request, "user", None)
        cache[obj.id] = get_task_validation_vote_summary(task=obj, reviewer=reviewer)
        return cache[obj.id]

    def get_validation_votes_required(self, obj):
        return self._get_vote_summary(obj)["validation_votes_required"]

    def get_validation_acceptance_threshold(self, obj):
        return self._get_vote_summary(obj)["validation_acceptance_threshold"]

    def get_validation_votes_count(self, obj):
        return self._get_vote_summary(obj)["validation_votes_count"]

    def get_validation_approve_votes_count(self, obj):
        return self._get_vote_summary(obj)["validation_approve_votes_count"]

    def get_validation_reject_votes_count(self, obj):
        return self._get_vote_summary(obj)["validation_reject_votes_count"]

    def get_actor_validation_vote(self, obj):
        return self._get_vote_summary(obj)["actor_validation_vote"]

    def get_can_vote(self, obj):
        return self._get_vote_summary(obj)["can_vote"]

    def get_video_frame_state(self, obj):
        try:
            return obj.video_frame.state
        except VideoFrame.DoesNotExist:
            return None

    def get_trajectory_warnings(self, obj):
        try:
            return obj.video_frame.trajectory_warnings
        except VideoFrame.DoesNotExist:
            return []


class ReviewAnnotationSerializer(AnnotationSerializer):
    review_outcome = serializers.CharField()

    class Meta(AnnotationSerializer.Meta):
        fields = AnnotationSerializer.Meta.fields + ("review_outcome",)


class ReviewTaskDetailSerializer(serializers.Serializer):
    task = TaskSerializer()
    consensus_payload = serializers.JSONField(allow_null=True)
    consensus_available = serializers.BooleanField()
    can_reject_all = serializers.BooleanField()
    review_state = serializers.CharField()
    required_annotations_count = serializers.IntegerField()
    submitted_annotations_count = serializers.IntegerField()
    validation_votes_required = serializers.IntegerField()
    validation_acceptance_threshold = serializers.IntegerField()
    validation_votes_count = serializers.IntegerField()
    validation_approve_votes_count = serializers.IntegerField()
    validation_reject_votes_count = serializers.IntegerField()
    actor_validation_vote = serializers.CharField(allow_null=True)
    can_vote = serializers.BooleanField()
    annotations = ReviewAnnotationSerializer(many=True)
    review_outcome = serializers.CharField()
    video_frame_state = serializers.CharField(allow_null=True, required=False)
    generated_payload = serializers.JSONField(allow_null=True, required=False)
    generated_from_frames = serializers.JSONField(required=False)
    trajectory_warnings = serializers.JSONField(required=False)


class EditableSubmissionListItemSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(source="task.id", read_only=True)
    status = serializers.CharField(source="task.status", read_only=True)
    current_round = serializers.IntegerField(source="task.current_round", read_only=True)
    validation_score = serializers.FloatField(source="task.validation_score", read_only=True, allow_null=True)
    source_type = serializers.CharField(source="task.source_type", read_only=True)
    workflow_stage = serializers.CharField(source="task.workflow_stage", read_only=True)
    source_name = serializers.CharField(source="task.source_name", read_only=True, allow_null=True)
    source_file_url = serializers.SerializerMethodField()
    editable = serializers.SerializerMethodField()
    editable_reason = serializers.SerializerMethodField()
    submitted_at = serializers.DateTimeField(source="annotation.submitted_at", read_only=True)

    class Meta:
        model = TaskAssignment
        fields = (
            "id",
            "status",
            "current_round",
            "validation_score",
            "source_type",
            "workflow_stage",
            "source_name",
            "source_file_url",
            "editable",
            "editable_reason",
            "submitted_at",
        )

    def get_source_file_url(self, obj):
        if not obj.task.source_file:
            return None
        request = self.context.get("request")
        if request is None:
            return obj.task.source_file.url
        return request.build_absolute_uri(obj.task.source_file.url)

    def get_editable(self, obj):
        return get_submission_editability(task=obj.task, assignment=obj)[0]

    def get_editable_reason(self, obj):
        return get_submission_editability(task=obj.task, assignment=obj)[1]


class EditableSubmissionDetailSerializer(serializers.Serializer):
    task = TaskSerializer()
    annotation = AnnotationSerializer()
    editable = serializers.BooleanField()
    editable_reason = serializers.CharField(allow_null=True)


class ReturnForRevisionSerializer(serializers.Serializer):
    annotator_id = serializers.IntegerField(min_value=1)
