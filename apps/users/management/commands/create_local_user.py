from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError


User = get_user_model()


class Command(BaseCommand):
    help = "Create or update a local user for manual testing."

    def add_arguments(self, parser):
        parser.add_argument("email")
        parser.add_argument("password")
        parser.add_argument("--full-name", default="")
        parser.add_argument("--staff", action="store_true")
        parser.add_argument("--superuser", action="store_true")

    def handle(self, *args, **options):
        email = options["email"].strip().lower()
        password = options["password"]
        full_name = options["full_name"].strip()

        if not email:
            raise CommandError("Email must not be empty.")

        user, created = User.objects.get_or_create(
            email=email,
            defaults={
                "full_name": full_name,
            },
        )

        if full_name:
            user.full_name = full_name

        user.is_staff = bool(options["staff"] or options["superuser"])
        user.is_superuser = bool(options["superuser"])
        user.set_password(password)
        user.save()

        action = "created" if created else "updated"
        self.stdout.write(self.style.SUCCESS(f"User {email!r} {action} successfully."))
