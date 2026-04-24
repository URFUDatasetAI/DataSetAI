from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("rooms", "0011_room_owner_is_annotator"),
    ]

    operations = [
        migrations.CreateModel(
            name="RoomAssignmentQuota",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("task_quota", models.PositiveIntegerField()),
                (
                    "room",
                    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="assignment_quotas", to="rooms.room"),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="room_assignment_quotas",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ("room_id", "user_id"),
            },
        ),
        migrations.AddConstraint(
            model_name="roomassignmentquota",
            constraint=models.UniqueConstraint(fields=("room", "user"), name="unique_room_assignment_quota"),
        ),
    ]
