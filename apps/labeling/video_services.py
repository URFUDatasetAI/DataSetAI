import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from django.core.files.base import ContentFile
from django.db import IntegrityError, transaction

from apps.labeling.models import FrameAnnotation, FrameAnnotationTask, Task, VideoSelection
from apps.rooms.policies import can_annotate_room, can_edit_room, get_room_membership
from apps.users.models import User
from common.exceptions import AccessDeniedError, ConflictError, NotFoundError


def _assert_video_task(*, video: Task) -> None:
    if video.source_type != Task.SourceType.VIDEO:
        raise ConflictError("Операция доступна только для исходного видео.")


def get_video_frame_count(*, video: Task) -> int:
    value = video.input_payload.get("frame_count")
    if value is None:
        value = video.input_payload.get("frames")
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def get_video_fps(*, video: Task) -> float:
    value = video.input_payload.get("fps") or video.input_payload.get("frame_rate") or 25
    try:
        fps = float(value)
    except (TypeError, ValueError):
        fps = 25.0
    return fps if fps > 0 else 25.0


def frame_index_to_time_ms(*, video: Task, frame_index: int) -> int:
    return int(round((frame_index / get_video_fps(video=video)) * 1000))


def get_ffmpeg_path() -> str | None:
    ffmpeg_path = shutil.which("ffmpeg")
    if ffmpeg_path:
        return ffmpeg_path

    user_profile = Path.home()
    local_candidate = user_profile / "tools" / "ffmpeg" / "bin" / ("ffmpeg.exe" if Path.home().drive else "ffmpeg")
    if local_candidate.exists():
        return str(local_candidate)
    return None


def get_ffprobe_path() -> str | None:
    ffprobe_path = shutil.which("ffprobe")
    if ffprobe_path:
        return ffprobe_path

    user_profile = Path.home()
    local_candidate = user_profile / "tools" / "ffmpeg" / "bin" / ("ffprobe.exe" if Path.home().drive else "ffprobe")
    if local_candidate.exists():
        return str(local_candidate)
    return None


def _parse_frame_rate(value: str | None) -> float | None:
    if not value:
        return None
    if "/" in value:
        numerator, denominator = value.split("/", 1)
        try:
            numerator_value = float(numerator)
            denominator_value = float(denominator)
        except ValueError:
            return None
        if denominator_value <= 0:
            return None
        fps = numerator_value / denominator_value
    else:
        try:
            fps = float(value)
        except ValueError:
            return None
    return fps if fps > 0 else None


