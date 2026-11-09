from __future__ import annotations

import re

AUDIT_EXACT = {
    "crtrId",
    "updatrId",
    "creatDttm",
    "updatDttm",
    "createdBy",
    "updatedBy",
    "createdAt",
    "updatedAt",
    "regId",
    "regDt",
    "modId",
    "modDt",
}
# An audit word counts only as a whole camelCase/snake_case word: `regDate`, `lastUpdatedBy` are audit columns,
# `registeredAt`, `region` or `registrationNo` are business fields that merely start with the same letters.
AUDIT_WORDS = {"create", "created", "update", "updated", "modify", "modified", "reg"}
_WORD_RE = re.compile(r"[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+")

# Opt-in: keep audit columns in the spec (`scan_spring.py --include-audit-fields`).
_include_audit_fields = False


def set_include_audit_fields(enabled: bool) -> None:
    global _include_audit_fields
    _include_audit_fields = bool(enabled)


def _normalize(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


_AUDIT_NORMALIZED = {_normalize(v) for v in AUDIT_EXACT}
_AUDIT_NORMALIZED.update(
    {
        # frequently observed legacy abbreviations
        "crtrid",
        "updatrid",
        "creatdttm",
        "updatdttm",
    }
)


def is_audit_field(name: str) -> bool:
    if _include_audit_fields:
        return False
    if _normalize(name) in _AUDIT_NORMALIZED:
        return True
    return any(word.lower() in AUDIT_WORDS for word in _WORD_RE.findall(name or ""))
