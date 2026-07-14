from rest_framework.decorators import api_view
from rest_framework.response import Response

from .serializers import RoleSerializer, UserSerializer


@api_view(["GET", "POST"])
def list_users(request):
    if request.method == "POST":
        serializer = UserSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(serializer.data, status=201)
    grade = request.query_params.get("grade")
    users = []  # queryset elided in fixture
    return Response(UserSerializer(users, many=True).data)


@api_view(["GET"])
def user_detail(request, pk):
    user = {"id": pk}
    return Response(UserSerializer(user).data)


@api_view(["GET"])
def user_roles(request, pk):
    return Response(RoleSerializer([], many=True).data)
