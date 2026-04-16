from django.http import HttpResponse
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.rooms.api.v1.serializers import (
    RoomAccessSerializer,
    InviteAnnotatorSerializer,
    RoomCreateSerializer,
    RoomJoinRequestDecisionSerializer,
    RoomJoinRequestSerializer,
    RoomUpdateSerializer,
    RoomJoinSerializer,
    RoomMembershipSerializer,
    RoomMembershipRoleSerializer,
    RoomPinSerializer,
    RoomSerializer,
)
from apps.rooms.selectors import (
    build_room_invite_preview,
    build_room_dashboard,
    get_room_by_id,
    get_room_by_invite_token,
    get_room_for_owner,
    get_visible_room,
    list_member_rooms,
    list_owned_rooms,
)
from apps.rooms.services import (
    approve_room_join_request,
    create_room,
    export_room_annotations,
    invite_user_to_room,
    join_room,
    regenerate_room_invite,
    reject_room_join_request,
    set_room_membership_role,
    set_room_pinned,
    submit_room_join_request,
    update_room,
)

"""
Rooms API surface.

Important split:
- RoomAccessView is the "enter room by id/password" flow used by the UI
- RoomJoinView is the explicit join endpoint for already visible rooms
"""


ROOM_CREATE_LIST_FIELDS = {"annotator_ids", "dataset_files"}


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
        serializer = RoomSerializer(room, context={"request": request})
        return Response(serializer.data)

    def patch(self, request, room_id: int):
        room = get_room_for_owner(room_id=room_id, owner=request.user)
        serializer = RoomUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        room = update_room(room=room, owner=request.user, **serializer.validated_data)
        return Response(RoomSerializer(room, context={"request": request}).data)

    def delete(self, request, room_id: int):
        room = get_room_for_owner(room_id=room_id, owner=request.user)
        room.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class RoomDashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, room_id: int):
        room = get_visible_room(room_id=room_id, user=request.user)
        return Response(build_room_dashboard(room=room, actor=request.user, request=request))


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
                "invite_url": request.build_absolute_uri(f"/invite/{room.invite_token}/"),
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


class MyRoomListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        rooms = list_member_rooms(user=request.user)
        serializer = RoomSerializer(rooms, many=True, context={"request": request})
        return Response(serializer.data)


class RoomAccessView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = RoomAccessSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        room = get_room_by_id(room_id=serializer.validated_data["room_id"])
        password = serializer.validated_data.get("password", "")

        if room.created_by_id != request.user.id:
            membership = room.memberships.filter(user=request.user).first()
            if membership is None:
                return Response(
                    {
                        "detail": "Доступ по ID комнаты доступен только участникам. Используйте invite-ссылку и дождитесь одобрения.",
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

            membership = join_room(room=room, annotator=request.user, password=password)
            return Response(
                {
                    "room": RoomSerializer(room, context={"request": request}).data,
                    "membership": RoomMembershipSerializer(membership).data,
                    "redirect_url": f"/rooms/{room.id}/",
                }
            )

        return Response(
            {
                "room": RoomSerializer(room, context={"request": request}).data,
                "redirect_url": f"/rooms/{room.id}/",
            }
        )


class RoomJoinView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, room_id: int):
        # Join flow is intentionally stricter than RoomAccessView: the room must
        # already be visible to the actor (owner or invited member).
        room = get_visible_room(room_id=room_id, user=request.user)
        serializer = RoomJoinSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        membership = join_room(room=room, annotator=request.user, password=serializer.validated_data.get("password"))
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
