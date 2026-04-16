from rest_framework import serializers

from apps.users.models import User


class MyProfileUpdateSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(max_length=255, allow_blank=False)
    email = serializers.EmailField()

    class Meta:
        model = User
        fields = (
            "full_name",
            "email",
        )

    def validate_email(self, value: str) -> str:
        normalized_email = value.strip().lower()
        user = self.instance
        existing = User.objects.filter(email=normalized_email)
        if user is not None:
            existing = existing.exclude(id=user.id)
        if existing.exists():
            raise serializers.ValidationError("Пользователь с таким email уже существует.")
        return normalized_email
