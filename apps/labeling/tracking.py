import math
from collections import defaultdict
from typing import Any


GENERATED_TRACKING_SOURCE = "generated_tracking"
TRACKING_METHOD_KEYFRAME_LINEAR = "keyframe_linear_interpolation"
LOW_TRACKING_CONFIDENCE_THRESHOLD = 0.55


def _points(annotation: dict) -> list[float]:
    values = annotation.get("points") or []
    if len(values) != 4:
        return [0.0, 0.0, 0.0, 0.0]
    x_min, y_min, x_max, y_max = [float(value) for value in values]
    return [min(x_min, x_max), min(y_min, y_max), max(x_min, x_max), max(y_min, y_max)]


def _center(points: list[float]) -> tuple[float, float]:
    return ((points[0] + points[2]) / 2, (points[1] + points[3]) / 2)


def _size(points: list[float]) -> tuple[float, float]:
    return (max(points[2] - points[0], 1.0), max(points[3] - points[1], 1.0))


def _area(points: list[float]) -> float:
    width, height = _size(points)
    return width * height


def _iou(left: list[float], right: list[float]) -> float:
    x_min = max(left[0], right[0])
    y_min = max(left[1], right[1])
    x_max = min(left[2], right[2])
    y_max = min(left[3], right[3])
    intersection_width = max(x_max - x_min, 0.0)
    intersection_height = max(y_max - y_min, 0.0)
    intersection = intersection_width * intersection_height
    if intersection <= 0:
        return 0.0
    return intersection / max(_area(left) + _area(right) - intersection, 1.0)


def _interpolate_points(left: list[float], right: list[float], ratio: float) -> list[float]:
    return [round(left[index] + (right[index] - left[index]) * ratio, 2) for index in range(4)]


def _payload_annotations_by_track(payload: dict | None) -> dict[str, list[dict]]:
    annotations_by_track: dict[str, list[dict]] = defaultdict(list)
    if not payload:
        return {}
    for item in payload.get("annotations", []):
        track_id = str(item.get("track_id") or "").strip()
        if not track_id:
            continue
        annotations_by_track[track_id].append(item)
    return dict(annotations_by_track)


def _segment_tracking_confidence(*, left: dict, right: dict, frame_span: int) -> float:
    left_points = _points(left)
    right_points = _points(right)
    left_width, left_height = _size(left_points)
    right_width, right_height = _size(right_points)
    left_center = _center(left_points)
    right_center = _center(right_points)
    average_size = max((left_width + left_height + right_width + right_height) / 4, 1.0)
    normalized_motion = math.dist(left_center, right_center) / max(average_size * max(frame_span, 1), 1.0)
    width_ratio = max(left_width, right_width) / max(min(left_width, right_width), 1.0)
    height_ratio = max(left_height, right_height) / max(min(left_height, right_height), 1.0)
    scale_penalty = min(0.25, (abs(math.log(width_ratio)) + abs(math.log(height_ratio))) * 0.12)
    motion_penalty = min(0.35, normalized_motion * 0.22)
    gap_penalty = min(0.25, max(frame_span - 12, 0) * 0.012)
    return round(max(0.05, min(0.99, 1.0 - motion_penalty - scale_penalty - gap_penalty)), 2)


def _segment_warnings(*, left: dict, right: dict, frame_span: int, confidence: float) -> set[str]:
    warnings: set[str] = set()
    if frame_span <= 0:
        return warnings

    left_points = _points(left)
    right_points = _points(right)
    left_width, left_height = _size(left_points)
    right_width, right_height = _size(right_points)
    center_shift_per_frame = math.dist(_center(left_points), _center(right_points)) / frame_span
    reference_size = max((left_width + left_height + right_width + right_height) / 4, 1.0)

    if frame_span > 30:
        warnings.add("long_keyframe_gap")
    if center_shift_per_frame > reference_size * 1.5:
        warnings.add("abrupt_center_jump")
    if max(left_width, right_width) / max(min(left_width, right_width), 1.0) > 2.5:
        warnings.add("abrupt_width_change")
    if max(left_height, right_height) / max(min(left_height, right_height), 1.0) > 2.5:
        warnings.add("abrupt_height_change")
    if max(_area(left_points), _area(right_points)) / max(min(_area(left_points), _area(right_points)), 1.0) > 4:
        warnings.add("abrupt_area_change")
    if confidence < LOW_TRACKING_CONFIDENCE_THRESHOLD:
        warnings.add("low_tracking_confidence")
    return warnings


def _append_warning(annotation: dict, warning: str) -> None:
    annotation.setdefault("tracking_warnings", [])
    annotation.setdefault("tracking", {}).setdefault("warnings", [])
    if warning not in annotation["tracking_warnings"]:
        annotation["tracking_warnings"].append(warning)
    if warning not in annotation["tracking"]["warnings"]:
        annotation["tracking"]["warnings"].append(warning)


