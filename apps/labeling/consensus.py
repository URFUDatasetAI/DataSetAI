import json
import math
from collections import Counter
from itertools import combinations


FRAME_MATCH_TOLERANCE = 2
INTERFRAME_APPROXIMATION_MAX_GAP = 3
MERGE_MATCH_THRESHOLD = 0.45


def evaluate_annotation_consensus(*, annotations, similarity_threshold: int) -> dict:
    if not annotations:
        return {
            "score": 0.0,
            "accepted": False,
            "consensus_payload": None,
        }

    payloads = [annotation.result_payload for annotation in annotations]
    score = _compute_similarity_score(payloads)
    accepted = score >= similarity_threshold

    if _is_media_payload(payloads[0]):
        consensus_payload = _build_media_consensus_payload(payloads) if accepted else None
    else:
        consensus_payload = _select_structured_consensus_payload(payloads) if accepted else None

    return {
        "score": score,
        "accepted": accepted,
        "consensus_payload": consensus_payload,
    }


def evaluate_annotation_against_consensus(*, annotation_payload, consensus_payload, similarity_threshold: int) -> dict:
    if not annotation_payload or not consensus_payload:
        return {
            "score": 0.0,
            "accepted": False,
        }

    if _is_media_payload(annotation_payload) and _is_media_payload(consensus_payload):
        score = round(_media_payload_similarity(annotation_payload, consensus_payload) * 100, 2)
        return {
            "score": score,
            "accepted": score >= similarity_threshold,
        }

    accepted = _serialize_payload(annotation_payload) == _serialize_payload(consensus_payload)
    return {
        "score": 100.0 if accepted else 0.0,
        "accepted": accepted,
    }


def _compute_similarity_score(payloads: list) -> float:
    if len(payloads) <= 1:
        return 100.0

    if _is_media_payload(payloads[0]):
        pair_scores = [_media_payload_similarity(left, right) for left, right in combinations(payloads, 2)]
        if not pair_scores:
            return 100.0
        return round((sum(pair_scores) / len(pair_scores)) * 100, 2)

    serialized_payloads = [_serialize_payload(payload) for payload in payloads]
    most_common_count = Counter(serialized_payloads).most_common(1)[0][1]
    return round((most_common_count / len(serialized_payloads)) * 100, 2)


def _build_media_consensus_payload(payloads: list[dict]) -> dict:
    return {
        "annotations": _merge_media_annotations(payloads),
    }


def _select_structured_consensus_payload(payloads: list):
    if not payloads:
        return None

    serialized_payloads = [_serialize_payload(payload) for payload in payloads]
    most_common_serialized = Counter(serialized_payloads).most_common(1)[0][0]
    return json.loads(most_common_serialized)


def _is_media_payload(payload) -> bool:
    return isinstance(payload, dict) and isinstance(payload.get("annotations"), list)


def _serialize_payload(payload) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)


def _merge_media_annotations(payloads: list[dict]) -> list[dict]:
    flattened_annotations = []
    for payload_index, payload in enumerate(payloads):
        for annotation in payload.get("annotations", []):
            normalized = _normalize_annotation(annotation)
            normalized["_payload_index"] = payload_index
            flattened_annotations.append(normalized)

    if not flattened_annotations:
        return []

    clusters: list[list[dict]] = []
    for annotation in sorted(flattened_annotations, key=_annotation_sort_key):
        best_cluster = None
        best_score = 0.0
        for cluster in clusters:
            reference_annotation = _build_cluster_annotation(cluster)
            score = _annotation_similarity(annotation, reference_annotation)
            if score > best_score:
                best_score = score
                best_cluster = cluster

        if best_cluster is not None and best_score >= MERGE_MATCH_THRESHOLD:
            best_cluster.append(annotation)
        else:
            clusters.append([annotation])

    minimum_support = 1 if len(payloads) == 1 else max(2, math.ceil(len(payloads) / 2))
    merged_annotations = []
    for cluster in clusters:
        payload_support = {item["_payload_index"] for item in cluster}
        if len(payload_support) < minimum_support:
            continue
        merged_annotations.append(_build_cluster_annotation(cluster))

    merged_annotations.sort(key=_annotation_sort_key)
    return _approximate_interframe_annotations(merged_annotations)


def _normalize_annotation(annotation: dict) -> dict:
    normalized = {
        "type": annotation.get("type") or "bbox",
        "label_id": int(annotation.get("label_id")),
        "points": [float(point) for point in annotation.get("points", [])[:4]],
        "frame": int(annotation.get("frame", 0)),
        "attributes": list(annotation.get("attributes") or []),
        "occluded": bool(annotation.get("occluded", False)),
    }
    if "text" in annotation:
        normalized["text"] = annotation.get("text") or ""
    return normalized


