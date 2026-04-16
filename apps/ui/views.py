from django.conf import settings
from django.contrib.auth import login
from django.contrib.auth.views import LogoutView
from django.contrib.messages import get_messages
from django.db import DatabaseError
from django.db.utils import OperationalError, ProgrammingError
from django.http import Http404
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from django.shortcuts import redirect
from django.templatetags.static import static
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.generic import TemplateView
from django.views.generic.edit import FormView
from django.contrib.auth.mixins import LoginRequiredMixin
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.labeling.models import Task
from apps.rooms.models import Room
from apps.ui.forms import LoginForm, RegistrationForm
from apps.users.models import User


class UiContextMixin:
    """
    Builds the shared Django context and the bootstrap payload consumed by React.

    Django still owns URL routing, access checks and form handling, while the
    frontend renders a single React root and chooses the concrete page by
    `page_key`.
    """

    template_name = "ui/base.html"
    active_page = "home"
    page_key = "home"
    page_title = "DataSetAI"

    def _serialize_form_state(self, form):
        """Convert bound Django forms into JSON-safe state for React screens."""
        if form is None:
            return None

        fields = {}
        for name in form.fields:
            bound_field = form[name]
            value = bound_field.value()
            if name in {"password", "password_repeat"}:
                value = ""
            fields[name] = {
                "name": name,
                "label": bound_field.label,
                "value": "" if value in (None, False) else str(value),
                "errors": [str(error) for error in bound_field.errors],
                "widget_type": bound_field.field.widget.input_type or "text",
            }

        return {
            "fields": fields,
            "non_field_errors": [str(error) for error in form.non_field_errors()],
        }

    def get_page_payload(self, context):
        """Return the page-specific fragment that should be exposed to React."""
        payload = {}
        form = context.get("form")
        if form is not None:
            payload["form"] = self._serialize_form_state(form)
        invite_token = context.get("invite_token")
        if invite_token is not None:
            payload["invite_token"] = str(invite_token)
        return payload

    def get_ui_bootstrap(self, context):
        """
        Build a stable bootstrap contract for the client.

        Keeping this logic in one place helps React pages stay decoupled from
        Django templates and prevents per-page ad hoc script tags.
        """
        messages = []
        for message in get_messages(self.request):
            if message.level_tag == "error":
                toast_type = "error"
            elif message.level_tag == "warning":
                toast_type = "warning"
            elif message.level_tag == "success":
                toast_type = "success"
            else:
                toast_type = "info"

            messages.append(
                {
                    "message": str(message),
                    "type": toast_type,
                    "persistent": "persistent" in message.tags or "sticky" in message.tags,
                }
            )

        return {
            "page": self.page_key,
            "page_title": self.page_title,
            "active_page": self.active_page,
            "room_id": context.get("room_id"),
            "profile_user_id": context.get("profile_user_id"),
            "app_debug_mode": settings.APP_DEBUG_MODE,
            "stats": context.get("stats"),
            "auth_user": context.get("auth_user_data"),
            "csrf_token": get_token(self.request),
            "messages": messages,
            "assets": {
                "brand_mark": static("ui/datasetai-mark.png"),
            },
            "page_payload": self.get_page_payload(context),
        }

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        stats = {
            "users": 0,
            "rooms": 0,
            "tasks": 0,
        }

        try:
            # Stats are best-effort only: UI should still render on a fresh DB
            # state when tables are not ready yet.
            stats = {
                "users": User.objects.count(),
                "rooms": Room.objects.count(),
                "tasks": Task.objects.count(),
            }
        except (OperationalError, ProgrammingError, DatabaseError):
            pass

        context["stats"] = stats
        context["active_page"] = self.active_page
        context["page_key"] = self.page_key
        context["room_id"] = kwargs.get("room_id")
        context["profile_user_id"] = kwargs.get("user_id")
        context["invite_token"] = kwargs.get("invite_token")
        context["app_debug_mode"] = settings.APP_DEBUG_MODE
        context["page_title"] = self.page_title
        context["auth_user_data"] = (
            {
                "id": self.request.user.id,
                "email": self.request.user.email,
                "full_name": self.request.user.full_name,
                "display_name": self.request.user.display_name,
            }
            if self.request.user.is_authenticated
            else None
        )
        context["ui_bootstrap"] = self.get_ui_bootstrap(context)
        return context


