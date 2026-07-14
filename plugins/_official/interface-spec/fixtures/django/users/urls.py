"""Users app urlconf: function views via path() and re_path()."""
from django.urls import path, re_path

from . import views

urlpatterns = [
    path("", views.list_users),
    path("<int:pk>/", views.user_detail),
    re_path(r"^(?P<pk>\d+)/roles/$", views.user_roles),
]
