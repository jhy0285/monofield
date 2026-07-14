from __future__ import annotations

PAGE_FIELDS = {
    "page",
    "size",
    "sort",
    "order",
    "direction",
    "offset",
    "limit",
    "keyword",
    "searchType",
}


def is_page_object_field(name: str) -> bool:
    return name in PAGE_FIELDS
