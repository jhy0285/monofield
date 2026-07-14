# Migrations must be excluded by the scanner. If this path() leaks into the
# spec, the exclusion rule is broken.
from django.urls import path

urlpatterns = [
    path("should-not-appear/", lambda request: None),
]
