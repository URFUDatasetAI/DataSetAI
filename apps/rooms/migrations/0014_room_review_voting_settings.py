from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("rooms", "0013_room_default_assignment_quota"),
    ]

    operations = [
        migrations.AddField(
            model_name="room",
            name="review_voting_enabled",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="room",
            name="review_votes_required",
            field=models.PositiveSmallIntegerField(default=1),
        ),
        migrations.AddField(
            model_name="room",
            name="review_acceptance_threshold",
            field=models.PositiveSmallIntegerField(default=100),
        ),
        migrations.AlterField(
            model_name="roommembership",
            name="role",
            field=models.CharField(
                choices=[
                    ("annotator", "Annotator"),
                    ("admin", "Admin"),
                    ("tester", "Reviewer"),
                ],
                default="annotator",
                max_length=16,
            ),
        ),
    ]
