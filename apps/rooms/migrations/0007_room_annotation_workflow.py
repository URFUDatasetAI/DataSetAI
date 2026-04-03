from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("rooms", "0006_roommembership_role"),
    ]

    operations = [
        migrations.AddField(
            model_name="room",
            name="annotation_workflow",
            field=models.CharField(
                choices=[("standard", "Standard"), ("text_detect_text", "Object detect + text")],
                default="standard",
                max_length=32,
            ),
        ),
    ]
