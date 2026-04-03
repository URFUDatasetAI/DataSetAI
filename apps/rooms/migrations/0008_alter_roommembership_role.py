from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("rooms", "0007_room_annotation_workflow"),
    ]

    operations = [
        migrations.AlterField(
            model_name="roommembership",
            name="role",
            field=models.CharField(
                choices=[
                    ("annotator", "Annotator"),
                    ("admin", "Admin"),
                    ("tester", "Inspector"),
                ],
                default="annotator",
                max_length=16,
            ),
        ),
    ]
