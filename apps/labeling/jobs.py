import math
import shutil
import subprocess
import tempfile
from pathlib import Path

from django.core.files.base import ContentFile
from django.db import transaction

from apps.labeling.models import Task, VideoAsset, VideoFrame
from apps.labeling.workflows import get_room_primary_tasks_queryset
from apps.rooms.models import Room


def _get_next_room_item_number(*, room) -> int:
    item_numbers = [
        int(value)
        for value in get_room_primary_tasks_queryset(room=room).values_list("input_payload__item_number", flat=True)
        if isinstance(value, int) or (isinstance(value, str) and value.isdigit())
    ]
    return (max(item_numbers) if item_numbers else 0) + 1


def _build_frame_extract_command(*, ffmpeg_path: str, source_path: Path, frame_pattern: Path, extraction_fps: int | None) -> list[str]:
    command = [
        ffmpeg_path,
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(source_path),
    ]
    if extraction_fps:
        command.extend(["-vf", f"fps={int(extraction_fps)}"])
    command.extend(["-vsync", "0", str(frame_pattern)])
    return command


def _get_manual_keyframe_indices(*, total_frames: int, percent: int) -> set[int]:
    normalized_percent = max(1, min(int(percent or 10), 100))
    interval = max(1, math.ceil(100 / normalized_percent))
    indices = {1, total_frames}
    indices.update(index for index in range(1, total_frames + 1) if (index - 1) % interval == 0)
    return indices


def _maybe_update_room_default_quota(*, video_asset: VideoAsset) -> None:
    if not video_asset.auto_default_assignment_quota:
        return
    room = Room.objects.select_for_update().get(id=video_asset.room_id)
    if room.default_assignment_quota is not None:
        return
    if room.video_assets.filter(auto_default_assignment_quota=True).exclude(status__in=(VideoAsset.Status.READY, VideoAsset.Status.FAILED)).exists():
        return
    manual_count = VideoFrame.objects.filter(
        video_asset__room=room,
        role=VideoFrame.Role.MANUAL_KEYFRAME,
    ).count()
    room.default_assignment_quota = manual_count
    room.save(update_fields=["default_assignment_quota", "updated_at"])


