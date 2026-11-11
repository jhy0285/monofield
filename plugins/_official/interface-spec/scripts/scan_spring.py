"""Spring Boot fast-path collector for the MonoField interface-spec pipeline.

Wraps the proven static scanner (ported from the generate-api-interface-excel
skill, stdlib-only) and emits an interface-spec.json document (schema v1)
that `monofield docs render-interface-spec` accepts directly.

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

Per-endpoint `authRequired` comes from the Spring Security Java configuration
and method-security annotations (see collector/spring_security.py). An endpoint
without that evidence stays undecided: `authRequired: true` with
`auth: {"type": "undecided"}` and a note saying why, the same mapping the
contract uses for an undecided manual draft.

The agent remains responsible for reviewing/refining the output (undecided
auth, Korean names the dictionary missed, notes).
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from tools.excel_generator.collector.controller_scanner import (  # noqa: E402
    scan_controllers,
    to_api_endpoints,
)
from tools.excel_generator.collector.spring_security import production_java_files  # noqa: E402
from tools.excel_generator.collector.dto_expander import (  # noqa: E402
    referenced_classes,
    _candidate_nested_classes as candidate_nested_classes,
    expand_dto_to_spec_fields,
    enum_values_for,
    expand_type_to_spec_fields,
    parse_java_classes,
)
from tools.excel_generator.rules.audit_fields import set_include_audit_fields  # noqa: E402
from tools.excel_generator.rules.naming import (  # noqa: E402
    koreanize_identifier,
    load_name_dict,
)
from tools.excel_generator.synthetic_examples import add_static_examples, load_sample_context  # noqa: E402
from tools.excel_generator.dictionary_loader import load_dictionary_file  # noqa: E402

_HANGUL = re.compile(r"[가-힣]")


def detect_spring_auth(codebase: Path) -> dict | None:
    """Best-effort static detection of the API's auth scheme (how, not whether).

    Returns a stack-neutral auth scheme dict for the document-level `auth`, or
    None if undetectable, in which case the agent/human fills it in. Whether
    each endpoint needs it is decided separately from the security
    configuration; both read the same production sources, so a test-only
    configuration never decides either. Precedence: an explicit session-cookie
    (a filter reading a named cookie) beats a bearer/JWT filter, because
    cookie-session apps often still carry JWT libraries for downstream calls.
    """
    hay_bearer = False
    session_cookie_name: str | None = None
    for p in production_java_files(codebase)[:4000]:
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


def auth_status(ep) -> str:
    if ep.auth_required is None:
        return "undecided"
    return "required" if ep.auth_required else "public"


def module_of(path: str) -> str:
    """Second segment under /api/vN/, else first segment."""
    parts = [p for p in path.strip("/").split("/") if p]
    if len(parts) >= 3 and parts[0] == "api" and parts[1].lower().startswith("v"):
        return parts[2]
    return parts[0] if parts else "root"


def load_custom_dict(path: Path) -> dict[str, str]:
    return load_dictionary_file(path)


def field_to_json(field) -> dict:
    out = {
        "nameEn": field.name_en,
        "nameKo": field.name_ko or "",
        "dataType": field.data_type or "String",
        "required": field.required if field.required in ("Y", "N") else "N",
        "note": field.note or "",
        "depth": int(field.depth or 0),
    }
    if getattr(field, "max_size", ""):
        out["maxSize"] = field.max_size
    if getattr(field, "enum_values", None):
        out["enumValues"] = list(field.enum_values)
    if getattr(field, "default_value", None) is not None:
        out["defaultValue"] = field.default_value
    if field.path:
        out["path"] = field.path
    if field.parent_path:
        out["parentPath"] = field.parent_path
    return out


_SCANNED_SOURCE = re.compile(r"\.(java|xml)$", re.IGNORECASE)


_UNWRAP_ROOT_RE = re.compile(r"\bunwrap[-_]root[-_]value\s*[:=]\s*true\b", re.IGNORECASE)
_WRAP_ROOT_RE = re.compile(r"(?<![a-z_-])wrap[-_]root[-_]value\s*[:=]\s*true\b", re.IGNORECASE)


def jackson_root_wrapping(codebase: Path) -> tuple[bool, bool]:
    """Whether the project turns on Jackson's root wrapping: (UNWRAP_ROOT_VALUE for request bodies, WRAP_ROOT_VALUE for
    responses), read from `application*.properties` and `application*.yml` outside test and build folders."""
    unwrap = wrap = False
    for path in list(codebase.rglob("application*.properties")) + list(codebase.rglob("application*.y*ml")):
        parts = set(path.parts)
        if parts & {"test", "target", "build", "node_modules", ".git"}:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        unwrap = unwrap or bool(_UNWRAP_ROOT_RE.search(text))
        wrap = wrap or bool(_WRAP_ROOT_RE.search(text))
    return unwrap, wrap


def committed_revision(codebase: Path) -> str | None:
    """The Git commit the scanned sources match, or None.

    Recorded only when every Java and XML file under the codebase is committed, so that `monofield docs impact`
    can compare the code with exactly what was read, even after later commits."""
    def git(*args: str) -> str:
        return subprocess.run(["git", "-C", str(codebase), *args], check=True, capture_output=True, text=True,
                              timeout=30, encoding="utf-8", errors="replace").stdout
    try:
        if git("rev-parse", "--is-inside-work-tree").strip() != "true":
            return None
        head = git("rev-parse", "--verify", "HEAD").strip()
        status = git("status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ".")
    except (OSError, subprocess.SubprocessError):
        return None
    entries = [entry for entry in status.split("\0") if entry]
    if any(_SCANNED_SOURCE.search(entry[3:] if len(entry) > 3 else entry) for entry in entries):
        return None
    return head if re.fullmatch(r"[0-9a-f]{40}", head) else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--codebase-path", required=True)
    ap.add_argument("--out", default="interface-spec.json")
    ap.add_argument("--inventory-only", action="store_true")
    ap.add_argument("--modules", default="", help="comma-separated module filter")
    ap.add_argument("--name-dict", default="", help="custom dictionary (.json/.csv), overrides bundled entries")
    ap.add_argument("--sample-context", default="", help="approved database-context JSON; never credentials")
    ap.add_argument("--codebase-name", default="")
    ap.add_argument("--include-audit-fields", action="store_true",
                    help="keep audit columns (createdAt, updatedAt, regDate, ...) that are left out by default")
    ap.add_argument("--language", default="java")
    ap.add_argument("--framework", default="spring-boot")
    args = ap.parse_args()

    set_include_audit_fields(args.include_audit_fields)
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
    unwrap_requests, wrap_responses = jackson_root_wrapping(codebase)
    for ep in endpoints:
        # Path variables, query parameters and headers are bound by enum constant name.
        for f in ep.request_fields:
            if f.enum_values is None and f.note in ("request param", "path variable", "request header"):
                f.enum_values = enum_values_for(f.data_type, classes, json_body=False)
        if ep.request_body_type:
            fields, _conflicts = expand_dto_to_spec_fields(classes, ep.request_body_type, "REQUEST", name_dict,
                                                           wrap_root=unwrap_requests)
            ep.request_fields.extend(fields)
        if ep.query_dto_type:
            # A handler can bind several form objects (e.g. eGov `searchVO` plus the
            # entity VO); expand each and keep the first occurrence of a field path.
            seen = {f.path or f.name_en for f in ep.request_fields}
            for form_type in (part.strip() for part in ep.query_dto_type.split(",")):
                fields, _conflicts = expand_dto_to_spec_fields(classes, form_type, "REQUEST", name_dict, json_body=False)
                for f in fields:
                    key = f.path or f.name_en
                    if key not in seen:
                        seen.add(key)
                        ep.request_fields.append(f)
        if ep.response_type:
            fields, _conflicts = expand_type_to_spec_fields(classes, ep.response_type, "RESPONSE", name_dict,
                                                            wrap_root=wrap_responses)
            ep.response_fields.extend(fields)
        # Keys put into a returned Map carry the value's type (`put("user", userWithToken)`); list that DTO under its key.
        if any(f.depth == 0 and candidate_nested_classes(f.data_type, classes) for f in ep.response_fields):
            nested: list = []
            for f in ep.response_fields:
                nested.append(f)
                if f.depth == 0:
                    for cls_name in candidate_nested_classes(f.data_type, classes):
                        sub, _conflicts = expand_dto_to_spec_fields(classes, cls_name, "RESPONSE", name_dict, under=f.path)
                        nested.extend(sub)
            ep.response_fields = nested

    def dto_evidence(ep) -> list[dict]:
        """Code references to the DTO files the endpoint's fields were read from.

        Without them a change to a DTO alone never reaches the change analysis, which only matches changed files
        against the controller and the references listed here.
        """
        refs: list[dict] = []
        seen: set[tuple[str, str]] = set()
        roles = [("요청", ep.request_body_type)]
        roles += [("요청", part.strip()) for part in (ep.query_dto_type or "").split(",")]
        roles.append(("응답", ep.response_type))
        for role, type_raw in roles:
            for cls in referenced_classes(classes, type_raw or ""):
                try:
                    relative = cls.path.resolve().relative_to(codebase).as_posix()
                except ValueError:
                    continue
                if (role, relative) in seen:
                    continue
                seen.add((role, relative))
                refs.append({"kind": "code", "ref": relative, "symbol": cls.name, "summary": f"{role} DTO: {cls.name}"})
        return refs

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
            **({"revision": revision} if (revision := committed_revision(codebase)) else {}),
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
                "note": ep.note or "",
                "moduleName": ep.package_name or "",
                "serviceName": ep.service_name or "",
                "handlerName": ep.method_name or "",
                "sourceFile": ep.controller_file or "",
                **({"sourceLine": ep.controller_line} if ep.controller_line else {}),
                # Undecided stays visible as a TBD auth row instead of a guessed one.
                "authRequired": ep.auth_required is not False,
                **({"auth": {"type": "undecided"}} if ep.auth_required is None else {}),
                **({"authorities": list(ep.authorities)} if ep.authorities else {}),
                **({"accessRule": ep.access_rule} if ep.access_rule else {}),
                **({"evidenceRefs": refs} if (refs := [*(ep.auth_evidence or []), *dto_evidence(ep)]) else {}),
                "requestBodyType": ep.request_body_type or "",
                "queryDtoType": ep.query_dto_type or "",
                "responseType": ep.response_type or "",
                "requestFields": [field_to_json(f) for f in ep.request_fields],
                "responseFields": [field_to_json(f) for f in ep.response_fields],
            }
            for ep in sorted(endpoints, key=lambda e: (module_of(e.path), e.path, e.method))
        ],
    }
    add_static_examples(doc["endpoints"], load_sample_context(args.sample_context, args.codebase_path))

    out_path = Path(args.out)
    out_path.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    print(
        json.dumps(
            {
                "out": str(out_path.resolve()),
                "endpointCount": len(doc["endpoints"]),
                "modules": dict(Counter(module_of(ep.path) for ep in endpoints).most_common()),
                "koreanNameCoverage": sum(1 for e in doc["endpoints"] if e["interfaceName"]) ,
                "auth": dict(Counter(auth_status(ep) for ep in endpoints)),
            },
            ensure_ascii=False,
            indent=1,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
