from rest_framework import serializers

from apps.rooms.models import Room, RoomMembership


class RoomCreateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True)
    password = serializers.CharField(required=False, allow_blank=True, write_only=True)
    deadline = serializers.DateTimeField(required=False, allow_null=True)
    annotator_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=True,
    )
    dataset_mode = serializers.ChoiceField(choices=("demo",), required=False, default="demo")
    test_task_count = serializers.IntegerField(required=False, min_value=1, max_value=100, default=12)
    dataset_label = serializers.CharField(required=False, allow_blank=True, default="Тестовый датасет")


class RoomSerializer(serializers.ModelSerializer):
    created_by_id = serializers.IntegerField(read_only=True)
    membership_status = serializers.SerializerMethodField()
    has_password = serializers.SerializerMethodField()
    total_tasks = serializers.SerializerMethodField()
    completed_tasks = serializers.SerializerMethodField()
    progress_percent = serializers.SerializerMethodField()

    class Meta:
        model = Room
        fields = (
            "id",
            "title",
            "description",
            "dataset_label",
            "deadline",
            "created_by_id",
            "membership_status",
            "has_password",
            "total_tasks",
            "completed_tasks",
            "progress_percent",
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

    def get_has_password(self, obj):
        return obj.has_password

    def get_total_tasks(self, obj):
        return obj.tasks.count()

    def get_completed_tasks(self, obj):
        return obj.tasks.filter(status="submitted").count()

    def get_progress_percent(self, obj):
        total = obj.tasks.count()
        completed = obj.tasks.filter(status="submitted").count()
        if not total:
            return 0.0
        return round((completed / total) * 100, 1)


class RoomMembershipSerializer(serializers.ModelSerializer):
    room_id = serializers.IntegerField(read_only=True)
    user_id = serializers.IntegerField(read_only=True)
    invited_by_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = RoomMembership
        fields = (
            "id",
            "room_id",
            "user_id",
            "invited_by_id",
            "status",
            "joined_at",
            "created_at",
            "updated_at",
        )


class InviteAnnotatorSerializer(serializers.Serializer):
    annotator_id = serializers.IntegerField(min_value=1)


class RoomAccessSerializer(serializers.Serializer):
    room_id = serializers.IntegerField(min_value=1)
    password = serializers.CharField(required=False, allow_blank=True)


class RoomJoinSerializer(serializers.Serializer):
    password = serializers.CharField(required=False, allow_blank=True)
