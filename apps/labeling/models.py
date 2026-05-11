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


def frame_source_upload_to(instance, filename: str) -> str:
    video_id = getattr(instance, "video_id", None) or "unknown"
    return f"frame_sources/video_{video_id}/{uuid4().hex}_{filename}"


class Task(TimeStampedModel):
    """
    Represents a single unit of work in a labeling Room.
    
    A Task could be:
    - A single JSON object or Text string (for text tasks).
    - A single image or a video frame (for media tasks).
    
    Attributes:
        input_payload: JSON field storing dynamic properties like coordinates, original text, etc.
        status: The current progression of the task (pending, in_progress, in_review, submitted).
        current_round: Tracks the number of consensus-rounds this task has been through.
        validation_score: Cross-validation match rate (if applicable).
        consensus_payload: Final converged result once enough reviewers agree.
        workflow_stage: For multi-stage pipelines (e.g. text_detection followed by text_transcription).
    """
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        IN_PROGRESS = "in_progress", "In progress"
        IN_REVIEW = "in_review", "In review"
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


class ValidationVote(TimeStampedModel):
    class Decision(models.TextChoices):
        APPROVE = "approve", "Approve"
        REJECT = "reject", "Reject"

    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="validation_votes")
    voter = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="validation_votes",
    )
    round_number = models.PositiveIntegerField(default=1)
    decision = models.CharField(max_length=16, choices=Decision.choices)
    comment = models.TextField(blank=True)

    class Meta:
        ordering = ("task_id", "round_number", "voter_id")
        constraints = [
            models.UniqueConstraint(fields=("task", "round_number", "voter"), name="unique_validation_vote_round_voter"),
        ]
        indexes = [
            models.Index(fields=("task", "round_number", "decision"), name="labeling_vv_task_ro_2df2a5_idx"),
            models.Index(fields=("voter", "decision"), name="labeling_vv_voter_1d19f7_idx"),
        ]

    def __str__(self) -> str:
        return f"ValidationVote task={self.task_id} voter={self.voter_id} round={self.round_number}"


class VideoSelection(TimeStampedModel):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        GENERATED = "generated", "Generated"

    video = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="video_selections")
    start_frame = models.PositiveIntegerField()
    end_frame = models.PositiveIntegerField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="video_selections",
    )

    class Meta:
        ordering = ("start_frame", "end_frame", "id")
        indexes = [
            models.Index(fields=("video", "status"), name="labeling_vs_video_s_2d969e_idx"),
        ]

    def __str__(self) -> str:
        return f"VideoSelection video={self.video_id} frames={self.start_frame}-{self.end_frame}"


class FrameAnnotationTask(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        IN_PROGRESS = "in_progress", "In progress"
        DONE = "done", "Done"
        SKIPPED = "skipped", "Skipped"
        UNCERTAIN = "uncertain", "Uncertain"

    video = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="frame_annotation_tasks")
    frame_index = models.PositiveIntegerField()
    time_ms = models.PositiveIntegerField(default=0)
    source_segment = models.ForeignKey(
        VideoSelection,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="frame_tasks",
    )
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="frame_annotation_tasks",
    )
    frame_image = models.FileField(upload_to=frame_source_upload_to, blank=True)

    class Meta:
        ordering = ("video_id", "frame_index", "id")
        constraints = [
            models.UniqueConstraint(fields=("video", "frame_index"), name="unique_video_frame_annotation_task"),
        ]
        indexes = [
            models.Index(fields=("video", "status"), name="labeling_fat_video__0d6ad5_idx"),
            models.Index(fields=("assigned_to", "status"), name="labeling_fat_assign_ef78dd_idx"),
        ]

    def __str__(self) -> str:
        return f"FrameAnnotationTask video={self.video_id} frame={self.frame_index}"


class FrameAnnotation(TimeStampedModel):
    class Status(models.TextChoices):
        ANNOTATED = "annotated", "Annotated"
        EMPTY = "empty", "Empty"
        UNCERTAIN = "uncertain", "Uncertain"

    task = models.ForeignKey(FrameAnnotationTask, on_delete=models.CASCADE, related_name="annotations")
    video = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="frame_annotations")
    frame_index = models.PositiveIntegerField()
    status = models.CharField(max_length=16, choices=Status.choices)
    objects_payload = models.JSONField(db_column="objects", default=list)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="frame_annotations",
    )

    class Meta:
        ordering = ("video_id", "frame_index", "id")
        constraints = [
            models.UniqueConstraint(fields=("task", "created_by"), name="unique_frame_annotation_task_user"),
        ]
        indexes = [
            models.Index(fields=("video", "status"), name="labeling_fa_video_s_d56b4d_idx"),
        ]

    def __str__(self) -> str:
        return f"FrameAnnotation task={self.task_id} status={self.status}"
