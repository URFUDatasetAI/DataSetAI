import json

from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

from apps.labeling.models import Task, TaskAssignment
from apps.rooms.models import Room, RoomJoinRequest, RoomLabel, RoomMembership, RoomPin
from apps.rooms.services import get_supported_export_formats, validate_dataset_upload
from apps.labeling.workflows import get_room_final_tasks_queryset, get_room_primary_tasks_queryset
from common.exceptions import ConflictError

ROOM_TEXT_MAX_LENGTH = 255
ROOM_TITLE_MAX_LENGTH = 128
ROOM_DESCRIPTION_MAX_LENGTH = 2000
ROOM_DEADLINE_MAX_DAYS_AHEAD = 365


class JsonStringField(serializers.Field):
    default_error_messages = {
        "invalid": "Ожидается JSON-значение или строка с JSON.",
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


class RoomDatasetTaskSerializer(serializers.ModelSerializer):
    room_id = serializers.IntegerField(read_only=True)
    parent_task_id = serializers.IntegerField(read_only=True)
    source_file_url = serializers.SerializerMethodField()
    assignments_count = serializers.SerializerMethodField()
    submitted_annotations_count = serializers.SerializerMethodField()

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
            "assignments_count",
            "submitted_annotations_count",
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

    def get_assignments_count(self, obj):
        if hasattr(obj, "assignments_count_value"):
            return obj.assignments_count_value
        return obj.assignments.filter(round_number=obj.current_round).count()

    def get_submitted_annotations_count(self, obj):
        if hasattr(obj, "submitted_annotations_count_value"):
            return obj.submitted_annotations_count_value
        return obj.annotations.filter(
            assignment__round_number=obj.current_round,
            assignment__status=TaskAssignment.Status.SUBMITTED,
        ).count()


class RoomDatasetUploadSerializer(serializers.Serializer):
    dataset_files = serializers.ListField(
        child=serializers.FileField(allow_empty_file=False),
        allow_empty=False,
        write_only=True,
    )
    media_manifest = JsonStringField(required=False)

    def validate(self, attrs):
        dataset_files = list(attrs.get("dataset_files") or [])
        media_manifest = attrs.get("media_manifest")

        try:
            validate_dataset_upload(dataset_mode=Room.DatasetType.IMAGE, dataset_files=dataset_files)
        except ConflictError as exc:
            raise serializers.ValidationError({"dataset_files": str(exc)}) from exc

        if media_manifest in (None, ""):
            attrs["media_manifest"] = []
        else:
            if not isinstance(media_manifest, list):
                raise serializers.ValidationError({"media_manifest": "Манифест медиа должен быть JSON-массивом."})
            serializer = MediaManifestItemSerializer(data=media_manifest, many=True)
            serializer.is_valid(raise_exception=True)
            attrs["media_manifest"] = serializer.validated_data

        return attrs


class RoomDatasetDeleteSerializer(serializers.Serializer):
    task_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        allow_empty=False,
    )


class RoomCreateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=ROOM_TITLE_MAX_LENGTH)
    description = serializers.CharField(required=False, allow_blank=True, max_length=ROOM_DESCRIPTION_MAX_LENGTH)
    password = serializers.CharField(required=False, allow_blank=True, write_only=True, max_length=ROOM_TEXT_MAX_LENGTH)
    deadline = serializers.DateTimeField(required=False, allow_null=True)
    cross_validation_enabled = serializers.BooleanField(required=False, default=False)
    cross_validation_annotators_count = serializers.IntegerField(required=False, min_value=1, max_value=20, default=1)
    cross_validation_similarity_threshold = serializers.IntegerField(required=False, min_value=1, max_value=100, default=80)
    review_voting_enabled = serializers.BooleanField(required=False, default=False)
    review_votes_required = serializers.IntegerField(required=False, min_value=1, max_value=20, default=1)
    review_acceptance_threshold = serializers.IntegerField(required=False, min_value=1, max_value=100, default=100)
    owner_is_annotator = serializers.BooleanField(required=False, default=True)
    default_assignment_quota = serializers.IntegerField(required=False, min_value=0, allow_null=True)
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

    def validate_deadline(self, value):
        if value is None:
            return value

        now = timezone.now()
        latest_allowed = now + timedelta(days=ROOM_DEADLINE_MAX_DAYS_AHEAD)
        if value <= now:
            raise serializers.ValidationError("Укажи дедлайн в будущем.")
        if value > latest_allowed:
            raise serializers.ValidationError(
                f"Дедлайн можно поставить не дальше чем на {ROOM_DEADLINE_MAX_DAYS_AHEAD} дней вперёд."
            )
        return value

    def validate(self, attrs):
        if attrs.get("cross_validation_enabled"):
            if attrs.get("cross_validation_annotators_count", 1) < 2:
                raise serializers.ValidationError(
                    {"cross_validation_annotators_count": "Укажи минимум 2 независимых разметчика для перекрестной разметки."}
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
                {"annotation_workflow": "Сценарий Object detect + text доступен только для датасетов с изображениями или видео."}
            )

        try:
            validate_dataset_upload(dataset_mode=dataset_mode, dataset_files=dataset_files)
        except ConflictError as exc:
            raise serializers.ValidationError({"dataset_files": str(exc)}) from exc

        if labels is None:
            attrs["labels"] = []
        else:
            if not isinstance(labels, list):
                raise serializers.ValidationError({"labels": "Лейблы должны быть JSON-массивом."})
            serializer = RoomLabelDefinitionSerializer(data=labels, many=True)
            serializer.is_valid(raise_exception=True)
            attrs["labels"] = serializer.validated_data

        if (
            dataset_mode in (Room.DatasetType.IMAGE, Room.DatasetType.VIDEO)
            and annotation_workflow != Room.AnnotationWorkflow.TEXT_DETECTION_TRANSCRIPTION
            and not attrs["labels"]
        ):
            raise serializers.ValidationError({"labels": "Добавь хотя бы один лейбл для датасета с изображениями или видео."})

        if media_manifest in (None, ""):
            attrs["media_manifest"] = []
        else:
            if not isinstance(media_manifest, list):
                raise serializers.ValidationError({"media_manifest": "Манифест медиа должен быть JSON-массивом."})
            serializer = MediaManifestItemSerializer(data=media_manifest, many=True)
            serializer.is_valid(raise_exception=True)
            attrs["media_manifest"] = serializer.validated_data

        return attrs


class RoomUpdateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=ROOM_TITLE_MAX_LENGTH, required=False)
    description = serializers.CharField(required=False, allow_blank=True, max_length=ROOM_DESCRIPTION_MAX_LENGTH)
    dataset_label = serializers.CharField(required=False, allow_blank=True, max_length=ROOM_TEXT_MAX_LENGTH)
    deadline = serializers.DateTimeField(required=False, allow_null=True)
    password = serializers.CharField(required=False, allow_blank=True, write_only=True, max_length=ROOM_TEXT_MAX_LENGTH)
    has_password = serializers.BooleanField(required=False)
    cross_validation_enabled = serializers.BooleanField(required=False)
    cross_validation_annotators_count = serializers.IntegerField(required=False, min_value=1, max_value=20)
    cross_validation_similarity_threshold = serializers.IntegerField(required=False, min_value=1, max_value=100)
    review_voting_enabled = serializers.BooleanField(required=False)
    review_votes_required = serializers.IntegerField(required=False, min_value=1, max_value=20)
    review_acceptance_threshold = serializers.IntegerField(required=False, min_value=1, max_value=100)
    owner_is_annotator = serializers.BooleanField(required=False)
    default_assignment_quota = serializers.IntegerField(required=False, min_value=0, allow_null=True)

    def validate_deadline(self, value):
        if value is None:
            return value

        now = timezone.now()
        latest_allowed = now + timedelta(days=ROOM_DEADLINE_MAX_DAYS_AHEAD)
        if value <= now:
            raise serializers.ValidationError("Укажи дедлайн в будущем.")
        if value > latest_allowed:
            raise serializers.ValidationError(
                f"Дедлайн можно поставить не дальше чем на {ROOM_DEADLINE_MAX_DAYS_AHEAD} дней вперёд."
            )
        return value

    def validate(self, attrs):
        room = self.instance
        cross_validation_enabled = attrs.get(
            "cross_validation_enabled",
            room.cross_validation_enabled if room is not None else False,
        )
        cross_validation_count = attrs.get(
            "cross_validation_annotators_count",
            room.cross_validation_annotators_count if room is not None else 1,
        )

        if cross_validation_enabled:
            if cross_validation_count < 2:
                raise serializers.ValidationError(
                    {"cross_validation_annotators_count": "Укажи минимум 2 независимых разметчика для перекрестной разметки."}
                )
        else:
            attrs["cross_validation_annotators_count"] = 1

        has_password = attrs.get("has_password")
        password = attrs.get("password")
        if has_password is None and password:
            attrs["has_password"] = True
            has_password = True

        if has_password is True and not password and room is not None and not room.has_password:
            raise serializers.ValidationError(
                {"password": "Укажи пароль или отключи защиту паролем перед сохранением."}
            )

        return attrs


class RoomDeleteSerializer(serializers.Serializer):
    password = serializers.CharField(write_only=True, max_length=ROOM_TEXT_MAX_LENGTH)

    def validate_password(self, value):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated or not user.check_password(value):
            raise serializers.ValidationError("Укажи текущий пароль владельца комнаты.")
        return value


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
    pin_sort_order = serializers.SerializerMethodField()
    last_accessed_at = serializers.SerializerMethodField()
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
            "review_voting_enabled",
            "review_votes_required",
            "review_acceptance_threshold",
            "owner_is_annotator",
            "default_assignment_quota",
            "deadline",
            "created_by_id",
            "membership_status",
            "membership_role",
            "has_password",
            "total_tasks",
            "completed_tasks",
            "progress_percent",
            "is_pinned",
            "pin_sort_order",
            "last_accessed_at",
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

    def get_pin_sort_order(self, obj):
        if hasattr(obj, "pin_sort_order"):
            return obj.pin_sort_order

        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return None

        pin = RoomPin.objects.filter(room=obj, user=user).order_by("sort_order", "id").first()
        return pin.sort_order if pin else None

    def get_last_accessed_at(self, obj):
        if hasattr(obj, "last_accessed_at"):
            return obj.last_accessed_at.isoformat() if obj.last_accessed_at else None
        return None

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


class RoomAssignmentQuotaSerializer(serializers.Serializer):
    task_quota = serializers.IntegerField(min_value=0, allow_null=True, required=False)

    def validate(self, attrs):
        if "task_quota" not in attrs:
            raise serializers.ValidationError({"task_quota": "Укажи значение квоты или null, чтобы вернуться к стандартной квоте комнаты."})
        return attrs


class RoomJoinSerializer(serializers.Serializer):
    password = serializers.CharField(required=False, allow_blank=True)


class RoomJoinRequestDecisionSerializer(serializers.Serializer):
    pass


class RoomPinSerializer(serializers.Serializer):
    is_pinned = serializers.BooleanField()


class RoomPinReorderSerializer(serializers.Serializer):
    direction = serializers.ChoiceField(choices=("up", "down"), required=False)
    ordered_room_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=False,
    )

    def validate(self, attrs):
        if not attrs.get("direction") and not attrs.get("ordered_room_ids"):
            raise serializers.ValidationError("Укажи направление или новый порядок закреплённых комнат.")
        return attrs
