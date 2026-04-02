from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("rooms", "0005_roompin"),
    ]

    operations = [
        migrations.AddField(
            model_name="roommembership",
            name="role",
            field=models.CharField(
                choices=[("annotator", "Annotator"), ("admin", "Admin"), ("tester", "Tester")],
                default="annotator",
                max_length=16,
            ),
        ),
    ]
