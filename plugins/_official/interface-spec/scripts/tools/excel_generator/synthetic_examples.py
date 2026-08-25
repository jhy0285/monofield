"""Static request/response example synthesis for interface specifications.

The scanners never call an application endpoint.  They can optionally consume
the redacted table metadata/sample JSON that MonoField' desktop database
broker already returned after the user approved it.  The output is therefore
useful for documentation review, but is explicitly marked as static analysis
rather than a captured runtime response.
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any


_SENSITIVE_NAME = re.compile(
    r"(?:api[_-]?key|authorization|credential|passwd|password|secret|token)",
    re.IGNORECASE,
)
_COLLECTION_TYPE = re.compile(r"(?:list|set|array|collection|iterable|\[\])", re.IGNORECASE)


def load_sample_context(path: str | None, codebase_path: str | Path | None = None) -> dict[str, Any]:
    """Load only the safe shape emitted by the database-context form control."""
    discovered = not path
    if not path:
        roots = []
        if codebase_path:
            roots.append(Path(codebase_path))
        roots.append(Path.cwd())
        for root in roots:
            candidates = (
                root / ".open-docs" / "database-context" / "approved-db-context.json",
                root / "approved-db-context.json",
            )
            candidate = next((item for item in candidates if item.is_file()), None)
            if candidate is not None:
                path = str(candidate)
                break
        if not path:
            return {"tables": []}
    source = Path(path)
    if discovered:
        try:
            if time.time() - source.stat().st_mtime > 60 * 60:
                return {"tables": []}
        except OSError:
            return {"tables": []}
    try:
        raw = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"--sample-context {source}: expected valid JSON ({error})") from error
    if not isinstance(raw, dict) or not isinstance(raw.get("tables"), list):
        raise SystemExit(f"--sample-context {source}: expected an object with a tables array")

    tables: list[dict[str, Any]] = []
    for table in raw["tables"]:
        if not isinstance(table, dict):
            continue
        rows = table.get("sampleRows")
        if not isinstance(rows, list):
            rows = []
        safe_rows = [row for row in rows if isinstance(row, dict)]
        tables.append({"sampleRows": safe_rows})
    return {"tables": tables}


def _normalise_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def _sample_values(context: dict[str, Any]) -> tuple[dict[str, Any], list[Any]]:
    values: dict[str, Any] = {}
    fallback_values: list[Any] = []
    for table in context.get("tables", []):
        for row in table.get("sampleRows", []):
            for key, value in row.items():
                normalized = _normalise_name(str(key))
                if (
                    not normalized
                    or normalized in values
                    or _SENSITIVE_NAME.search(str(key))
                    or value == "[redacted]"
                    or isinstance(value, (dict, list))
                ):
                    continue
                values[normalized] = value
                fallback_values.append(value)
    return values, fallback_values


def _fallback_value(data_type: str) -> Any:
    value_type = data_type.lower()
    if any(token in value_type for token in ("int", "integer", "long", "short", "byte")):
        return 0
    if any(token in value_type for token in ("double", "float", "decimal", "number")):
        return 0
    if "bool" in value_type:
        return True
    if "datetime" in value_type or ("date" in value_type and "time" in value_type):
        return "2026-01-01T00:00:00"
    if "date" in value_type:
        return "2026-01-01"
    if "time" in value_type:
        return "00:00:00"
    return "sample"


def _value_for_field(field: dict[str, Any], values: dict[str, Any], fallback_values: list[Any]) -> Any:
    name = str(field.get("nameEn", ""))
    if _SENSITIVE_NAME.search(name):
        return _fallback_value(str(field.get("dataType", "String")))
    sample = values.get(_normalise_name(name))
    if sample is None:
        data_type = str(field.get("dataType", "String")).lower()
        if any(token in data_type for token in ("int", "integer", "long", "short", "byte", "double", "float", "decimal", "number")):
            sample = next((value for value in fallback_values if isinstance(value, (int, float)) and not isinstance(value, bool)), None)
        elif "bool" in data_type:
            sample = next((value for value in fallback_values if isinstance(value, bool)), None)
        else:
            sample = next((value for value in fallback_values if isinstance(value, str)), None)
    if sample is None:
        return _fallback_value(str(field.get("dataType", "String")))
    if isinstance(sample, str):
        return sample[:120]
    if isinstance(sample, (int, float, bool)):
        return sample
    return _fallback_value(str(field.get("dataType", "String")))


def build_payload(fields: list[dict[str, Any]], context: dict[str, Any]) -> dict[str, Any]:
    """Build a nested payload from scanner fields, matching renderer semantics."""
    values, fallback_values = _sample_values(context)
    nodes: list[tuple[dict[str, Any], str, str | None]] = []
    seen: dict[str, int] = {}
    for index, field in enumerate(fields):
        name = str(field.get("nameEn") or "field")
        path = str(field.get("path") or name)
        occurrence = seen.get(path, 0) + 1
        seen[path] = occurrence
        unique_path = path if occurrence == 1 else f"{path}#{occurrence}"
        parent = field.get("parentPath")
        parent_path = str(parent) if isinstance(parent, str) and parent else None
        nodes.append((field, unique_path, parent_path))

    children: dict[str, list[tuple[dict[str, Any], str, str | None]]] = {}
    roots: list[tuple[dict[str, Any], str, str | None]] = []
    known_paths = {path for _, path, _ in nodes}
    for node in nodes:
        parent = node[2]
        if parent and parent in known_paths:
            children.setdefault(parent, []).append(node)
        else:
            roots.append(node)

    def build_node(node: tuple[dict[str, Any], str, str | None]) -> Any:
        field, path, _parent = node
        nested_children = children.get(path, [])
        if not nested_children:
            return _value_for_field(field, values, fallback_values)
        nested: dict[str, Any] = {}
        duplicate_names: dict[str, int] = {}
        for child in nested_children:
            key = str(child[0].get("nameEn") or "field")
            if key in nested:
                duplicate_names[key] = duplicate_names.get(key, 1) + 1
                key = f"{key}_{duplicate_names[key]}"
            nested[key] = build_node(child)
        return [nested] if _COLLECTION_TYPE.search(str(field.get("dataType", ""))) else nested

    payload: dict[str, Any] = {}
    duplicate_names: dict[str, int] = {}
    for root in roots:
        key = str(root[0].get("nameEn") or "field")
        if key in payload:
            duplicate_names[key] = duplicate_names.get(key, 1) + 1
            key = f"{key}_{duplicate_names[key]}"
        payload[key] = build_node(root)
    return payload


def add_static_examples(endpoints: list[dict[str, Any]], context: dict[str, Any]) -> None:
    """Attach reviewable, non-executed examples to scanner endpoint objects."""
    for endpoint in endpoints:
        request_fields = endpoint.get("requestFields")
        response_fields = endpoint.get("responseFields")
        request_payload = build_payload(request_fields if isinstance(request_fields, list) else [], context)
        response_payload = build_payload(response_fields if isinstance(response_fields, list) else [], context)
        endpoint["requestExample"] = {"body": request_payload}
        endpoint["responseExample"] = {
            "resultCode": 0,
            "resultMsg": "SUCCESS",
            "result": response_payload,
        }
        endpoint["exampleSource"] = "static-analysis"