def extract_video_frames(video_asset_id: int) -> None:
    """
    RQ job: extract source video into frame image Tasks and VideoFrame metadata.
    The first version is deliberately rules-only: no ML detector/filtering.
    """
    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        with transaction.atomic():
            asset = VideoAsset.objects.select_for_update().get(id=video_asset_id)
            asset.status = VideoAsset.Status.FAILED
            asset.error_message = "FFmpeg is not installed on this host."
            asset.save(update_fields=["status", "error_message", "updated_at"])
        return

    asset = VideoAsset.objects.select_related("room").get(id=video_asset_id)
    with transaction.atomic():
        locked_asset = VideoAsset.objects.select_for_update().select_related("room").get(id=asset.id)
        if locked_asset.frames.exists():
            locked_asset.status = VideoAsset.Status.READY
            locked_asset.error_message = ""
            locked_asset.save(update_fields=["status", "error_message", "updated_at"])
            _maybe_update_room_default_quota(video_asset=locked_asset)
            return
        locked_asset.status = VideoAsset.Status.PROCESSING
        locked_asset.error_message = ""
        locked_asset.save(update_fields=["status", "error_message", "updated_at"])

    try:
        with tempfile.TemporaryDirectory(prefix="datasetai_video_") as temp_dir:
            frame_dir = Path(temp_dir) / "frames"
            frame_dir.mkdir(parents=True, exist_ok=True)
            frame_pattern = frame_dir / "frame_%06d.jpg"
            subprocess.run(
                _build_frame_extract_command(
                    ffmpeg_path=ffmpeg_path,
                    source_path=Path(asset.source_file.path),
                    frame_pattern=frame_pattern,
                    extraction_fps=asset.extraction_fps,
                ),
                check=True,
                capture_output=True,
            )

            frame_paths = sorted(frame_dir.glob("frame_*.jpg"))
            frame_step = max(1, int(asset.frame_step or 1))
            sampled_frame_paths = [
                frame_path
                for index, frame_path in enumerate(frame_paths, start=1)
                if (index - 1) % frame_step == 0
            ][: max(1, int(asset.max_frames or 1))]
            if not sampled_frame_paths:
                raise RuntimeError(f"Video {asset.source_name} does not contain frames for annotation.")

            with transaction.atomic():
                locked_asset = VideoAsset.objects.select_for_update().select_related("room").get(id=asset.id)
                next_item_number = _get_next_room_item_number(room=locked_asset.room)
                manual_indices = _get_manual_keyframe_indices(
                    total_frames=len(sampled_frame_paths),
                    percent=locked_asset.manual_keyframe_percent,
                )
                frame_rate = int(locked_asset.extraction_fps or locked_asset.source_frame_rate or 25)
                for output_index, frame_path in enumerate(sampled_frame_paths, start=1):
                    source_frame_number = ((output_index - 1) * frame_step) + 1
                    frame_name = f"{Path(locked_asset.source_name).stem}_frame_{source_frame_number:06d}.jpg"
                    is_manual_keyframe = output_index in manual_indices
                    task = Task(
                        room=locked_asset.room,
                        source_type=Task.SourceType.IMAGE,
                        workflow_stage=(
                            Task.WorkflowStage.TEXT_DETECTION
                            if locked_asset.room.annotation_workflow == Room.AnnotationWorkflow.TEXT_DETECTION_TRANSCRIPTION
                            else Task.WorkflowStage.STANDARD
                        ),
                        source_name=frame_name,
                        input_payload={
                            "dataset": locked_asset.room.dataset_label,
                            "item_number": next_item_number,
                            "source_name": frame_name,
                            "origin_source_type": Task.SourceType.VIDEO,
                            "video_asset_id": locked_asset.id,
                            "video_name": locked_asset.source_name,
                            "frame_number": source_frame_number,
                            "frame_index": output_index,
                            "frame_rate": frame_rate,
                            "frame_timestamp": round((source_frame_number - 1) / frame_rate, 3),
                            "duration": locked_asset.duration or 0,
                            **({"width": locked_asset.width} if locked_asset.width else {}),
                            **({"height": locked_asset.height} if locked_asset.height else {}),
                        },
                    )
                    task.source_file.save(frame_name, ContentFile(frame_path.read_bytes()), save=False)
                    task.save()
                    VideoFrame.objects.create(
                        video_asset=locked_asset,
                        task=task,
                        frame_number=source_frame_number,
                        timestamp=task.input_payload["frame_timestamp"],
                        role=(
                            VideoFrame.Role.MANUAL_KEYFRAME
                            if is_manual_keyframe
                            else VideoFrame.Role.INTERPOLATION_TARGET
                        ),
                        state=(
                            VideoFrame.State.PENDING_MANUAL
                            if is_manual_keyframe
                            else VideoFrame.State.WAITING_INTERPOLATION
                        ),
                    )
                    next_item_number += 1

                locked_asset.status = VideoAsset.Status.READY
                locked_asset.error_message = ""
                locked_asset.save(update_fields=["status", "error_message", "updated_at"])
                _maybe_update_room_default_quota(video_asset=locked_asset)
    except (subprocess.CalledProcessError, RuntimeError, OSError) as exc:
        stderr = ""
        if isinstance(exc, subprocess.CalledProcessError):
            stderr = exc.stderr.decode("utf-8", errors="ignore").strip()
        message = stderr or str(exc) or "Failed to extract video frames."
        with transaction.atomic():
            locked_asset = VideoAsset.objects.select_for_update().get(id=video_asset_id)
            locked_asset.status = VideoAsset.Status.FAILED
            locked_asset.error_message = message[:4000]
            locked_asset.save(update_fields=["status", "error_message", "updated_at"])


def _payload_annotations_by_track(payload: dict | None) -> dict[str, list[dict]]:
    annotations_by_track: dict[str, list[dict]] = {}
    if not payload:
        return annotations_by_track
    for item in payload.get("annotations", []):
        track_id = str(item.get("track_id") or "").strip()
        if not track_id:
            continue
        annotations_by_track.setdefault(track_id, []).append(item)
    return annotations_by_track


def _interpolate_bbox(left: dict, right: dict, ratio: float) -> dict:
    left_points = [float(value) for value in left.get("points", [])]
    right_points = [float(value) for value in right.get("points", [])]
    points = [
        round(left_points[index] + (right_points[index] - left_points[index]) * ratio, 2)
        for index in range(4)
    ]
    return {
        "type": "bbox",
        "label_id": left["label_id"],
        "points": points,
        "frame": 0,
        "attributes": left.get("attributes", []),
        "occluded": bool(left.get("occluded") or right.get("occluded")),
        "track_id": left["track_id"],
        "source": "generated_interpolation",
    }


