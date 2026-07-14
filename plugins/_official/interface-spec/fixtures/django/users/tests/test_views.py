# Tests must be excluded by the scanner.
from rest_framework.decorators import api_view


@api_view(["GET"])
def should_not_appear(request):
    return None
