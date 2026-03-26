from django.conf import settings
from django.db import DatabaseError
from django.db.utils import OperationalError, ProgrammingError
from django.http import JsonResponse


class ApiExceptionMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        try:
            return self.get_response(request)
        except Exception as exc:
            if not request.path.startswith("/api/"):
                raise

            if isinstance(exc, (ProgrammingError, OperationalError, DatabaseError)):
                payload = {
                    "detail": "Ошибка базы данных API. Скорее всего, не применены миграции. Выполни: python manage.py migrate",
                    "code": "database_error",
                }
            else:
                payload = {
                    "detail": "Внутренняя ошибка API.",
                    "code": "internal_error",
                }

            if settings.DEBUG:
                payload["debug_type"] = exc.__class__.__name__

            return JsonResponse(payload, status=500)
