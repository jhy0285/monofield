from rest_framework import viewsets

from .models import Order
from .serializers import OrderSerializer


class OrderViewSet(viewsets.ModelViewSet):
    """Standard CRUD ViewSet: list/create/retrieve/update/destroy."""

    queryset = Order.objects.all()
    serializer_class = OrderSerializer
