import json

from rest_framework import serializers

from apps.rooms.models import Room, RoomJoinRequest, RoomLabel, RoomMembership, RoomPin
from apps.rooms.services import get_supported_export_formats, validate_dataset_upload
from apps.labeling.workflows import get_room_final_tasks_queryset, get_room_primary_tasks_queryset
from common.exceptions import ConflictError

ROOM_TEXT_MAX_LENGTH = 255
ROOM_DESCRIPTION_MAX_LENGTH = 2000


class JsonStringField(serializers.Field):
    default_error_messages = {
        "invalid": "Expected a JSON value or JSON string.",
    }

    def to_internal_value(self, data):
        if data in (None, "", []):
            return None
        if isinstance(data, str):
            try:
                return json.loads(data)
            except json.JSONDecodeError as exc:
                raise serializers.ValidationError(self.error_messages["invalid"]) from exc
        return data

    def to_representation(self, value):
        return value


class RoomLabelDefinitionSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=64)
    color = serializers.RegexField(regex=r"^#[0-9A-Fa-f]{6}$", required=False, allow_blank=True)


class MediaManifestItemSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=ROOM_TEXT_MAX_LENGTH)
    width = serializers.IntegerField(required=False, min_value=1)
    height = serializers.IntegerField(required=False, min_value=1)
    duration = serializers.FloatField(required=False, min_value=0)
    frame_rate = serializers.IntegerField(required=False, min_value=1)


class RoomCreateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=ROOM_TEXT_MAX_LENGTH)
    description = serializers.CharField(required=False, allow_blank=True, max_length=ROOM_DESCRIPTION_MAX_LENGTH)
    password = serializers.CharField(required=False, allow_blank=True, write_only=True, max_length=ROOM_TEXT_MAX_LENGTH)
    deadline = serializers.DateTimeField(required=False, allow_null=True)
    cross_validation_enabled = serializers.BooleanField(required=False, default=False)
    cross_validation_annotators_count = serializers.IntegerField(required=False, min_value=1, max_value=20, default=1)
    cross_validation_similarity_threshold = serializers.IntegerField(required=False, min_value=1, max_value=100, default=80)
    annotation_workflow = serializers.ChoiceField(
        choices=Room.AnnotationWorkflow.values,
        required=False,
        default=Room.AnnotationWorkflow.STANDARD,
    )
    annotator_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=True,
    )
    dataset_mode = serializers.ChoiceField(choices=Room.DatasetType.values, required=False, default=Room.DatasetType.DEMO)
    test_task_count = serializers.IntegerField(required=False, min_value=1, max_value=100, default=12)
    dataset_label = serializers.CharField(required=False, allow_blank=True, default="Тестовый датасет", max_length=ROOM_TEXT_MAX_LENGTH)
    dataset_files = serializers.ListField(
        child=serializers.FileField(allow_empty_file=False),
        required=False,
        allow_empty=True,
        write_only=True,
    )
    labels = JsonStringField(required=False)
    media_manifest = JsonStringField(required=False)

    def validate(self, attrs):
        if attrs.get("cross_validation_enabled"):
            if attrs.get("cross_validation_annotators_count", 1) < 2:
                raise serializers.ValidationError(
                    {"cross_validation_annotators_count": "Set at least 2 independent annotators for cross validation."}
                )
        else:
            attrs["cross_validation_annotators_count"] = 1

        dataset_mode = attrs.get("dataset_mode", Room.DatasetType.DEMO)
        annotation_workflow = attrs.get("annotation_workflow", Room.AnnotationWorkflow.STANDARD)
        dataset_files = list(attrs.get("dataset_files") or [])
        labels = attrs.get("labels")
        media_manifest = attrs.get("media_manifest")

        if (
            annotation_workflow == Room.AnnotationWorkflow.TEXT_DETECTION_TRANSCRIPTION
            and dataset_mode not in (Room.DatasetType.IMAGE, Room.DatasetType.VIDEO)
        ):
            raise serializers.ValidationError(
                {"annotation_workflow": "Object detect + text is available only for image or video datasets."}
            )

        try:
            validate_dataset_upload(dataset_mode=dataset_mode, dataset_files=dataset_files)
        except ConflictError as exc:
            raise serializers.ValidationError({"dataset_files": str(exc)}) from exc

        if labels is None:
            attrs["labels"] = []
        else:
            if not isinstance(labels, list):
                raise serializers.ValidationError({"labels": "Labels must be a JSON array."})
            serializer = RoomLabelDefinitionSerializer(data=labels, many=True)
            serializer.is_valid(raise_exception=True)
            attrs["labels"] = serializer.validated_data

        if (
            dataset_mode in (Room.DatasetType.IMAGE, Room.DatasetType.VIDEO)
            and annotation_workflow != Room.AnnotationWorkflow.TEXT_DETECTION_TRANSCRIPTION
            and not attrs["labels"]
        ):
            raise serializers.ValidationError({"labels": "Provide at least one label for image or video datasets."})

        if media_manifest in (None, ""):
            attrs["media_manifest"] = []
        else:
            if not isinstance(media_manifest, list):
                raise serializers.ValidationError({"media_manifest": "Media manifest must be a JSON array."})
            serializer = MediaManifestItemSerializer(data=media_manifest, many=True)
            serializer.is_valid(raise_exception=True)
            attrs["media_manifest"] = serializer.validated_data

        return attrs


class RoomUpdateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=ROOM_TEXT_MAX_LENGTH)
    description = serializers.CharField(required=False, allow_blank=True, default="", max_length=ROOM_DESCRIPTION_MAX_LENGTH)
    dataset_label = serializers.CharField(required=False, allow_blank=True, default="Тестовый датасет", max_length=ROOM_TEXT_MAX_LENGTH)
    deadline = serializers.DateTimeField(required=False, allow_null=True)
    password = serializers.CharField(required=False, allow_blank=True, write_only=True, default="", max_length=ROOM_TEXT_MAX_LENGTH)
    password_changed = serializers.BooleanField(required=False, default=False)


class RoomLabelSerializer(serializers.ModelSerializer):
    class Meta:
        model = RoomLabel
        fields = (
            "id",
            "name",
            "color",
            "sort_order",
        )


class RoomSerializer(serializers.ModelSerializer):
    created_by_id = serializers.IntegerField(read_only=True)
    membership_status = serializers.SerializerMethodField()
    membership_role = serializers.SerializerMethodField()
    has_password = serializers.SerializerMethodField()
    total_tasks = serializers.SerializerMethodField()
    completed_tasks = serializers.SerializerMethodField()
    progress_percent = serializers.SerializerMethodField()
    is_pinned = serializers.SerializerMethodField()
    labels = RoomLabelSerializer(many=True, read_only=True)
    export_formats = serializers.SerializerMethodField()

    class Meta:
        model = Room
        fields = (
            "id",
            "title",
            "description",
            "dataset_label",
            "dataset_type",
            "annotation_workflow",
            "cross_validation_enabled",
            "cross_validation_annotators_count",
            "cross_validation_similarity_threshold",
            "deadline",
            "created_by_id",
            "membership_status",
            "membership_role",
            "has_password",
            "total_tasks",
            "completed_tasks",
            "progress_percent",
            "is_pinned",
            "labels",
            "export_formats",
            "created_at",
            "updated_at",
        )

    def get_membership_status(self, obj):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return None
        if obj.created_by_id == user.id:
            return "owner"
        membership = obj.memberships.filter(user=user).only("status").first()
        return membership.status if membership else None

    def get_membership_role(self, obj):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return None
        if obj.created_by_id == user.id:
            return "owner"
        membership = obj.memberships.filter(user=user).only("role").first()
        return membership.role if membership else None

    def get_has_password(self, obj):
        return obj.has_password

    def get_total_tasks(self, obj):
        return get_room_primary_tasks_queryset(room=obj).count()

    def get_completed_tasks(self, obj):
        return get_room_final_tasks_queryset(room=obj).filter(status="submitted").count()

    def get_progress_percent(self, obj):
        total = get_room_primary_tasks_queryset(room=obj).count()
        completed = get_room_final_tasks_queryset(room=obj).filter(status="submitted").count()
        if not total:
            return 0.0
        return round((completed / total) * 100, 1)

    def get_is_pinned(self, obj):
        if hasattr(obj, "is_pinned"):
            return bool(obj.is_pinned)

        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return False

        return RoomPin.objects.filter(room=obj, user=user).exists()

    def get_export_formats(self, obj):
        return get_supported_export_formats(room=obj)


class RoomMembershipSerializer(serializers.ModelSerializer):
    room_id = serializers.IntegerField(read_only=True)
    user_id = serializers.IntegerField(read_only=True)
    invited_by_id = serializers.IntegerField(read_only=True)
    user_email = serializers.EmailField(source="user.email", read_only=True)
    user_full_name = serializers.CharField(source="user.full_name", read_only=True)
    user_display_name = serializers.CharField(source="user.display_name", read_only=True)

    class Meta:
        model = RoomMembership
        fields = (
            "id",
            "room_id",
            "user_id",
            "invited_by_id",
            "user_email",
            "user_full_name",
            "user_display_name",
            "status",
            "role",
            "joined_at",
            "created_at",
            "updated_at",
        )


class RoomJoinRequestSerializer(serializers.ModelSerializer):
    room_id = serializers.IntegerField(read_only=True)
    user_id = serializers.IntegerField(read_only=True)
    reviewed_by_id = serializers.IntegerField(read_only=True)
    user_email = serializers.EmailField(source="user.email", read_only=True)
    user_full_name = serializers.CharField(source="user.full_name", read_only=True)
    user_display_name = serializers.CharField(source="user.display_name", read_only=True)
    reviewed_by_display_name = serializers.CharField(source="reviewed_by.display_name", read_only=True)

    class Meta:
        model = RoomJoinRequest
        fields = (
            "id",
            "room_id",
            "user_id",
            "user_email",
            "user_full_name",
            "user_display_name",
            "status",
            "reviewed_by_id",
            "reviewed_by_display_name",
            "reviewed_at",
            "created_at",
            "updated_at",
        )


class InviteAnnotatorSerializer(serializers.Serializer):
    annotator_id = serializers.IntegerField(min_value=1)


class RoomMembershipRoleSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=RoomMembership.Role.values)


class RoomAccessSerializer(serializers.Serializer):
    room_id = serializers.IntegerField(min_value=1)
    password = serializers.CharField(required=False, allow_blank=True)


class RoomJoinSerializer(serializers.Serializer):
    password = serializers.CharField(required=False, allow_blank=True)


class RoomJoinRequestDecisionSerializer(serializers.Serializer):
    pass


class RoomPinSerializer(serializers.Serializer):
    is_pinned = serializers.BooleanField()
