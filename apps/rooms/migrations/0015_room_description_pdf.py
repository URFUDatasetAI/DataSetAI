import apps.rooms.models
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("rooms", "0014_room_review_voting_settings"),
    ]

    operations = [
        migrations.AddField(
            model_name="room",
            name="description_pdf",
            field=models.FileField(blank=True, upload_to=apps.rooms.models.room_description_pdf_upload_to),
        ),
    ]