def _build_cluster_annotation(cluster_items: list[dict]) -> dict:
    points = [
        round(sum(item["points"][index] for item in cluster_items) / len(cluster_items), 3)
        for index in range(4)
    ]
    frame = round(sum(item.get("frame", 0) for item in cluster_items) / len(cluster_items))
    annotation = {
        "type": cluster_items[0].get("type", "bbox"),
        "label_id": cluster_items[0]["label_id"],
        "points": points,
        "frame": max(frame, 0),
        "attributes": _pick_most_common_json_value(item.get("attributes", []) for item in cluster_items),
        "occluded": sum(1 for item in cluster_items if item.get("occluded")) >= math.ceil(len(cluster_items) / 2),
    }

    if any("text" in item for item in cluster_items):
        text_candidates = [item.get("text") or "" for item in cluster_items]
        normalized_counter = Counter(_normalize_text(text) for text in text_candidates)
        chosen_normalized_text = normalized_counter.most_common(1)[0][0]
        chosen_source_text = next((text for text in text_candidates if _normalize_text(text) == chosen_normalized_text), "")
        annotation["text"] = chosen_source_text

    return annotation


def _pick_most_common_json_value(values) -> list:
    serialized_values = [json.dumps(value, ensure_ascii=False, sort_keys=True) for value in values]
    most_common = Counter(serialized_values).most_common(1)[0][0]
    return json.loads(most_common)


def _approximate_interframe_annotations(annotations: list[dict]) -> list[dict]:
    if not annotations:
        return []

    existing_keys = {
        (
            annotation["label_id"],
            int(annotation.get("frame", 0)),
            tuple(round(float(point), 3) for point in annotation.get("points", [])),
        )
        for annotation in annotations
    }
    approximated_annotations = list(annotations)

    grouped_annotations: dict[tuple[int, str], list[dict]] = {}
    for annotation in annotations:
        key = (annotation["label_id"], _normalize_text(annotation.get("text")))
        grouped_annotations.setdefault(key, []).append(annotation)

    for group_annotations in grouped_annotations.values():
        ordered_annotations = sorted(group_annotations, key=lambda item: (int(item.get("frame", 0)), item["points"]))
        for left_annotation, right_annotation in zip(ordered_annotations, ordered_annotations[1:]):
            left_frame = int(left_annotation.get("frame", 0))
            right_frame = int(right_annotation.get("frame", 0))
            frame_gap = right_frame - left_frame
            if frame_gap <= 1 or frame_gap > INTERFRAME_APPROXIMATION_MAX_GAP:
                continue
            if _bbox_geometry_similarity(left_annotation.get("points", []), right_annotation.get("points", [])) < MERGE_MATCH_THRESHOLD:
                continue
            if (
                "text" in left_annotation
                or "text" in right_annotation
            ) and _normalize_text(left_annotation.get("text")) != _normalize_text(right_annotation.get("text")):
                continue

            for missing_frame in range(left_frame + 1, right_frame):
                interpolation_ratio = (missing_frame - left_frame) / frame_gap
                interpolated_points = [
                    round(
                        left_annotation["points"][index]
                        + ((right_annotation["points"][index] - left_annotation["points"][index]) * interpolation_ratio),
                        3,
                    )
                    for index in range(4)
                ]
                interpolation_key = (
                    left_annotation["label_id"],
                    missing_frame,
                    tuple(interpolated_points),
                )
                if interpolation_key in existing_keys:
                    continue

                interpolated_annotation = {
                    "type": left_annotation.get("type", "bbox"),
                    "label_id": left_annotation["label_id"],
                    "points": interpolated_points,
                    "frame": missing_frame,
                    "attributes": _pick_most_common_json_value(
                        [left_annotation.get("attributes", []), right_annotation.get("attributes", [])]
                    ),
                    "occluded": left_annotation.get("occluded", False) or right_annotation.get("occluded", False),
                }
                if "text" in left_annotation or "text" in right_annotation:
                    interpolated_annotation["text"] = left_annotation.get("text") or right_annotation.get("text") or ""

                approximated_annotations.append(interpolated_annotation)
                existing_keys.add(interpolation_key)

    approximated_annotations.sort(key=_annotation_sort_key)
    return approximated_annotations


def _annotation_sort_key(annotation: dict) -> tuple:
    return (
        int(annotation.get("frame", 0)),
        int(annotation.get("label_id", 0)),
        tuple(round(float(point), 3) for point in annotation.get("points", [])),
    )


