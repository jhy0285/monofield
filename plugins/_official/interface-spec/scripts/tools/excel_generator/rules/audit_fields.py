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
AUDIT_PATTERN = re.compile(r"(?i).*(create|created|update|updated|modify|modified|reg).*")


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
    return _normalize(name) in _AUDIT_NORMALIZED or bool(AUDIT_PATTERN.match(name))
