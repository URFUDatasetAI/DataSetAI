from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("rooms", "0007_room_annotation_workflow"),
        ("labeling", "0003_task_cross_validation_and_assignment"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="parent_task",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="child_tasks",
                to="labeling.task",
            ),
        ),
        migrations.AddField(
            model_name="task",
            name="workflow_stage",
            field=models.CharField(
                choices=[
                    ("standard", "Standard"),
                    ("text_detection", "Text detection"),
                    ("text_transcription", "Text transcription"),
                ],
                default="standard",
                max_length=32,
            ),
        ),
        migrations.AddIndex(
            model_name="task",
            index=models.Index(fields=["room", "workflow_stage", "status"], name="labeling_ta_room_id_5f2def_idx"),
        ),
    ]
