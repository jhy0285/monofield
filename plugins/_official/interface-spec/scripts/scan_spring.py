"""Spring Boot fast-path collector for the Open Docs interface-spec pipeline.

Wraps the proven static scanner (ported from the generate-api-interface-excel
skill, stdlib-only) and emits an interface-spec.json document (schema v1)
that `od docs render-interface-spec` accepts directly.

Usage:
  python scan_spring.py --codebase-path <repo-or-module> [--inventory-only]
                        [--modules a,b] [--name-dict <file.json|.csv>]
                        [--out interface-spec.json]
                        [--codebase-name NAME] [--framework spring-boot]

Modes:
  --inventory-only  Print module counts + a compact endpoint list as JSON on
                    stdout (no DTO expansion). Use this first to confirm
                    scope with the user on large codebases.
  (default)         Full collection: routes + recursive DTO expansion +
                    dictionary-based Korean names -> interface-spec.json.

The agent remains responsible for reviewing/refining the output (auth flags
against the security config, Korean names the dictionary missed, notes).
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from tools.excel_generator.collector.controller_scanner import (  # noqa: E402
    scan_controllers,
    to_api_endpoints,
)
from tools.excel_generator.collector.dto_expander import (  # noqa: E402
    expand_dto_to_spec_fields,
    expand_type_to_spec_fields,
    parse_java_classes,
)
from tools.excel_generator.rules.naming import (  # noqa: E402
    koreanize_identifier,
    load_name_dict,
)

_HANGUL = re.compile(r"[가-힣]")


def detect_spring_auth(codebase: Path) -> dict | None:
    """Best-effort static detection of the API's auth scheme.

    Returns a stack-neutral auth scheme dict (or None if undetectable, in which
    case the agent/human fills it in). Precedence: an explicit session-cookie
    (a filter reading a named cookie) beats a bearer/JWT filter, because
    cookie-session apps often still carry JWT libraries for downstream calls.
    """
    hay_bearer = False
    session_cookie_name: str | None = None
    java_files = [p for p in codebase.rglob("*.java")
                  if not any(part in {"test", "tests", "build", "target"} for part in p.parts)]
    for p in java_files[:4000]:
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        low = text.lower()
        # Session-cookie signal: a cookie-based session filter/service. Capture
        # the cookie constant name when present (e.g. SESSION_ID_COOKIE = "sid").
        if ("getcookies()" in low or "sessionauthenticationfilter" in low
                or "getsessionid" in low or "cookievalue" in low):
            m = re.search(r'SESSION_ID_COOKIE\s*=\s*"([^"]+)"', text)
            if m:
                session_cookie_name = m.group(1)
            elif session_cookie_name is None:
                session_cookie_name = ""  # detected cookie session, name unknown yet
        if "sessionidname" in low and session_cookie_name in (None, ""):
            m = re.search(r'sessionIdName\s*=\s*[^;]*"([^"]+)"', text)
            if m:
                session_cookie_name = m.group(1)
        # Bearer signal: Authorization: Bearer / JWT bearer token filter.
        if ("bearertokenauthenticationfilter" in low
                or 'authorization' in low and 'bearer' in low
                or "oauth2resourceserver" in low):
            hay_bearer = True

    if session_cookie_name is not None:
        name = session_cookie_name or "sid"
        return {
            "type": "session-cookie",
            "location": "cookie",
            "name": name,
            "valueFormat": f"{name}={{sessionId}}",
            "description": "세션 쿠키",
        }
    if hay_bearer:
        return {"type": "bearer", "description": "인증 헤더", "valueFormat": "Bearer {accessToken}"}
    return None


def module_of(path: str) -> str:
    """Second segment under /api/vN/, else first segment."""
    parts = [p for p in path.strip("/").split("/") if p]
    if len(parts) >= 3 and parts[0] == "api" and parts[1].lower().startswith("v"):
        return parts[2]
    return parts[0] if parts else "root"


def load_custom_dict(path: Path) -> dict[str, str]:
    """Custom dictionary: JSON object {nameEn: nameKo} or CSV nameEn,nameKo."""
    if path.suffix.lower() == ".json":
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise SystemExit(f"--name-dict {path}: JSON must be an object of nameEn -> nameKo")
        return {str(k): str(v) for k, v in raw.items()}
    if path.suffix.lower() == ".csv":
        out: dict[str, str] = {}
        with path.open(encoding="utf-8-sig", newline="") as fh:
            for row in csv.reader(fh):
                if len(row) >= 2 and row[0].strip() and not row[0].startswith("#"):
                    out[row[0].strip()] = row[1].strip()
        return out
    raise SystemExit(f"--name-dict {path}: unsupported format (use .json or .csv)")


def field_to_json(field) -> dict:
    out = {
        "nameEn": field.name_en,
        "nameKo": field.name_ko or "",
        "dataType": field.data_type or "String",
        "required": field.required if field.required in ("Y", "N") else "N",
        "note": field.note or "",
        "depth": int(field.depth or 0),
    }
    if field.path:
        out["path"] = field.path
    if field.parent_path:
        out["parentPath"] = field.parent_path
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--codebase-path", required=True)
    ap.add_argument("--out", default="interface-spec.json")
    ap.add_argument("--inventory-only", action="store_true")
    ap.add_argument("--modules", default="", help="comma-separated module filter")
    ap.add_argument("--name-dict", default="", help="custom dictionary (.json/.csv), overrides bundled entries")
    ap.add_argument("--codebase-name", default="")
    ap.add_argument("--language", default="java")
    ap.add_argument("--framework", default="spring-boot")
    args = ap.parse_args()

    codebase = Path(args.codebase_path).resolve()
    if not codebase.exists():
        raise SystemExit(f"codebase path not found: {codebase}")

    seeds = scan_controllers(codebase, codebase)
    endpoints = to_api_endpoints(seeds)

    wanted = {m.strip() for m in args.modules.split(",") if m.strip()}
    if wanted:
        endpoints = [ep for ep in endpoints if module_of(ep.path) in wanted]

    if args.inventory_only:
        counts = Counter(module_of(ep.path) for ep in endpoints)
        inventory = {
            "endpointCount": len(endpoints),
            "modules": dict(counts.most_common()),
            "endpoints": [
                {
                    "method": ep.method,
                    "path": ep.path,
                    "module": module_of(ep.path),
                    "handler": ep.method_name,
                    "sourceFile": ep.controller_file,
                }
                for ep in endpoints
            ],
        }
        json.dump(inventory, sys.stdout, ensure_ascii=False, indent=1)
        print()
        return 0

    name_dict = load_name_dict()
    if args.name_dict:
        custom = load_custom_dict(Path(args.name_dict))
        name_dict = {**name_dict, **custom}  # custom wins

    classes = parse_java_classes(codebase)
    for ep in endpoints:
        if ep.request_body_type:
            fields, _conflicts = expand_dto_to_spec_fields(classes, ep.request_body_type, "REQUEST", name_dict)
            ep.request_fields.extend(fields)
        if ep.query_dto_type:
            fields, _conflicts = expand_dto_to_spec_fields(classes, ep.query_dto_type, "REQUEST", name_dict)
            ep.request_fields.extend(fields)
        if ep.response_type:
            fields, _conflicts = expand_type_to_spec_fields(classes, ep.response_type, "RESPONSE", name_dict)
            ep.response_fields.extend(fields)

    def korean_name(ep) -> str:
        provided = (ep.interface_name or "").strip()
        if provided and _HANGUL.search(provided):
            return provided
        base = (ep.method_name or "").strip() or ep.path
        candidate = koreanize_identifier(base)
        return candidate if _HANGUL.search(candidate or "") else ""

    auth = detect_spring_auth(codebase)

    doc = {
        "schemaVersion": 1,
        "kind": "interface-spec",
        "cover": {"brand": "", "docName": "", "version": "", "department": ""},
        "source": {
            "codebaseName": args.codebase_name or codebase.name,
            "codebasePath": str(codebase),
            "language": args.language,
            "framework": args.framework,
            "collector": "static-spring",
        },
        **({"auth": auth} if auth else {}),
        "endpoints": [
            {
                "method": ep.method,
                "path": ep.path,
                "interfaceId": (ep.interface_id or "").strip(),
                "interfaceName": korean_name(ep),
                "businessCode": "",
                "channel": "",
                "owner": "",
                "note": "",
                "moduleName": ep.package_name or "",
                "serviceName": ep.service_name or "",
                "handlerName": ep.method_name or "",
                "sourceFile": ep.controller_file or "",
                **({"sourceLine": ep.controller_line} if ep.controller_line else {}),
                "authRequired": bool(ep.auth_required),
                "requestBodyType": ep.request_body_type or "",
                "queryDtoType": ep.query_dto_type or "",
                "responseType": ep.response_type or "",
                "requestFields": [field_to_json(f) for f in ep.request_fields],
                "responseFields": [field_to_json(f) for f in ep.response_fields],
            }
            for ep in sorted(endpoints, key=lambda e: (module_of(e.path), e.path, e.method))
        ],
    }

    out_path = Path(args.out)
    out_path.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    print(
        json.dumps(
            {
                "out": str(out_path.resolve()),
                "endpointCount": len(doc["endpoints"]),
                "modules": dict(Counter(module_of(ep.path) for ep in endpoints).most_common()),
                "koreanNameCoverage": sum(1 for e in doc["endpoints"] if e["interfaceName"]) ,
            },
            ensure_ascii=False,
            indent=1,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
