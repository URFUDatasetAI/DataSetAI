from django.contrib.auth.models import AbstractUser
from django.db import models

"""
Custom user model kept intentionally small for the MVP.

Designed to be easily extensible in the future without breaking foreign key 
constraints across the whole database (which often happens if transitioning from
Django's default User to a Custom User later).
"""


class User(AbstractUser):
    class Role(models.TextChoices):
        USER = "user", "User"
        CUSTOMER = "customer", "Customer"
        ANNOTATOR = "annotator", "Annotator"

    role = models.CharField(max_length=32, choices=Role.choices, default=Role.USER)

    def __str__(self) -> str:
        return self.username
