from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
from django.utils import timezone


def populate_room_pin_sort_order(apps, schema_editor):
    RoomPin = apps.get_model("rooms", "RoomPin")

    pins_by_user = {}
    for pin in RoomPin.objects.order_by("user_id", "-created_at", "-id"):
        pins_by_user.setdefault(pin.user_id, []).append(pin)

    for user_pins in pins_by_user.values():
        ordered_pins = list(reversed(user_pins))
        for index, pin in enumerate(ordered_pins, start=1):
            RoomPin.objects.filter(id=pin.id).update(sort_order=index)


class Migration(migrations.Migration):

    dependencies = [
        ("rooms", "0009_room_invite_token_roomjoinrequest"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterModelOptions(
            name="roompin",
            options={"ordering": ("sort_order", "id")},
        ),
        migrations.AddField(
            model_name="roompin",
            name="sort_order",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.CreateModel(
            name="RoomVisit",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("last_accessed_at", models.DateTimeField(default=timezone.now)),
                ("room", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="visits", to="rooms.room")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="room_visits", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "ordering": ("-last_accessed_at", "-id"),
            },
        ),
        migrations.RunPython(populate_room_pin_sort_order, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="roomvisit",
            constraint=models.UniqueConstraint(fields=("room", "user"), name="unique_room_visit"),
        ),
    ]
