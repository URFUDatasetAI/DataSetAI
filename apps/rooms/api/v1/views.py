from django.db.models import Count, F, Q
from django.http import HttpResponse
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.rooms.api.v1.serializers import (
    RoomAssignmentQuotaSerializer,
    RoomDatasetDeleteSerializer,
    RoomDatasetTaskSerializer,
    RoomDatasetUploadSerializer,
    InviteAnnotatorSerializer,
    RoomCreateSerializer,
    RoomJoinRequestDecisionSerializer,
    RoomJoinRequestSerializer,
    RoomUpdateSerializer,
    RoomJoinSerializer,
    RoomDeleteSerializer,
    RoomMembershipSerializer,
    RoomMembershipRoleSerializer,
    RoomPinSerializer,
    RoomPinReorderSerializer,
    RoomSerializer,
)
from apps.rooms.selectors import (
    build_room_invite_preview,
    build_room_dashboard,
    get_room_assignment_quota_state,
    get_room_by_invite_token,
    get_room_for_owner,
    get_visible_room,
    list_member_rooms,
    list_owned_rooms,
)
from apps.rooms.services import (
    add_room_dataset_images,
    approve_room_join_request,
    create_room,
    delete_room_dataset_tasks,
    export_room_annotations,
    invite_user_to_room,
    join_room,
    regenerate_room_invite,
    record_room_visit,
    remove_room_membership,
    reorder_room_pin,
    reorder_room_pins,
    reject_room_join_request,
    set_room_membership_role,
    set_room_assignment_quota,
    set_room_pinned,
    submit_room_join_request,
    update_room,
)
from apps.labeling.workflows import get_room_primary_tasks_queryset
from apps.users.models import User

"""
Rooms API surface.

Important split:
- Invite links / join requests are the public access path.
- RoomJoinView is the explicit join endpoint for already visible rooms.
"""


ROOM_CREATE_LIST_FIELDS = {"annotator_ids", "dataset_files"}
ROOM_DATASET_UPLOAD_LIST_FIELDS = {"dataset_files"}


def _build_room_create_payload(request):
    # Multipart room creation sends repeated keys (annotator_ids, dataset_files).
    # Normalizing them here keeps serializers independent from request encoding.
    if hasattr(request.data, "lists"):
        data = {}
        for key, values in request.data.lists():
            if key in ROOM_CREATE_LIST_FIELDS:
                data[key] = values
            else:
                data[key] = values if len(values) > 1 else (values[0] if values else None)
    else:
        data = dict(request.data)

    dataset_files = request.FILES.getlist("dataset_files")
    data["dataset_files"] = dataset_files

    return data


def _build_room_dataset_upload_payload(request):
    if hasattr(request.data, "lists"):
        data = {}
        for key, values in request.data.lists():
            if key in ROOM_DATASET_UPLOAD_LIST_FIELDS:
                data[key] = values
            else:
                data[key] = values if len(values) > 1 else (values[0] if values else None)
    else:
        data = dict(request.data)

    data["dataset_files"] = request.FILES.getlist("dataset_files")
    return data


class RoomListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        rooms = list_owned_rooms(user=request.user)
        serializer = RoomSerializer(rooms, many=True, context={"request": request})
        return Response(serializer.data)

    def post(self, request):
        self.check_permissions(request)
        data = _build_room_create_payload(request)
        serializer = RoomCreateSerializer(data=data)
        serializer.is_valid(raise_exception=True)
        room = create_room(creator=request.user, **serializer.validated_data)
        return Response(
            RoomSerializer(room, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class RoomDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, room_id: int):
        room = get_visible_room(room_id=room_id, user=request.user)
        record_room_visit(room=room, user=request.user)
        serializer = RoomSerializer(room, context={"request": request})
        return Response(serializer.data)

    def patch(self, request, room_id: int):
        room = get_room_for_owner(room_id=room_id, owner=request.user)
        serializer = RoomUpdateSerializer(instance=room, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        room = update_room(room=room, owner=request.user, **serializer.validated_data)
        return Response(RoomSerializer(room, context={"request": request}).data)

    def delete(self, request, room_id: int):
        room = get_room_for_owner(room_id=room_id, owner=request.user)
        serializer = RoomDeleteSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        room.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class RoomDashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, room_id: int):
        room = get_visible_room(room_id=room_id, user=request.user)
        record_room_visit(room=room, user=request.user)
        return Response(build_room_dashboard(room=room, actor=request.user, request=request))


class RoomDatasetTaskListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, room_id: int):
        room = get_room_for_owner(room_id=room_id, owner=request.user)
        tasks = (
            get_room_primary_tasks_queryset(room=room)
            .annotate(
                assignments_count_value=Count(
                    "assignments",
                    filter=Q(assignments__round_number=F("current_round")),
                    distinct=True,
                ),
                submitted_annotations_count_value=Count(
                    "annotations",
                    filter=Q(
                        annotations__assignment__round_number=F("current_round"),
                        annotations__assignment__status="submitted",
                    ),
                    distinct=True,
                ),
            )
            .order_by("id")
        )
        serializer = RoomDatasetTaskSerializer(tasks, many=True, context={"request": request})
        return Response(serializer.data)


class RoomDatasetUploadView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, room_id: int):
        room = get_visible_room(room_id=room_id, user=request.user)
        serializer = RoomDatasetUploadSerializer(data=_build_room_dataset_upload_payload(request))
        serializer.is_valid(raise_exception=True)
        tasks = add_room_dataset_images(
            room=room,
            actor=request.user,
            dataset_files=serializer.validated_data["dataset_files"],
            media_manifest=serializer.validated_data.get("media_manifest") or [],
        )
        return Response(
            {
                "added_count": len(tasks),
                "tasks": RoomDatasetTaskSerializer(tasks, many=True, context={"request": request}).data,
            },
            status=status.HTTP_201_CREATED,
        )


class RoomDatasetDeleteView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, room_id: int):
        room = get_visible_room(room_id=room_id, user=request.user)
        serializer = RoomDatasetDeleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        deleted_count = delete_room_dataset_tasks(
            room=room,
            actor=request.user,
            task_ids=serializer.validated_data["task_ids"],
        )
        return Response({"deleted_count": deleted_count})


class RoomInviteLinkView(APIView):
    permission_classes = []

    def get(self, request, invite_token):
        room = get_room_by_invite_token(invite_token=invite_token)
        actor = request.user if getattr(request.user, "is_authenticated", False) else None
        return Response(build_room_invite_preview(room=room, actor=actor, request=request))


class RoomInviteView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, room_id: int):
        room = get_visible_room(room_id=room_id, user=request.user)
        serializer = InviteAnnotatorSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        membership = invite_user_to_room(
            room=room,
            inviter=request.user,
            invited_user_id=serializer.validated_data["annotator_id"],
        )
        return Response(
            RoomMembershipSerializer(membership).data,
            status=status.HTTP_201_CREATED,
        )


class RoomInviteRegenerateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, room_id: int):
        room = get_visible_room(room_id=room_id, user=request.user)
        room = regenerate_room_invite(room=room, actor=request.user)
        return Response(
            {
                "room_id": room.id,
                "invite_url": request.build_absolute_uri(f"/i/{room.invite_token}/"),
                "invite_token": str(room.invite_token),
            }
        )


class RoomJoinRequestCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, invite_token):
        room = get_room_by_invite_token(invite_token=invite_token)
        join_request = submit_room_join_request(room=room, applicant=request.user)
        return Response(RoomJoinRequestSerializer(join_request).data, status=status.HTTP_201_CREATED)


class RoomJoinRequestApproveView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, room_id: int, join_request_id: int):
        room = get_visible_room(room_id=room_id, user=request.user)
        serializer = RoomJoinRequestDecisionSerializer(data=request.data or {})
        serializer.is_valid(raise_exception=True)
        join_request = approve_room_join_request(
            room=room,
            approver=request.user,
            join_request_id=join_request_id,
        )
        return Response(RoomJoinRequestSerializer(join_request).data)


