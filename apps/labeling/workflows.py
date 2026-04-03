from apps.labeling.models import Task
from apps.rooms.models import Room


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
