from django.contrib import admin
from django.urls import include, path
from apps.ui.views import HealthView, ServiceInfoView


urlpatterns = [
    path("health/", HealthView.as_view(), name="health"),
    path("service/", ServiceInfoView.as_view(), name="service-info"),
    path("admin/", admin.site.urls),
    path("api/v1/", include("apps.api.v1.urls")),
    path("", include("apps.ui.urls")),
]
