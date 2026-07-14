from rest_framework import serializers


class RoleSerializer(serializers.Serializer):
    code = serializers.CharField()
    label = serializers.CharField(required=False)


class UserSerializer(serializers.Serializer):
    """Plain Serializer mixing required / optional / read-only fields."""

    id = serializers.IntegerField(read_only=True)
    username = serializers.CharField(max_length=30)
    email = serializers.EmailField(required=False)
    nickname = serializers.CharField(required=False, allow_null=True)
    is_active = serializers.BooleanField(default=True)
    joined_date = serializers.DateField(required=False)
    role = RoleSerializer(required=False)
    # audit column: must be excluded from the spec
    updated_at = serializers.DateTimeField(read_only=True)
