from django.conf import settings
from django.db import models
from uuid import uuid4

from common.models import TimeStampedModel

"""
Task/assignment/annotation models for the labeling pipeline.

`Task` is the unit of work.
`TaskAssignment` tracks who is currently working on it for a round.
`Annotation` stores the submitted result bound to a concrete assignment.
"""


def task_source_upload_to(instance, filename: str) -> str:
    return f"task_sources/room_{instance.room_id}/{uuid4().hex}_{filename}"


class Task(TimeStampedModel):
    """
    Represents a single unit of work in a labeling Room.
    
    A Task could be:
    - A single JSON object or Text string (for text tasks).
    - A single image or a video frame (for media tasks).
    
    Attributes:
        input_payload: JSON field storing dynamic properties like coordinates, original text, etc.
        status: The current progression of the task (pending, in_progress, submitted).
        current_round: Tracks the number of consensus-rounds this task has been through.
        validation_score: Cross-validation match rate (if applicable).
        consensus_payload: Final converged result once enough reviewers agree.
        workflow_stage: For multi-stage pipelines (e.g. text_detection followed by text_transcription).
    """
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        IN_PROGRESS = "in_progress", "In progress"
        SUBMITTED = "submitted", "Submitted"

    class SourceType(models.TextChoices):
        TEXT = "text", "Text"
        IMAGE = "image", "Image"
        VIDEO = "video", "Video"

    class WorkflowStage(models.TextChoices):
        STANDARD = "standard", "Standard"
        TEXT_DETECTION = "text_detection", "Text detection"
        TEXT_TRANSCRIPTION = "text_transcription", "Text transcription"

    room = models.ForeignKey("rooms.Room", on_delete=models.CASCADE, related_name="tasks")
    input_payload = models.JSONField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    current_round = models.PositiveIntegerField(default=1)
    validation_score = models.FloatField(null=True, blank=True)
    consensus_payload = models.JSONField(null=True, blank=True)
    source_type = models.CharField(
        max_length=16,
        choices=SourceType.choices,
        default=SourceType.TEXT,
    )
    workflow_stage = models.CharField(
        max_length=32,
        choices=WorkflowStage.choices,
        default=WorkflowStage.STANDARD,
    )
    source_file = models.FileField(upload_to=task_source_upload_to, blank=True)
    source_name = models.CharField(max_length=255, blank=True)
    parent_task = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="child_tasks",
    )

    class Meta:
        ordering = ("id",)
        indexes = [
            models.Index(fields=("room", "status")),
            models.Index(fields=("room", "workflow_stage", "status"), name="labeling_ta_room_id_5f2def_idx"),
        ]

    def __str__(self) -> str:
        return f"Task {self.id} in room {self.room_id}"


class Annotation(TimeStampedModel):
    """
    Represents the final result (label/bounding-box) provided by an Annotator for a specific Task.
    
    Since multiple users can annotate the same Task (during cross-validation), this is cleanly separated
    from the Task model itself.
    """
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="annotations")
    assignment = models.OneToOneField(
        "labeling.TaskAssignment",
        on_delete=models.CASCADE,
        related_name="annotation",
    )
    annotator = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="annotations",
    )
    result_payload = models.JSONField()
    submitted_at = models.DateTimeField()

    class Meta:
        ordering = ("-submitted_at", "-id")

    def __str__(self) -> str:
        return f"Annotation {self.id} for task {self.task_id}"


class TaskAssignment(TimeStampedModel):
    """
    State mapping between a Task and an Annotator for a specific round of labeling.
    
    This is created lazily when an annotator requests a task. It ensures we do not over-assign
    or lose track of progress for specific workers.
    """
    class Status(models.TextChoices):
        IN_PROGRESS = "in_progress", "In progress"
        SUBMITTED = "submitted", "Submitted"
        SKIPPED = "skipped", "Skipped"

    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="assignments")
    annotator = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="task_assignments",
    )
    round_number = models.PositiveIntegerField(default=1)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.IN_PROGRESS)
    assigned_at = models.DateTimeField()
    submitted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("task_id", "round_number", "annotator_id")
        constraints = [
            models.UniqueConstraint(fields=("task", "annotator", "round_number"), name="unique_task_assignment_round_annotator"),
        ]
        indexes = [
            models.Index(fields=("task", "status"), name="labeling_ta_task_st_4f3f33_idx"),
            models.Index(fields=("annotator", "status"), name="labeling_ta_annota_86cd11_idx"),
            models.Index(fields=("task", "round_number", "status"), name="labeling_ta_task_ro_217969_idx"),
        ]

    def __str__(self) -> str:
        return f"Assignment task={self.task_id} annotator={self.annotator_id} round={self.round_number}"