def _apply_frame_level_warnings(annotations: list[dict]) -> set[str]:
    warnings: set[str] = set()
    seen_tracks: set[str] = set()
    for annotation in annotations:
        track_id = str(annotation.get("track_id") or "").strip()
        if track_id in seen_tracks:
            _append_warning(annotation, "duplicate_track_on_frame")
            warnings.add("duplicate_track_on_frame")
        seen_tracks.add(track_id)

    for left_index, left_annotation in enumerate(annotations):
        left_points = _points(left_annotation)
        for right_annotation in annotations[left_index + 1 :]:
            if left_annotation.get("track_id") == right_annotation.get("track_id"):
                continue
            right_points = _points(right_annotation)
            overlap = _iou(left_points, right_points)
            left_width, left_height = _size(left_points)
            right_width, right_height = _size(right_points)
            near_distance = min(
                math.hypot(left_width, left_height),
                math.hypot(right_width, right_height),
            ) * 0.25
            center_distance = math.dist(_center(left_points), _center(right_points))
            if overlap > 0.6:
                for item in (left_annotation, right_annotation):
                    _append_warning(item, "overlapping_tracks")
                warnings.add("overlapping_tracks")
            elif center_distance < near_distance:
                for item in (left_annotation, right_annotation):
                    _append_warning(item, "nearby_tracks")
                warnings.add("nearby_tracks")
    return warnings


def build_tracking_proposals(*, accepted_frames: list[Any], target_frames_by_number: dict[int, Any]) -> dict[int, dict]:
    keyframes_by_track: dict[str, list[tuple[Any, dict]]] = defaultdict(list)
    for frame in accepted_frames:
        for track_id, annotations in _payload_annotations_by_track(frame.task.consensus_payload).items():
            for annotation in annotations:
                keyframes_by_track[track_id].append((frame, annotation))

    proposals: dict[int, dict] = {}
    for track_id, keyed_items in keyframes_by_track.items():
        keyed_items.sort(key=lambda item: item[0].frame_number)
        for (left_frame, left_annotation), (right_frame, right_annotation) in zip(keyed_items, keyed_items[1:]):
            if left_annotation.get("label_id") != right_annotation.get("label_id"):
                continue
            frame_span = int(right_frame.frame_number) - int(left_frame.frame_number)
            if frame_span <= 1:
                continue
            confidence = _segment_tracking_confidence(
                left=left_annotation,
                right=right_annotation,
                frame_span=frame_span,
            )
            segment_warnings = _segment_warnings(
                left=left_annotation,
                right=right_annotation,
                frame_span=frame_span,
                confidence=confidence,
            )
            for frame_number in sorted(target_frames_by_number):
                if frame_number <= left_frame.frame_number or frame_number >= right_frame.frame_number:
                    continue
                ratio = (frame_number - left_frame.frame_number) / frame_span
                source_frames = [left_frame.frame_number, right_frame.frame_number]
                tracking = {
                    "method": TRACKING_METHOD_KEYFRAME_LINEAR,
                    "source": GENERATED_TRACKING_SOURCE,
                    "confidence": confidence,
                    "warnings": sorted(segment_warnings),
                    "from_frames": source_frames,
                }
                annotation = {
                    "type": "bbox",
                    "label_id": left_annotation["label_id"],
                    "points": _interpolate_points(_points(left_annotation), _points(right_annotation), ratio),
                    "frame": 0,
                    "attributes": left_annotation.get("attributes", []),
                    "occluded": bool(left_annotation.get("occluded") or right_annotation.get("occluded")),
                    "track_id": track_id,
                    "source": GENERATED_TRACKING_SOURCE,
                    "tracking_confidence": confidence,
                    "tracking_warnings": sorted(segment_warnings),
                    "generated_from_frames": source_frames,
                    "tracking": tracking,
                }
                proposal = proposals.setdefault(
                    frame_number,
                    {
                        "annotations": [],
                        "generated_from_frames": set(),
                        "trajectory_warnings": set(),
                        "tracking_confidence": 1.0,
                    },
                )
                proposal["annotations"].append(annotation)
                proposal["generated_from_frames"].update(source_frames)
                proposal["trajectory_warnings"].update(segment_warnings)
                proposal["tracking_confidence"] = min(proposal["tracking_confidence"], confidence)

    for proposal in proposals.values():
        frame_warnings = _apply_frame_level_warnings(proposal["annotations"])
        proposal["trajectory_warnings"].update(frame_warnings)
        for annotation in proposal["annotations"]:
            annotation["tracking_warnings"] = sorted(annotation.get("tracking_warnings", []))
            annotation["tracking"]["warnings"] = sorted(annotation["tracking"].get("warnings", []))
        proposal["generated_from_frames"] = sorted(proposal["generated_from_frames"])
        proposal["trajectory_warnings"] = sorted(proposal["trajectory_warnings"])
        proposal["tracking_confidence"] = round(proposal["tracking_confidence"], 2)

    return proposals


def get_payload_tracking_confidence(payload: dict | None) -> float | None:
    if not payload:
        return None
    tracking = payload.get("tracking")
    if isinstance(tracking, dict) and tracking.get("confidence") is not None:
        return float(tracking["confidence"])
    confidences = [
        float(item["tracking_confidence"])
        for item in payload.get("annotations", [])
        if item.get("tracking_confidence") is not None
    ]
    return round(min(confidences), 2) if confidences else None
