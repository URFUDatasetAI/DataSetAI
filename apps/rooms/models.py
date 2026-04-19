import secrets

from django.conf import settings
from django.db import models
from django.contrib.auth.hashers import check_password, make_password
from django.core.validators import RegexValidator
from django.utils import timezone

from common.models import TimeStampedModel

"""
Core room-domain models.

The room is the aggregate root for labeling sessions:
- owner creates the room
- memberships control who may participate
- labels define the allowed annotation vocabulary
"""


ROOM_INVITE_TOKEN_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"
ROOM_INVITE_TOKEN_LENGTH = 10


def generate_room_invite_token() -> str:
    return "".join(
        secrets.choice(ROOM_INVITE_TOKEN_ALPHABET)
        for _ in range(ROOM_INVITE_TOKEN_LENGTH)
    )


class Room(TimeStampedModel):
    """
    The aggregate root defining a labeling dataset container.
    
    A Room combines Dataset Configuration, Tasks to label, User memberships/roles,
    and cross-validation requirements.
    
    Attributes:
        cross_validation_enabled: If False, one review closes the task. If True, 
            multiple views from different annotators are required before taking consensus.
        annotation_workflow: Standard (classify/bbox) or specific pipelines like Object detect + text transcription.
    """
    class DatasetType(models.TextChoices):
        DEMO = "demo", "Demo"
        JSON = "json", "JSON"
        IMAGE = "image", "Image"
        VIDEO = "video", "Video"

    class AnnotationWorkflow(models.TextChoices):
        STANDARD = "standard", "Standard"
        TEXT_DETECTION_TRANSCRIPTION = "text_detect_text", "Object detect + text"

    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    invite_token = models.CharField(
        max_length=ROOM_INVITE_TOKEN_LENGTH,
        default=generate_room_invite_token,
        unique=True,
        editable=False,
    )
    access_password_hash = models.CharField(max_length=255, blank=True)
    deadline = models.DateTimeField(null=True, blank=True)
    dataset_label = models.CharField(max_length=255, blank=True)
    dataset_type = models.CharField(
        max_length=16,
        choices=DatasetType.choices,
        default=DatasetType.DEMO,
    )
    annotation_workflow = models.CharField(
        max_length=32,
        choices=AnnotationWorkflow.choices,
        default=AnnotationWorkflow.STANDARD,
    )
    cross_validation_enabled = models.BooleanField(default=False)
    cross_validation_annotators_count = models.PositiveSmallIntegerField(default=1)
    cross_validation_similarity_threshold = models.PositiveSmallIntegerField(default=80)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="created_rooms",
    )

    class Meta:
        ordering = ("-created_at", "-id")

    def __str__(self) -> str:
        return self.title

    @property
    def has_password(self) -> bool:
        return bool(self.access_password_hash)

    def set_access_password(self, raw_password: str) -> None:
        self.access_password_hash = make_password(raw_password) if raw_password else ""

    def check_access_password(self, raw_password: str) -> bool:
        if not self.access_password_hash:
            return True
        return check_password(raw_password or "", self.access_password_hash)

    @property
    def required_reviews_per_item(self) -> int:
        # Single-review is the default path; cross-validation promotes the task
        # to multi-review rounds handled in `apps.labeling.services`.
        if not self.cross_validation_enabled:
            return 1
        return max(1, self.cross_validation_annotators_count)


class RoomLabel(TimeStampedModel):
    """
    Represents a specific tag/class/label available for annotators within a Room.
    
    Usually associated with a color and sorted by `sort_order` for UI consistency.
    """
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="labels")
    name = models.CharField(max_length=64)
    color = models.CharField(
        max_length=7,
        validators=[RegexValidator(regex=r"^#[0-9A-Fa-f]{6}$")],
    )
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ("sort_order", "id")
        constraints = [
            models.UniqueConstraint(fields=("room", "name"), name="unique_room_label_name"),
        ]

    def __str__(self) -> str:
        return f"{self.room_id}:{self.name}"


class RoomMembership(TimeStampedModel):
    """
    Defines Access Control and the Role of a user inside a specific Room.
    
    Possible roles:
    - ANNOTATOR: Fills out tasks.
    - ADMIN: Manages room settings and invites.
    - TESTER: Special role for verifying functionalities.
    """
    class Status(models.TextChoices):
        INVITED = "invited", "Invited"
        JOINED = "joined", "Joined"

    class Role(models.TextChoices):
        ANNOTATOR = "annotator", "Annotator"
        ADMIN = "admin", "Admin"
        TESTER = "tester", "Inspector"

    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="room_memberships",
    )
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="sent_room_invitations",
    )
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.INVITED)
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.ANNOTATOR)
    joined_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("room_id", "user_id")
        constraints = [
            models.UniqueConstraint(fields=("room", "user"), name="unique_room_membership"),
        ]

    def __str__(self) -> str:
        return f"{self.room_id}:{self.user_id}:{self.status}"


class RoomPin(TimeStampedModel):
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="pins")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="room_pins",
    )
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ("sort_order", "id")
        constraints = [
            models.UniqueConstraint(fields=("room", "user"), name="unique_room_pin"),
        ]

    def __str__(self) -> str:
        return f"{self.room_id}:{self.user_id}"


class RoomVisit(TimeStampedModel):
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="visits")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="room_visits",
    )
    last_accessed_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ("-last_accessed_at", "-id")
        constraints = [
            models.UniqueConstraint(fields=("room", "user"), name="unique_room_visit"),
        ]

    def __str__(self) -> str:
        return f"{self.room_id}:{self.user_id}:{self.last_accessed_at.isoformat()}"


class RoomJoinRequest(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="join_requests")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="room_join_requests",
    )
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reviewed_room_join_requests",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at", "-id")
        constraints = [
            models.UniqueConstraint(fields=("room", "user"), name="unique_room_join_request"),
        ]

    def __str__(self) -> str:
        return f"{self.room_id}:{self.user_id}:{self.status}"
