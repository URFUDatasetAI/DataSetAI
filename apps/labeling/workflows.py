from apps.labeling.models import Task
from apps.rooms.models import Room

REVISION_TARGET_ANNOTATOR_KEY = "revision_target_annotator_id"


def is_text_detection_workflow(*, room: Room) -> bool:
    return room.annotation_workflow == Room.AnnotationWorkflow.TEXT_DETECTION_TRANSCRIPTION


def get_room_primary_tasks_queryset(*, room: Room):
    return room.tasks.filter(parent_task__isnull=True)


def get_room_final_tasks_queryset(*, room: Room):
    if is_text_detection_workflow(room=room):
        return room.tasks.filter(workflow_stage=Task.WorkflowStage.TEXT_TRANSCRIPTION)
    return room.tasks.filter(parent_task__isnull=True)


def get_task_is_final_stage(*, task: Task) -> bool:
    if task.room.annotation_workflow != Room.AnnotationWorkflow.TEXT_DETECTION_TRANSCRIPTION:
        return True
    return task.workflow_stage == Task.WorkflowStage.TEXT_TRANSCRIPTION


def get_task_revision_target_annotator_id(*, task: Task) -> int | None:
    raw_value = (task.input_payload or {}).get(REVISION_TARGET_ANNOTATOR_KEY)
    try:
        return int(raw_value) if raw_value is not None else None
    except (TypeError, ValueError):
        return None


def build_task_input_payload_with_revision_target(*, task: Task, annotator_id: int | None) -> dict:
    payload = dict(task.input_payload or {})
    if annotator_id is None:
        payload.pop(REVISION_TARGET_ANNOTATOR_KEY, None)
    else:
        payload[REVISION_TARGET_ANNOTATOR_KEY] = int(annotator_id)
    return payload
