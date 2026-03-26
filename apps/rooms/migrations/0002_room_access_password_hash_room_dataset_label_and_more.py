import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("rooms", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="room",
            name="access_password_hash",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="room",
            name="dataset_label",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="room",
            name="deadline",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
