from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("rooms", "0010_roompin_sort_order_roomvisit"),
    ]

    operations = [
        migrations.AddField(
            model_name="room",
            name="owner_is_annotator",
            field=models.BooleanField(default=True),
        ),
    ]