class LandingView(UiContextMixin, TemplateView):
    active_page = "home"
    page_key = "home"
    page_title = "DataSetAI | Главная"


class RoomsView(LoginRequiredMixin, UiContextMixin, TemplateView):
    active_page = "rooms"
    page_key = "rooms"
    page_title = "DataSetAI | Комнаты"


class ProfileView(LoginRequiredMixin, UiContextMixin, TemplateView):
    active_page = "profile"
    page_key = "profile"
    page_title = "DataSetAI | Профиль"


class RoomCreateView(LoginRequiredMixin, UiContextMixin, TemplateView):
    active_page = "rooms"
    page_key = "room-create"
    page_title = "DataSetAI | Создание комнаты"


class RoomEditView(LoginRequiredMixin, UiContextMixin, TemplateView):
    active_page = "rooms"
    page_key = "room-edit"
    page_title = "DataSetAI | Редактирование комнаты"

    def dispatch(self, request, *args, **kwargs):
        room_id = kwargs.get("room_id")
        if room_id is None:
            raise Http404("Room not found.")
        get_object_or_404(Room.objects.only("id"), id=room_id, created_by=request.user)
        return super().dispatch(request, *args, **kwargs)


class RoomWorkspaceView(LoginRequiredMixin, UiContextMixin, TemplateView):
    active_page = "rooms"
    page_key = "room-detail"
    page_title = "DataSetAI | Комната"


class RoomWorkView(LoginRequiredMixin, UiContextMixin, TemplateView):
    active_page = "rooms"
    page_key = "room-work"
    page_title = "DataSetAI | Работа в комнате"


class RoomInviteLandingView(UiContextMixin, TemplateView):
    active_page = "home"
    page_key = "room-invite"
    page_title = "DataSetAI | Invite в комнату"


class AuthContextMixin(UiContextMixin):
    active_page = "auth"


class LoginPageView(AuthContextMixin, FormView):
    form_class = LoginForm
    success_url = "/rooms/"
    page_key = "auth-login"
    page_title = "DataSetAI | Вход"

    def dispatch(self, request, *args, **kwargs):
        if request.user.is_authenticated:
            return redirect(self.get_success_url())
        return super().dispatch(request, *args, **kwargs)

    def get_form_kwargs(self):
        kwargs = super().get_form_kwargs()
        kwargs["request"] = self.request
        return kwargs

    def get_success_url(self):
        next_url = self.request.GET.get("next") or self.request.POST.get("next")
        if next_url and url_has_allowed_host_and_scheme(
            url=next_url,
            allowed_hosts={self.request.get_host()},
            require_https=self.request.is_secure(),
        ):
            return next_url
        return super().get_success_url()

    def form_valid(self, form):
        login(self.request, form.get_user())
        return super().form_valid(form)


class RegisterPageView(AuthContextMixin, FormView):
    form_class = RegistrationForm
    success_url = "/rooms/"
    page_key = "auth-register"
    page_title = "DataSetAI | Регистрация"

    def dispatch(self, request, *args, **kwargs):
        if request.user.is_authenticated:
            return redirect(self.get_success_url())
        return super().dispatch(request, *args, **kwargs)

    def get_success_url(self):
        next_url = self.request.GET.get("next") or self.request.POST.get("next")
        if next_url and url_has_allowed_host_and_scheme(
            url=next_url,
            allowed_hosts={self.request.get_host()},
            require_https=self.request.is_secure(),
        ):
            return next_url
        return super().get_success_url()

    def form_valid(self, form):
        user = form.save()
        login(self.request, user)
        return super().form_valid(form)


class UserLogoutView(LogoutView):
    next_page = "/"


class ServiceInfoView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        return Response(
            {
                "service": "DataSetAI Backend MVP",
                "status": "ok",
                "docs_hint": {
                    "ui": "/",
                    "admin": "/admin/",
                    "api_v1": "/api/v1/",
                    "health": "/health/",
                },
            }
        )


class HealthView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        return Response({"status": "ok"})
