"""OpenAPI / Swagger collector for the MonoField interface-spec pipeline.

Converts an existing API contract into an interface-spec.json document (schema
v1) that `monofield docs render-interface-spec` accepts directly. Many Spring
projects already publish one (springdoc `/v3/api-docs`, springfox
`/v2/api-docs`), so the spec can start from the contract the team maintains.

Handles:
  - OpenAPI 3.0 / 3.1 and Swagger 2.0 (JSON; YAML only when PyYAML is installed)
  - path / query / header parameters, request bodies (JSON, form), responses
  - local `$ref` resolution, `allOf` merging, arrays, nested objects as dot paths
  - required flags, min/max length, Korean `description`/`summary` as names
  - operation or global `security` → authRequired, security schemes → auth

Usage mirrors scan_spring.py:
  python scan_openapi.py (--spec <openapi.json> | --codebase-path <dir>)
     [--inventory-only] [--modules a,b] [--name-dict <file.json|.csv>]
     [--out interface-spec.json] [--codebase-name NAME]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
from tools.excel_generator.dictionary_loader import load_dictionary_file  # noqa: E402
from tools.excel_generator.rules.naming import koreanize_identifier  # noqa: E402

HTTP_METHODS = ("get", "post", "put", "patch", "delete", "head", "options")
SPEC_NAME = re.compile(r"(?:openapi|swagger|api-docs).*\.(?:json|ya?ml)$", re.I)
SKIP_DIRS = {"node_modules", ".git", "target", "build", "dist", ".gradle", ".idea"}
_HANGUL = re.compile(r"[가-힣]")
MAX_DEPTH = 6


def load_spec(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() == ".json":
        return json.loads(text)
    try:
        import yaml  # type: ignore[import-not-found]
    except ImportError as exc:  # pragma: no cover - depends on the environment
        raise SystemExit(
            f"{path.name} is YAML; install PyYAML or export the contract as JSON (springdoc: /v3/api-docs)."
        ) from exc
    return yaml.safe_load(text)


def find_spec(root: Path) -> Path:
    candidates = []
    for path in root.rglob("*"):
        if any(part in SKIP_DIRS for part in path.parts) or not path.is_file():
            continue
        if SPEC_NAME.search(path.name):
            candidates.append(path)
    for path in sorted(candidates, key=lambda p: (len(p.parts), str(p))):
        try:
            head = path.read_text(encoding="utf-8", errors="ignore")[:4096]
        except OSError:
            continue
        if re.search(r"[\"']?\b(?:openapi|swagger)\b[\"']?\s*:", head):
            return path
    raise SystemExit(f"no OpenAPI/Swagger contract found under {root}")


class Converter:
    def __init__(self, spec: dict[str, Any], name_dict: dict[str, str]):
        self.spec = spec
        self.name_dict = name_dict
        self.swagger2 = str(spec.get("swagger", "")).startswith("2")

    # --- schema helpers -------------------------------------------------

    def resolve(self, node: Any, seen: frozenset[str] = frozenset()) -> tuple[dict[str, Any], frozenset[str]]:
        while isinstance(node, dict) and "$ref" in node:
            ref = node["$ref"]
            if not isinstance(ref, str) or not ref.startswith("#/") or ref in seen:
                return {}, seen
            seen = seen | {ref}
            target: Any = self.spec
            for part in ref[2:].split("/"):
                target = target.get(part.replace("~1", "/").replace("~0", "~"), {}) if isinstance(target, dict) else {}
            node = target
        return (node if isinstance(node, dict) else {}), seen

    def merged(self, schema: Any, seen: frozenset[str] = frozenset()) -> tuple[dict[str, Any], frozenset[str]]:
        schema, seen = self.resolve(schema, seen)
        parts = schema.get("allOf")
        if not isinstance(parts, list):
            return schema, seen
        out: dict[str, Any] = {k: v for k, v in schema.items() if k != "allOf"}
        props: dict[str, Any] = dict(out.get("properties", {}))
        required: list[str] = list(out.get("required", []))
        for part in parts:
            sub, seen = self.merged(part, seen)
            props.update(sub.get("properties", {}))
            required.extend(sub.get("required", []))
            for key in ("type", "description"):
                out.setdefault(key, sub.get(key))
        out["properties"] = props
        out["required"] = required
        return out, seen

    def type_name(self, schema: Any) -> str:
        if isinstance(schema, dict) and "$ref" in schema:
            return str(schema["$ref"]).rsplit("/", 1)[-1]
        schema, _ = self.resolve(schema)
        kind = schema.get("type")
        if isinstance(kind, list):  # OpenAPI 3.1: ["string", "null"]
            kind = next((k for k in kind if k != "null"), "")
        fmt = schema.get("format", "")
        if kind == "array":
            return f"List<{self.type_name(schema.get('items', {}))}>"
        if kind == "integer":
            return "Long" if fmt == "int64" else "Integer"
        if kind == "number":
            return {"float": "Float", "double": "Double"}.get(fmt, "BigDecimal")
        if kind == "boolean":
            return "Boolean"
        if kind == "string":
            return {"date": "LocalDate", "date-time": "LocalDateTime", "binary": "MultipartFile"}.get(fmt, "String")
        if kind == "object" or schema.get("properties"):
            return "Object"
        return "String"

    def label(self, name: str, description: str) -> tuple[str, str]:
        """Korean name and note: dictionary, then a Korean description, then rules."""
        text = (description or "").strip()
        first = re.split(r"[\n.]", text, maxsplit=1)[0].strip()
        if name in self.name_dict:
            return self.name_dict[name], text
        if first and _HANGUL.search(first) and len(first) <= 40:
            rest = text[len(first):].lstrip(". \n")
            return first, rest
        return koreanize_identifier(name), text

    def field(self, name: str, schema: Any, required: str, path: str, parent: str | None, depth: int) -> dict[str, Any]:
        resolved, _ = self.resolve(schema)
        name_ko, note = self.label(name, resolved.get("description", "") if isinstance(resolved, dict) else "")
        out: dict[str, Any] = {
            "nameEn": name,
            "nameKo": name_ko,
            "dataType": self.type_name(schema),
            "required": required,
            "minSize": str(resolved.get("minLength", "")) if resolved.get("minLength") is not None else "",
            "maxSize": str(resolved.get("maxLength", "")) if resolved.get("maxLength") is not None else "",
            "note": note,
            "path": path,
            "depth": depth,
        }
        if parent:
            out["parentPath"] = parent
        enum = resolved.get("enum")
        if isinstance(enum, list) and enum:
            values = ", ".join(str(v) for v in enum[:12])
            out["note"] = f"{out['note']} ({values})".strip() if out["note"] else values
        return out

    def expand(self, schema: Any, parent: str | None = None, depth: int = 0,
               seen: frozenset[str] = frozenset(), response: bool = False) -> list[dict[str, Any]]:
        """Flatten a schema into dot-path field rows.

        A request field is required only when listed in `required`. A response
        schema without a `required` list says nothing about presence, so its
        fields stay `TBD` for review instead of being guessed.
        """
        if depth > MAX_DEPTH:
            return []
        schema, seen = self.merged(schema, seen)
        if schema.get("type") == "array" and "items" in schema:
            return self.expand(schema["items"], parent, depth, seen, response)
        props = schema.get("properties")
        if not isinstance(props, dict):
            return []
        declared = "required" in schema and bool(schema.get("required"))
        required = set(schema.get("required", []))
        out: list[dict[str, Any]] = []
        for name, prop in props.items():
            path = name if parent is None else f"{parent}.{name}"
            flag = "Y" if name in required else ("TBD" if response and not declared else "N")
            out.append(self.field(name, prop, flag, path, parent, depth))
            child, child_seen = self.merged(prop, seen)
            target = child.get("items", child) if child.get("type") == "array" else child
            target_schema, _ = self.merged(target, child_seen)
            if isinstance(target_schema.get("properties"), dict):
                out.extend(self.expand(target, path, depth + 1, child_seen, response))
        return out

    # --- operations -----------------------------------------------------

    def parameters(self, path_item: dict[str, Any], op: dict[str, Any]) -> list[dict[str, Any]]:
        merged: dict[tuple[str, str], dict[str, Any]] = {}
        for raw in [*path_item.get("parameters", []), *op.get("parameters", [])]:
            param, _ = self.resolve(raw)
            if param.get("name") and param.get("in"):
                merged[(param["name"], param["in"])] = param
        return list(merged.values())

    def request(self, path_item: dict[str, Any], op: dict[str, Any]) -> tuple[list[dict[str, Any]], str]:
        fields: list[dict[str, Any]] = []
        body_type = ""
        for param in self.parameters(path_item, op):
            location = param["in"]
            if location == "body" and self.swagger2:
                body_type = self.type_name(param.get("schema", {}))
                fields.extend(self.expand(param.get("schema", {})))
                continue
            if location not in {"path", "query", "header", "formData", "cookie"}:
                continue
            schema = param.get("schema", param)
            required = "Y" if param.get("required") or location == "path" else "N"
            item = self.field(param["name"], schema, required, param["name"], None, 0)
            kind = {"path": "path variable", "query": "request param", "header": "request header",
                    "formData": "form field", "cookie": "cookie"}[location]
            described = ""
            if param.get("description"):
                item["nameKo"], described = self.label(param["name"], param["description"])
            # Keep the binding kind, the parameter description and schema notes (enum values).
            item["note"] = "; ".join(part for part in (kind, described, item["note"]) if part)
            fields.append(item)
        body, _ = self.resolve(op.get("requestBody", {}))
        content = body.get("content", {}) if isinstance(body, dict) else {}
        for media in ("application/json", "application/x-www-form-urlencoded", "multipart/form-data", "*/*"):
            if media in content:
                schema = content[media].get("schema", {})
                body_type = self.type_name(schema)
                fields.extend(self.expand(schema))
                break
        else:
            if content:
                schema = next(iter(content.values())).get("schema", {})
                body_type = self.type_name(schema)
                fields.extend(self.expand(schema))
        return fields, body_type

    def response(self, op: dict[str, Any]) -> tuple[list[dict[str, Any]], str]:
        responses = op.get("responses", {})
        for code in ("200", "201", "202", "default"):
            if code not in responses:
                continue
            resp, _ = self.resolve(responses[code])
            if self.swagger2:
                schema = resp.get("schema")
            else:
                content = resp.get("content", {})
                media = next((m for m in ("application/json", "*/*") if m in content), next(iter(content), None))
                schema = content[media].get("schema") if media else None
            if schema:
                return self.expand(schema, response=True), self.type_name(schema)
            return [], ""
        return [], ""

    def auth_scheme(self) -> dict[str, Any] | None:
        schemes = (self.spec.get("securityDefinitions") if self.swagger2
                   else self.spec.get("components", {}).get("securitySchemes")) or {}
        for raw in schemes.values():
            scheme, _ = self.resolve(raw)
            kind = scheme.get("type")
            if kind == "http" and str(scheme.get("scheme", "")).lower() == "bearer":
                return {"type": "bearer", "location": "header", "name": "Authorization",
                        "valueFormat": "Bearer {accessToken}", "description": "인증 헤더"}
            if kind in {"oauth2", "openIdConnect"}:
                return {"type": "bearer", "location": "header", "name": "Authorization",
                        "valueFormat": "Bearer {accessToken}", "description": "OAuth 2.0 액세스 토큰"}
            if kind == "apiKey":
                where = scheme.get("in", "header")
                if where == "cookie":
                    return {"type": "session-cookie", "location": "cookie", "name": scheme.get("name", ""),
                            "valueFormat": "{sessionId}", "description": "세션 쿠키"}
                return {"type": "api-key", "location": "query" if where == "query" else "header",
                        "name": scheme.get("name", ""), "valueFormat": "{apiKey}", "description": "API 키"}
        return None

    def endpoints(self) -> list[dict[str, Any]]:
        base = ""
        if self.swagger2:
            base = str(self.spec.get("basePath", "") or "").rstrip("/")
        global_security = bool(self.spec.get("security"))
        out: list[dict[str, Any]] = []
        for raw_path, path_item in (self.spec.get("paths") or {}).items():
            if not isinstance(path_item, dict):
                continue
            for method in HTTP_METHODS:
                op = path_item.get(method)
                if not isinstance(op, dict):
                    continue
                request_fields, body_type = self.request(path_item, op)
                response_fields, response_type = self.response(op)
                security = op.get("security", None)
                auth_required = bool(security) if security is not None else global_security
                summary = (op.get("summary") or "").strip()
                tags = op.get("tags") or []
                out.append({
                    "method": method.upper(),
                    "path": f"{base}{raw_path}" if base else raw_path,
                    "interfaceId": str(op.get("x-interface-id", "") or ""),
                    "interfaceName": summary,
                    "businessCode": "",
                    "channel": "",
                    "owner": "",
                    "note": "deprecated" if op.get("deprecated") else "",
                    "moduleName": str(tags[0]) if tags else "",
                    "serviceName": "",
                    "handlerName": str(op.get("operationId", "") or ""),
                    "sourceFile": "",
                    "authRequired": auth_required,
                    "requestBodyType": body_type,
                    "queryDtoType": "",
                    "responseType": response_type,
                    "requestFields": request_fields,
                    "responseFields": response_fields,
                })
        return out


def module_of(endpoint: dict[str, Any]) -> str:
    if endpoint["moduleName"]:
        return endpoint["moduleName"]
    parts = [p for p in endpoint["path"].split("/") if p and not p.startswith("{") and p not in {"api"}]
    parts = [p for p in parts if not re.fullmatch(r"v\d+", p)]
    return parts[0] if parts else "root"


def main() -> int:
    ap = argparse.ArgumentParser()
    source = ap.add_mutually_exclusive_group(required=True)
    source.add_argument("--spec", help="OpenAPI 3.x or Swagger 2.0 JSON file")
    source.add_argument("--codebase-path", help="search this folder for an OpenAPI/Swagger contract")
    ap.add_argument("--out", default="interface-spec.json")
    ap.add_argument("--inventory-only", action="store_true")
    ap.add_argument("--modules", default="")
    ap.add_argument("--name-dict", default="")
    ap.add_argument("--codebase-name", default="")
    args = ap.parse_args()

    spec_path = Path(args.spec).resolve() if args.spec else find_spec(Path(args.codebase_path).resolve())
    if not spec_path.exists():
        raise SystemExit(f"contract not found: {spec_path}")
    spec = load_spec(spec_path)
    if not isinstance(spec, dict) or not ({"openapi", "swagger"} & set(spec)):
        raise SystemExit(f"{spec_path.name} is not an OpenAPI or Swagger document")

    name_dict = load_dictionary_file(Path(args.name_dict)) if args.name_dict else {}
    converter = Converter(spec, name_dict)
    endpoints = converter.endpoints()
    wanted = {m.strip() for m in args.modules.split(",") if m.strip()}
    if wanted:
        endpoints = [ep for ep in endpoints if module_of(ep) in wanted]

    if args.inventory_only:
        counts = Counter(module_of(ep) for ep in endpoints)
        json.dump({
            "endpointCount": len(endpoints),
            "modules": dict(counts.most_common()),
            "endpoints": [{"method": ep["method"], "path": ep["path"], "module": module_of(ep),
                           "handler": ep["handlerName"], "sourceFile": spec_path.name} for ep in endpoints],
        }, sys.stdout, ensure_ascii=False, indent=1)
        print()
        return 0

    for ep in endpoints:
        ep["sourceFile"] = spec_path.name
        if not _HANGUL.search(ep["interfaceName"]):
            candidate = koreanize_identifier(ep["handlerName"]) if ep["handlerName"] else ""
            if _HANGUL.search(candidate):
                ep["interfaceName"] = candidate
    info = spec.get("info", {}) if isinstance(spec.get("info"), dict) else {}
    auth = converter.auth_scheme()
    doc = {
        "schemaVersion": 1,
        "kind": "interface-spec",
        "cover": {"brand": "", "docName": str(info.get("title", "") or ""), "version": str(info.get("version", "") or ""),
                  "department": ""},
        "source": {
            "codebaseName": args.codebase_name or str(info.get("title", "") or spec_path.stem),
            "codebasePath": str(spec_path.parent),
            "language": "openapi",
            "framework": f"swagger-{spec.get('swagger')}" if converter.swagger2 else f"openapi-{spec.get('openapi')}",
            "collector": "static-openapi",
        },
        **({"auth": auth} if auth else {}),
        "endpoints": sorted(endpoints, key=lambda e: (module_of(e), e["path"], e["method"])),
    }
    Path(args.out).write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    counts = Counter(module_of(ep) for ep in endpoints)
    print(json.dumps({"out": str(Path(args.out).resolve()), "contract": str(spec_path),
                      "endpointCount": len(endpoints), "modules": dict(counts.most_common())},
                     ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
