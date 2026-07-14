from rest_framework import serializers

from .models import Order, OrderItem


class OrderItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderItem
        fields = ["id", "product_code", "quantity", "unit_price"]
        read_only_fields = ["id"]


class CustomerSummarySerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100)
    email = serializers.CharField(required=False)


class OrderSerializer(serializers.ModelSerializer):
    """ModelSerializer with two levels of nesting (items / customer)."""

    items = OrderItemSerializer(many=True)
    customer = CustomerSummarySerializer(required=False)

    class Meta:
        model = Order
        fields = ["id", "order_no", "status", "total_amount",
                  "ordered_at", "customer", "items"]
        read_only_fields = ["id", "ordered_at"]
