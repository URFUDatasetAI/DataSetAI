from rest_framework import serializers

from apps.labeling.models import Annotation, Task, TaskAssignment
from apps.labeling.services import get_submission_editability


class TaskSerializer(serializers.ModelSerializer):
    room_id = serializers.IntegerField(read_only=True)
    parent_task_id = serializers.IntegerField(read_only=True)
    source_file_url = serializers.SerializerMethodField()

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
    review_outcome = serializers.SerializerMethodField()

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
            "review_outcome",
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
        return obj.annotations.count()

    def get_annotator_ids(self, obj):
        return list(obj.annotations.order_by().values_list("annotator_id", flat=True).distinct())

    def get_review_outcome(self, obj):
        if obj.status == Task.Status.SUBMITTED and obj.consensus_payload is not None:
            return "accepted"
        if obj.annotations.exists():
            return "rejected"
        return "pending"


class ReviewAnnotationSerializer(AnnotationSerializer):
    review_outcome = serializers.CharField()

    class Meta(AnnotationSerializer.Meta):
        fields = AnnotationSerializer.Meta.fields + ("review_outcome",)


class ReviewTaskDetailSerializer(serializers.Serializer):
    task = TaskSerializer()
    consensus_payload = serializers.JSONField(allow_null=True)
    annotations = ReviewAnnotationSerializer(many=True)
    review_outcome = serializers.CharField()


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