def probe_video_metadata(*, file_path: str | Path) -> dict:
    ffprobe_path = get_ffprobe_path()
    if not ffprobe_path:
        raise ConflictError("Для чтения реального FPS нужен FFprobe.")

    command = [
        ffprobe_path,
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-count_frames",
        "-show_entries",
        "stream=width,height,avg_frame_rate,r_frame_rate,nb_frames,nb_read_frames,duration:format=duration",
        "-of",
        "json",
        str(file_path),
    ]
    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as exc:
        error_message = exc.stderr.strip() or "Не удалось прочитать метаданные видео."
        raise ConflictError(error_message) from exc

    try:
        payload = json.loads(result.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise ConflictError("FFprobe вернул некорректные метаданные видео.") from exc

    streams = payload.get("streams") or []
    stream = streams[0] if streams else {}
    fps = _parse_frame_rate(stream.get("avg_frame_rate")) or _parse_frame_rate(stream.get("r_frame_rate")) or 25.0

    duration_value = stream.get("duration") or (payload.get("format") or {}).get("duration") or 0
    try:
        duration = max(0.0, float(duration_value or 0))
    except (TypeError, ValueError):
        duration = 0.0

    frame_count_value = stream.get("nb_read_frames") or stream.get("nb_frames")
    try:
        frame_count = int(frame_count_value or 0)
    except (TypeError, ValueError):
        frame_count = 0
    if frame_count <= 0 and duration > 0 and fps > 0:
        frame_count = int(round(duration * fps))

    return {
        "width": int(stream.get("width") or 0),
        "height": int(stream.get("height") or 0),
        "fps": fps,
        "frame_rate": fps,
        "duration": duration,
        "frame_count": max(0, frame_count),
        "metadata_source": "ffprobe",
    }


def refresh_video_metadata(*, video: Task, force: bool = False) -> Task:
    _assert_video_task(video=video)
    if not video.source_file:
        return video
    if not force and video.input_payload.get("metadata_source") == "ffprobe" and get_video_frame_count(video=video):
        return video

    metadata = probe_video_metadata(file_path=video.source_file.path)
    next_payload = dict(video.input_payload or {})
    changed = False
    for key, value in metadata.items():
        if next_payload.get(key) != value:
            next_payload[key] = value
            changed = True
    if changed:
        video.input_payload = next_payload
        video.save(update_fields=["input_payload", "updated_at"])
    return video


def expand_frame_range(*, start_frame: int, end_frame: int, frame_count: int) -> list[int]:
    start = int(start_frame)
    end = int(end_frame)
    if start > end:
        start, end = end, start
    if start < 0 or end < 0:
        raise ConflictError("Индекс кадра не может быть отрицательным.")
    if frame_count and end >= frame_count:
        raise ConflictError("Нельзя выбрать кадры за пределами видео.")
    return list(range(start, end + 1))


def validate_frame_bounds(*, video: Task, start_frame: int, end_frame: int) -> tuple[int, int]:
    frame_indexes = expand_frame_range(
        start_frame=start_frame,
        end_frame=end_frame,
        frame_count=get_video_frame_count(video=video),
    )
    return frame_indexes[0], frame_indexes[-1]


def validate_bbox_object(item: dict) -> dict:
    if not isinstance(item, dict):
        raise ConflictError("Объект аннотации должен быть JSON-объектом.")
    label = item.get("label") or item.get("label_name") or "object"
    bbox = item.get("bbox")
    if not isinstance(bbox, dict):
        raise ConflictError("У каждого объекта должен быть bbox.")

    normalized_bbox = {}
    for key in ("x", "y", "width", "height"):
        try:
            value = float(bbox[key])
        except (KeyError, TypeError, ValueError) as exc:
            raise ConflictError(f"Некорректное значение bbox.{key}.") from exc
        if value < 0 or value > 1:
            raise ConflictError("Координаты bbox должны быть в диапазоне 0..1.")
        normalized_bbox[key] = value

    if normalized_bbox["width"] <= 0 or normalized_bbox["height"] <= 0:
        raise ConflictError("Ширина и высота bbox должны быть больше 0.")
    if normalized_bbox["x"] + normalized_bbox["width"] > 1 or normalized_bbox["y"] + normalized_bbox["height"] > 1:
        raise ConflictError("Bbox не должен выходить за границы кадра.")

    return {
        "label": str(label),
        "bbox": normalized_bbox,
    }


def validate_frame_annotation_payload(*, status: str, objects: list | None) -> list[dict]:
    if status not in FrameAnnotation.Status.values:
        raise ConflictError("Неизвестный статус покадровой аннотации.")
    if objects is None:
        objects = []
    if not isinstance(objects, list):
        raise ConflictError("objects должен быть массивом.")
    if status == FrameAnnotation.Status.EMPTY and objects:
        raise ConflictError("empty-аннотация не может содержать objects.")
    if status == FrameAnnotation.Status.ANNOTATED:
        return [validate_bbox_object(item) for item in objects]
    if status == FrameAnnotation.Status.UNCERTAIN:
        return [validate_bbox_object(item) for item in objects]
    return []


def _assert_can_use_video_workspace(*, video: Task, actor: User) -> None:
    membership = get_room_membership(room=video.room, user=actor)
    can_annotate = can_annotate_room(room=video.room, user=actor, membership=membership)
    if not can_annotate and not can_edit_room(room=video.room, user=actor):
        raise AccessDeniedError("У тебя нет прав размечать это видео.")


def get_video_task_or_404(*, video_id: int) -> Task:
    try:
        video = Task.objects.select_related("room").get(id=video_id, source_type=Task.SourceType.VIDEO)
    except Task.DoesNotExist as exc:
        raise NotFoundError("Видео не найдено.") from exc
    return video


def get_video_for_workspace(*, video_id: int, actor: User) -> Task:
    video = get_video_task_or_404(video_id=video_id)
    _assert_can_use_video_workspace(video=video, actor=actor)
    return video


def serialize_video(*, video: Task, request=None) -> dict:
    if video.source_file:
        video = refresh_video_metadata(video=video)
    source_url = video.source_file.url if video.source_file else None
    if source_url and request is not None:
        source_url = request.build_absolute_uri(source_url)
    return {
        "id": video.id,
        "room_id": video.room_id,
        "source_name": video.source_name,
        "source_file_url": source_url,
        "fps": get_video_fps(video=video),
        "width": int(video.input_payload.get("width") or 0),
        "height": int(video.input_payload.get("height") or 0),
        "duration": float(video.input_payload.get("duration") or 0),
        "frame_count": get_video_frame_count(video=video),
        "input_payload": video.input_payload,
    }


def create_video_selection(*, video: Task, actor: User, start_frame: int, end_frame: int) -> VideoSelection:
    _assert_video_task(video=video)
    _assert_can_use_video_workspace(video=video, actor=actor)
    start_frame, end_frame = validate_frame_bounds(video=video, start_frame=start_frame, end_frame=end_frame)
    return VideoSelection.objects.create(
        video=video,
        start_frame=start_frame,
        end_frame=end_frame,
        created_by=actor,
    )


def update_video_selection(*, selection: VideoSelection, actor: User, start_frame: int, end_frame: int) -> VideoSelection:
    _assert_can_use_video_workspace(video=selection.video, actor=actor)
    start_frame, end_frame = validate_frame_bounds(video=selection.video, start_frame=start_frame, end_frame=end_frame)
    selection.start_frame = start_frame
    selection.end_frame = end_frame
    selection.save(update_fields=["start_frame", "end_frame", "updated_at"])
    return selection


def delete_video_selection(*, selection: VideoSelection, actor: User) -> None:
    _assert_can_use_video_workspace(video=selection.video, actor=actor)
    selection.delete()


def generate_frame_tasks_from_selections(*, video: Task, actor: User) -> dict:
    _assert_video_task(video=video)
    _assert_can_use_video_workspace(video=video, actor=actor)
    frame_count = get_video_frame_count(video=video)
    created_tasks = []
    skipped_count = 0
    with transaction.atomic():
        selections = list(VideoSelection.objects.select_for_update().filter(video=video).order_by("start_frame", "end_frame", "id"))
        for selection in selections:
            for frame_index in expand_frame_range(
                start_frame=selection.start_frame,
                end_frame=selection.end_frame,
                frame_count=frame_count,
            ):
                try:
                    task = FrameAnnotationTask.objects.create(
                        video=video,
                        frame_index=frame_index,
                        time_ms=frame_index_to_time_ms(video=video, frame_index=frame_index),
                        source_segment=selection,
                    )
                except IntegrityError:
                    skipped_count += 1
                    continue
                created_tasks.append(task)
            if selection.status != VideoSelection.Status.GENERATED:
                selection.status = VideoSelection.Status.GENERATED
                selection.save(update_fields=["status", "updated_at"])

    return {
        "created_count": len(created_tasks),
        "skipped_duplicates_count": skipped_count,
        "tasks": created_tasks,
    }


def list_frame_tasks(*, actor: User, video_id: int | None = None) -> list[FrameAnnotationTask]:
    queryset = FrameAnnotationTask.objects.select_related("video__room", "assigned_to", "annotation").order_by("video_id", "frame_index", "id")
    if video_id is not None:
        video = get_video_task_or_404(video_id=video_id)
        _assert_can_use_video_workspace(video=video, actor=actor)
        queryset = queryset.filter(video=video)
    else:
        queryset = queryset.filter(video__room__memberships__user=actor, video__room__memberships__status="joined").distinct()
    return list(queryset)


def get_frame_task_or_404(*, task_id: int, actor: User) -> FrameAnnotationTask:
    try:
        task = FrameAnnotationTask.objects.select_related("video__room", "annotation").get(id=task_id)
    except FrameAnnotationTask.DoesNotExist as exc:
        raise NotFoundError("Покадровая задача не найдена.") from exc
    _assert_can_use_video_workspace(video=task.video, actor=actor)
    return task


def save_frame_annotation(*, frame_task: FrameAnnotationTask, actor: User, status: str, objects: list | None) -> FrameAnnotation:
    _assert_can_use_video_workspace(video=frame_task.video, actor=actor)
    validated_objects = validate_frame_annotation_payload(status=status, objects=objects)
    with transaction.atomic():
        locked_task = FrameAnnotationTask.objects.select_for_update().select_related("video").get(id=frame_task.id)
        annotation, _ = FrameAnnotation.objects.update_or_create(
            task=locked_task,
            defaults={
                "video": locked_task.video,
                "frame_index": locked_task.frame_index,
                "status": status,
                "objects_payload": validated_objects,
                "created_by": actor,
            },
        )
        if status == FrameAnnotation.Status.UNCERTAIN:
            locked_task.status = FrameAnnotationTask.Status.UNCERTAIN
        else:
            locked_task.status = FrameAnnotationTask.Status.DONE
        locked_task.assigned_to = actor
        locked_task.save(update_fields=["status", "assigned_to", "updated_at"])
    return annotation


def ensure_frame_image(*, video: Task, frame_index: int) -> FrameAnnotationTask | None:
    frame_task = FrameAnnotationTask.objects.filter(video=video, frame_index=frame_index).first()
    if frame_task and frame_task.frame_image:
        return frame_task

    frame_count = get_video_frame_count(video=video)
    if frame_index < 0 or (frame_count and frame_index >= frame_count):
        raise ConflictError("Кадр находится вне диапазона видео.")
    if not video.source_file:
        if frame_task:
            return frame_task
        raise ConflictError("У видео нет исходного файла.")

    ffmpeg_path = get_ffmpeg_path()
    if not ffmpeg_path:
        raise ConflictError("Для извлечения кадров нужен FFmpeg.")

    with tempfile.TemporaryDirectory(prefix="datasetai_frame_") as temp_dir:
        output_path = Path(temp_dir) / f"frame_{frame_index:06d}.jpg"
        try:
            subprocess.run(
                [
                    ffmpeg_path,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-i",
                    video.source_file.path,
                    "-vf",
                    f"select=eq(n\\,{frame_index})",
                    "-vsync",
                    "0",
                    "-frames:v",
                    "1",
                    "-q:v",
                    "2",
                    str(output_path),
                ],
                check=True,
                capture_output=True,
            )
        except subprocess.CalledProcessError as exc:
            error_message = exc.stderr.decode("utf-8", errors="ignore").strip() or "Не удалось извлечь кадр."
            raise ConflictError(error_message) from exc

        if not output_path.exists():
            raise ConflictError("Не удалось извлечь кадр.")
        if frame_task is None:
            frame_task, _ = FrameAnnotationTask.objects.get_or_create(
                video=video,
                frame_index=frame_index,
                defaults={"time_ms": frame_index_to_time_ms(video=video, frame_index=frame_index)},
            )
        frame_task.frame_image.save(f"{Path(video.source_name or 'video').stem}_frame_{frame_index:06d}.jpg", ContentFile(output_path.read_bytes()), save=True)
        return frame_task


def build_frame_annotation_export(*, video: Task) -> dict:
    annotations = []
    tasks = (
        FrameAnnotationTask.objects.filter(video=video)
        .select_related("annotation")
        .order_by("frame_index", "id")
    )
    for task in tasks:
        annotation = getattr(task, "annotation", None)
        status = annotation.status if annotation else task.status
        if status == FrameAnnotationTask.Status.DONE:
            status = FrameAnnotation.Status.ANNOTATED
        if status not in FrameAnnotation.Status.values:
            status = FrameAnnotation.Status.UNCERTAIN if status == FrameAnnotationTask.Status.UNCERTAIN else FrameAnnotation.Status.EMPTY
        annotations.append(
            {
                "frame_index": task.frame_index,
                "time_ms": task.time_ms,
                "status": status,
                "objects": annotation.objects_payload if annotation else [],
            }
        )
    return {
        "video_id": str(video.id),
        "fps": get_video_fps(video=video),
        "annotations": annotations,
    }


def export_frame_annotations_json(*, video: Task, actor: User) -> bytes:
    if not can_edit_room(room=video.room, user=actor):
        raise AccessDeniedError("Экспорт покадровых аннотаций доступен владельцу или администратору комнаты.")
    return json.dumps(build_frame_annotation_export(video=video), ensure_ascii=False, indent=2).encode("utf-8")