def _media_payload_similarity(left_payload: dict, right_payload: dict) -> float:
    left_annotations = [_normalize_annotation(annotation) for annotation in left_payload.get("annotations", [])]
    right_annotations = [_normalize_annotation(annotation) for annotation in right_payload.get("annotations", [])]

    if not left_annotations and not right_annotations:
        return 1.0
    if not left_annotations or not right_annotations:
        return 0.0

    used_indices: set[int] = set()
    matched_score_sum = 0.0

    for left_item in left_annotations:
        best_index = None
        best_score = 0.0
        for index, right_item in enumerate(right_annotations):
            if index in used_indices:
                continue

            score = _annotation_similarity(left_item, right_item)
            if score > best_score:
                best_score = score
                best_index = index

        if best_index is not None and best_score > 0:
            used_indices.add(best_index)
            matched_score_sum += best_score

    denominator = len(left_annotations) + len(right_annotations)
    if denominator == 0:
        return 1.0
    return (2 * matched_score_sum) / denominator


def _annotation_similarity(left_annotation: dict, right_annotation: dict) -> float:
    if left_annotation.get("label_id") != right_annotation.get("label_id"):
        return 0.0

    frame_distance = abs(int(left_annotation.get("frame", 0)) - int(right_annotation.get("frame", 0)))
    if frame_distance > FRAME_MATCH_TOLERANCE:
        return 0.0

    geometry_score = _bbox_geometry_similarity(left_annotation.get("points", []), right_annotation.get("points", []))
    if geometry_score <= 0:
        return 0.0

    frame_score = max(0.0, 1 - (frame_distance / (FRAME_MATCH_TOLERANCE + 1)))
    score = geometry_score * frame_score
    if "text" in left_annotation or "text" in right_annotation:
        score *= _normalized_text_similarity(left_annotation.get("text"), right_annotation.get("text"))
    return score


def _bbox_geometry_similarity(left_points, right_points) -> float:
    iou = _bbox_iou(left_points, right_points)
    center_score = _bbox_center_similarity(left_points, right_points)
    size_score = _bbox_size_similarity(left_points, right_points)
    return max(iou, round((center_score * 0.6) + (size_score * 0.4), 4))


def _normalized_text_similarity(left_text, right_text) -> float:
    return 1.0 if _normalize_text(left_text) == _normalize_text(right_text) else 0.0


def _normalize_text(value) -> str:
    return " ".join(str(value or "").strip().lower().split())


def _bbox_center_similarity(left_points, right_points) -> float:
    if len(left_points) != 4 or len(right_points) != 4:
        return 0.0

    left_width = max(float(left_points[2]) - float(left_points[0]), 0.0)
    left_height = max(float(left_points[3]) - float(left_points[1]), 0.0)
    right_width = max(float(right_points[2]) - float(right_points[0]), 0.0)
    right_height = max(float(right_points[3]) - float(right_points[1]), 0.0)

    left_center_x = float(left_points[0]) + (left_width / 2)
    left_center_y = float(left_points[1]) + (left_height / 2)
    right_center_x = float(right_points[0]) + (right_width / 2)
    right_center_y = float(right_points[1]) + (right_height / 2)

    average_diagonal = (
        (
            ((left_width ** 2) + (left_height ** 2)) ** 0.5
            + ((right_width ** 2) + (right_height ** 2)) ** 0.5
        )
        / 2
    ) or 1.0
    center_distance = (((left_center_x - right_center_x) ** 2) + ((left_center_y - right_center_y) ** 2)) ** 0.5
    return max(0.0, 1 - (center_distance / average_diagonal))


def _bbox_size_similarity(left_points, right_points) -> float:
    if len(left_points) != 4 or len(right_points) != 4:
        return 0.0

    left_width = max(float(left_points[2]) - float(left_points[0]), 0.0)
    left_height = max(float(left_points[3]) - float(left_points[1]), 0.0)
    right_width = max(float(right_points[2]) - float(right_points[0]), 0.0)
    right_height = max(float(right_points[3]) - float(right_points[1]), 0.0)

    if left_width <= 0 or left_height <= 0 or right_width <= 0 or right_height <= 0:
        return 0.0

    width_ratio = min(left_width, right_width) / max(left_width, right_width)
    height_ratio = min(left_height, right_height) / max(left_height, right_height)
    return width_ratio * height_ratio


def _bbox_iou(left_points, right_points) -> float:
    if len(left_points) != 4 or len(right_points) != 4:
        return 0.0

    left_x1, left_y1, left_x2, left_y2 = left_points
    right_x1, right_y1, right_x2, right_y2 = right_points

    intersection_x1 = max(left_x1, right_x1)
    intersection_y1 = max(left_y1, right_y1)
    intersection_x2 = min(left_x2, right_x2)
    intersection_y2 = min(left_y2, right_y2)

    intersection_width = max(intersection_x2 - intersection_x1, 0)
    intersection_height = max(intersection_y2 - intersection_y1, 0)
    intersection_area = intersection_width * intersection_height

    left_area = max(left_x2 - left_x1, 0) * max(left_y2 - left_y1, 0)
    right_area = max(right_x2 - right_x1, 0) * max(right_y2 - right_y1, 0)
    union_area = left_area + right_area - intersection_area
    if union_area <= 0:
        return 0.0

    return intersection_area / union_area
