from django.shortcuts import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.users.api.v1.serializers import MyProfileUpdateSerializer
from apps.users.models import User
from apps.users.selectors import build_user_profile


class MyProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        payload = build_user_profile(user=request.user)
        payload["can_edit"] = True
        return Response(payload)

    def patch(self, request):
        serializer = MyProfileUpdateSerializer(instance=request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        payload = build_user_profile(user=request.user)
        payload["can_edit"] = True
        return Response(payload)


class UserProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, user_id: int):
        user = get_object_or_404(User, id=user_id)
        payload = build_user_profile(user=user)
        payload["can_edit"] = user.id == request.user.id
        return Response(payload)
