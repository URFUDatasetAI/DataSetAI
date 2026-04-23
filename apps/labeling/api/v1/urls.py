from django.urls import path

from apps.labeling.api.v1.views import (
    RoomNextTaskView,
    RoomReviewTaskListView,
    RoomSubmittedTaskListView,
    TaskRejectView,
    TaskReturnForRevisionView,
    TaskMySubmissionView,
    TaskReviewDetailView,
    TaskSubmitView,
)


urlpatterns = [
    path("rooms/<int:room_id>/tasks/next/", RoomNextTaskView.as_view(), name="room-next-task"),
    path("rooms/<int:room_id>/tasks/submitted/mine/", RoomSubmittedTaskListView.as_view(), name="room-submitted-mine"),
    path("rooms/<int:room_id>/review/tasks/", RoomReviewTaskListView.as_view(), name="room-review-tasks"),
    path("tasks/<int:task_id>/submit/", TaskSubmitView.as_view(), name="task-submit"),
    path("tasks/<int:task_id>/my-submission/", TaskMySubmissionView.as_view(), name="task-my-submission"),
    path("tasks/<int:task_id>/review/", TaskReviewDetailView.as_view(), name="task-review-detail"),
    path("tasks/<int:task_id>/reject/", TaskRejectView.as_view(), name="task-reject"),
    path("tasks/<int:task_id>/return-for-revision/", TaskReturnForRevisionView.as_view(), name="task-return-for-revision"),
]