class RoomJoinRequestRejectView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, room_id: int, join_request_id: int):
        room = get_visible_room(room_id=room_id, user=request.user)
        serializer = RoomJoinRequestDecisionSerializer(data=request.data or {})
        serializer.is_valid(raise_exception=True)
        join_request = reject_room_join_request(
            room=room,
            approver=request.user,
            join_request_id=join_request_id,
        )
        return Response(RoomJoinRequestSerializer(join_request).data)


class RoomMembershipRoleView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, room_id: int, user_id: int):
        room = get_visible_room(room_id=room_id, user=request.user)
        serializer = RoomMembershipRoleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        membership = set_room_membership_role(
            room=room,
            owner=request.user,
            target_user_id=user_id,
            role=serializer.validated_data["role"],
        )
        return Response(RoomMembershipSerializer(membership).data)


class RoomAssignmentQuotaView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, room_id: int, user_id: int):
        room = get_visible_room(room_id=room_id, user=request.user)
        serializer = RoomAssignmentQuotaSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        quota = set_room_assignment_quota(
            room=room,
            actor=request.user,
            target_user_id=user_id,
            task_quota=serializer.validated_data["task_quota"],
        )
        target_user = quota.user if quota is not None else User.objects.get(id=user_id)
        return Response(
            {
                "room_id": room.id,
                "user_id": user_id,
                **get_room_assignment_quota_state(room=room, user=target_user),
            }
        )


class RoomMembershipDeleteView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, room_id: int, user_id: int):
        room = get_visible_room(room_id=room_id, user=request.user)
        remove_room_membership(
            room=room,
            owner=request.user,
            target_user_id=user_id,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class MyRoomListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        rooms = list_member_rooms(user=request.user)
        serializer = RoomSerializer(rooms, many=True, context={"request": request})
        return Response(serializer.data)


class RoomJoinView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, room_id: int):
        # Join flow is intentionally scoped to rooms the actor can already see
        # through ownership, membership, or an approved invite flow.
        room = get_visible_room(room_id=room_id, user=request.user)
        serializer = RoomJoinSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        membership = join_room(room=room, annotator=request.user, password=serializer.validated_data.get("password"))
        record_room_visit(room=room, user=request.user)
        return Response(RoomMembershipSerializer(membership).data)


class RoomPinView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, room_id: int):
        room = get_visible_room(room_id=room_id, user=request.user)
        serializer = RoomPinSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        is_pinned = set_room_pinned(
            room=room,
            user=request.user,
            is_pinned=serializer.validated_data["is_pinned"],
        )
        return Response(
            {
                "room_id": room.id,
                "is_pinned": is_pinned,
            }
        )


class RoomPinReorderView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, room_id: int):
        room = get_visible_room(room_id=room_id, user=request.user)
        serializer = RoomPinReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ordered_room_ids = serializer.validated_data.get("ordered_room_ids")
        if ordered_room_ids:
            reorder_room_pins(
                user=request.user,
                ordered_room_ids=ordered_room_ids,
            )
            pin = room.pins.get(user=request.user)
        else:
            pin = reorder_room_pin(
                room=room,
                user=request.user,
                direction=serializer.validated_data["direction"],
            )
        return Response(
            {
                "room_id": room.id,
                "sort_order": pin.sort_order,
            }
        )


class RoomExportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, room_id: int):
        room = get_room_for_owner(room_id=room_id, owner=request.user)
        export_format = request.query_params.get("export_format") or request.query_params.get(
            "format",
            "native_json",
        )
        artifact = export_room_annotations(
            room=room,
            export_format=export_format,
            base_url=request.build_absolute_uri("/").rstrip("/"),
        )
        response = HttpResponse(artifact.content, content_type=artifact.content_type)
        response["Content-Disposition"] = f'attachment; filename="{artifact.filename}"'
        return response
