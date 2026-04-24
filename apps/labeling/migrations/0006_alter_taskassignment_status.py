from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("labeling", "0005_remove_annotation_unique_task_annotator_annotation_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="taskassignment",
            name="status",
            field=models.CharField(
                choices=[
                    ("in_progress", "In progress"),
                    ("submitted", "Submitted"),
                    ("skipped", "Skipped"),
                ],
                default="in_progress",
                max_length=16,
            ),
        ),
    ]
