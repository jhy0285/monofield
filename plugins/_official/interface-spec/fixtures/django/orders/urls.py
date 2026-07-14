"""Orders app urlconf: DRF router registration."""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import OrderViewSet

router = DefaultRouter()
router.register(r"orders", OrderViewSet, basename="order")

urlpatterns = [
    path("", include(router.urls)),
]
