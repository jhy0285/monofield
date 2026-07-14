"""Project root urlconf: composes the two app urlconfs under /api/."""
from django.urls import include, path

urlpatterns = [
    path("api/", include("orders.urls")),
    path("api/users/", include("users.urls")),
]
