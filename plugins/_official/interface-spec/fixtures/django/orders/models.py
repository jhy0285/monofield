from django.db import models


class Customer(models.Model):
    name = models.CharField(max_length=100)
    email = models.EmailField()
    grade = models.CharField(max_length=10, blank=True)


class Order(models.Model):
    order_no = models.CharField(max_length=20)
    status = models.CharField(max_length=10, default="OPEN")
    total_amount = models.DecimalField(max_digits=12, decimal_places=2)
    ordered_at = models.DateTimeField(auto_now_add=True)
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE)
    # audit column: must be excluded from the spec
    created_at = models.DateTimeField(auto_now_add=True)


class OrderItem(models.Model):
    order = models.ForeignKey(Order, related_name="items", on_delete=models.CASCADE)
    product_code = models.CharField(max_length=30)
    quantity = models.PositiveIntegerField(default=1)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)
