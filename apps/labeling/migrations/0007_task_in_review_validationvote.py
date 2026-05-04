from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("labeling", "0006_alter_taskassignment_status"),
    ]

    operations = [
        migrations.AlterField(
            model_name="task",
            name="status",
            field=models.CharField(
                choices=[
                    ("pending", "Pending"),
                    ("in_progress", "In progress"),
                    ("in_review", "In review"),
                    ("submitted", "Submitted"),
                ],
                default="pending",
                max_length=16,
            ),
        ),
        migrations.CreateModel(
            name="ValidationVote",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("round_number", models.PositiveIntegerField(default=1)),
                ("decision", models.CharField(choices=[("approve", "Approve"), ("reject", "Reject")], max_length=16)),
                ("comment", models.TextField(blank=True)),
                (
                    "task",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="validation_votes",
                        to="labeling.task",
                    ),
                ),
                (
                    "voter",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="validation_votes",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ("task_id", "round_number", "voter_id"),
                "indexes": [
                    models.Index(fields=["task", "round_number", "decision"], name="labeling_vv_task_ro_2df2a5_idx"),
                    models.Index(fields=["voter", "decision"], name="labeling_vv_voter_1d19f7_idx"),
                ],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("task", "round_number", "voter"),
                        name="unique_validation_vote_round_voter",
                    ),
                ],
            },
        ),
    ]