def _build_trajectory_warnings(*, left: dict, right: dict, frame_span: int) -> list[str]:
    if frame_span <= 0:
        return []
    left_points = [float(value) for value in left.get("points", [])]
    right_points = [float(value) for value in right.get("points", [])]
    left_width = max(left_points[2] - left_points[0], 1)
    left_height = max(left_points[3] - left_points[1], 1)
    right_width = max(right_points[2] - right_points[0], 1)
    right_height = max(right_points[3] - right_points[1], 1)
    left_center = ((left_points[0] + left_points[2]) / 2, (left_points[1] + left_points[3]) / 2)
    right_center = ((right_points[0] + right_points[2]) / 2, (right_points[1] + right_points[3]) / 2)
    center_shift = math.dist(left_center, right_center) / frame_span
    warnings = []
    if center_shift > max(left_width, left_height) * 1.5:
        warnings.append("abrupt_center_jump")
    if max(left_width, right_width) / max(min(left_width, right_width), 1) > 2.5:
        warnings.append("abrupt_width_change")
    if max(left_height, right_height) / max(min(left_height, right_height), 1) > 2.5:
        warnings.append("abrupt_height_change")
    return warnings


def interpolate_video_asset(video_asset_id: int) -> None:
    asset = VideoAsset.objects.get(id=video_asset_id)
    frames = list(
        VideoFrame.objects.select_related("task")
        .filter(video_asset=asset)
        .order_by("frame_number", "id")
    )
    accepted_frames = [
        frame
        for frame in frames
        if frame.task.status == Task.Status.SUBMITTED
        and frame.task.consensus_payload is not None
        and frame.state in (VideoFrame.State.MANUAL_SUBMITTED, VideoFrame.State.GENERATED_ACCEPTED)
    ]
    targets_by_number = {
        frame.frame_number: frame
        for frame in frames
        if frame.role == VideoFrame.Role.INTERPOLATION_TARGET
        and frame.state in (VideoFrame.State.WAITING_INTERPOLATION, VideoFrame.State.GENERATED_REJECTED)
        and frame.task.status == Task.Status.PENDING
    }
    if len(accepted_frames) < 2 or not targets_by_number:
        return

    keyframes_by_track: dict[str, list[tuple[VideoFrame, dict]]] = {}
    for frame in accepted_frames:
        for track_id, annotations in _payload_annotations_by_track(frame.task.consensus_payload).items():
            for annotation in annotations:
                keyframes_by_track.setdefault(track_id, []).append((frame, annotation))

    generated_by_target: dict[int, list[dict]] = {}
    generated_from_by_target: dict[int, set[int]] = {}
    warnings_by_target: dict[int, set[str]] = {}
    for track_id, keyed_items in keyframes_by_track.items():
        keyed_items.sort(key=lambda item: item[0].frame_number)
        for (left_frame, left_annotation), (right_frame, right_annotation) in zip(keyed_items, keyed_items[1:]):
            if left_annotation.get("label_id") != right_annotation.get("label_id"):
                continue
            frame_span = right_frame.frame_number - left_frame.frame_number
            if frame_span <= 1:
                continue
            warnings = _build_trajectory_warnings(
                left=left_annotation,
                right=right_annotation,
                frame_span=frame_span,
            )
            for frame_number in sorted(targets_by_number):
                if frame_number <= left_frame.frame_number or frame_number >= right_frame.frame_number:
                    continue
                ratio = (frame_number - left_frame.frame_number) / frame_span
                generated = _interpolate_bbox(left_annotation, right_annotation, ratio)
                generated["track_id"] = track_id
                generated_by_target.setdefault(frame_number, []).append(generated)
                generated_from_by_target.setdefault(frame_number, set()).update(
                    {left_frame.frame_number, right_frame.frame_number}
                )
                warnings_by_target.setdefault(frame_number, set()).update(warnings)

    with transaction.atomic():
        locked_asset = VideoAsset.objects.select_for_update().get(id=video_asset_id)
        for frame_number, annotations in generated_by_target.items():
            frame = VideoFrame.objects.select_for_update().select_related("task").get(
                video_asset=locked_asset,
                frame_number=frame_number,
            )
            if frame.task.status != Task.Status.PENDING or frame.state not in (
                VideoFrame.State.WAITING_INTERPOLATION,
                VideoFrame.State.GENERATED_REJECTED,
            ):
                continue
            payload = {
                "annotations": annotations,
                "source": "generated_interpolation",
            }
            frame.generated_payload = payload
            frame.generated_from_frames = sorted(generated_from_by_target.get(frame_number, set()))
            frame.trajectory_warnings = sorted(warnings_by_target.get(frame_number, set()))
            frame.state = VideoFrame.State.GENERATED_REVIEW
            frame.task.consensus_payload = payload
            frame.task.validation_score = 100.0
            frame.task.status = Task.Status.IN_REVIEW
            frame.task.save(update_fields=["status", "validation_score", "consensus_payload", "updated_at"])
            frame.save(
                update_fields=[
                    "generated_payload",
                    "generated_from_frames",
                    "trajectory_warnings",
                    "state",
                    "updated_at",
                ]
            )
        locked_asset.interpolation_job_id = ""
        locked_asset.save(update_fields=["interpolation_job_id", "updated_at"])
