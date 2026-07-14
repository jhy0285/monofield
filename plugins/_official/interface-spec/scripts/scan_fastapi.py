"""FastAPI collector for the Open Docs interface-spec pipeline.

AST-based (not regex): parses route decorators, endpoint signatures, and
pydantic models to emit an interface-spec.json document (schema v1) that
`od docs render-interface-spec` accepts directly.

Handles:
  - @app/@router .get/.post/.put/.patch/.delete("path", response_model=Model)
  - APIRouter(prefix="...") + include_router(prefix="...") prefix resolution
  - path params ({id} in the path, always required)
  - query params (typed args with defaults / Query(...))
  - request body (pydantic BaseModel-typed arg)
  - response body (response_model= or the return annotation)
  - recursive pydantic model field expansion (nested models + list[Model])
  - required rule: field without default -> Y; Optional/X|None/default -> N

Usage mirrors scan_spring.py:
  python scan_fastapi.py --codebase-path <path> [--inventory-only]
     [--modules a,b] [--name-dict <file.json|.csv>] [--out interface-spec.json]
"""

from __future__ import annotations

import argparse
import ast
import csv
import json
import re
import sys
from collections import Counter
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

try:
    from tools.excel_generator.rules.naming import koreanize_identifier, load_name_dict
except Exception:  # pragma: no cover - dictionary is optional
    def load_name_dict() -> dict[str, str]:
        return {}

    def koreanize_identifier(text: str) -> str:
        return text


HTTP_METHODS = {"get", "post", "put", "patch", "delete", "head", "options"}
_HANGUL = re.compile(r"[가-힣]")
AUDIT = {
    "created_at", "updated_at", "created_by", "updated_by", "deleted_at",
    "createdat", "updatedat", "crtr_id", "creat_dttm", "updatr_id", "updat_dttm",
}


def ann_to_str(node: ast.expr | None) -> str:
    if node is None:
        return ""
    try:
        return ast.unparse(node)
    except Exception:
        return ""


def is_optional(annotation: str, has_default: bool) -> bool:
    a = annotation.replace(" ", "")
    return has_default or "|None" in a or a.startswith("Optional[") or "None|" in a


def base_type(annotation: str) -> str:
    """Strip Optional/list/Union wrappers to a leaf type name for model lookup."""
    a = annotation.strip()
    a = re.sub(r"\bOptional\[(.+)\]$", r"\1", a)
    a = a.split("|")[0].strip()  # X | None -> X
    m = re.match(r"^(?:list|List|Sequence|Iterable|set|Set)\[(.+)\]$", a)
    if m:
        a = m.group(1).strip()
    a = a.split("[")[0]  # drop remaining generics
    return a.strip()


def is_collection(annotation: str) -> bool:
    a = annotation.replace(" ", "")
    return bool(re.match(r"^(list|List|Sequence|Iterable|set|Set)\[", a)) or a.endswith("]") and a[:4].lower() in ("list", "set")


class Collected:
    def __init__(self) -> None:
        self.models: dict[str, ast.ClassDef] = {}
        self.router_prefix: dict[str, str] = {}  # variable name -> prefix
        self.endpoints: list[dict] = []


def collect_file(path: Path, root: Path, c: Collected) -> None:
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except (SyntaxError, UnicodeDecodeError):
        return
    rel = str(path.relative_to(root)).replace("\\", "/")

    # Pass 1: pydantic models + router prefixes
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            bases = {ann_to_str(b).split("[")[0].split(".")[-1] for b in node.bases}
            if bases & {"BaseModel", "GenericModel"} or any("BaseModel" in ann_to_str(b) for b in node.bases):
                c.models[node.name] = node
        if isinstance(node, ast.Assign):
            val = node.value
            if isinstance(val, ast.Call) and ann_to_str(val.func).split(".")[-1] == "APIRouter":
                prefix = ""
                for kw in val.keywords:
                    if kw.arg == "prefix":
                        prefix = _literal_str(kw.value)
                for tgt in node.targets:
                    if isinstance(tgt, ast.Name):
                        c.router_prefix[tgt.id] = prefix

    # include_router(prefix=...) — merge onto included router's own prefix
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and ann_to_str(node.func).split(".")[-1] == "include_router":
            inc_prefix = ""
            for kw in node.keywords:
                if kw.arg == "prefix":
                    inc_prefix = _literal_str(kw.value)
            if inc_prefix and node.args:
                inner = ann_to_str(node.args[0]).split(".")[-1]
                if inner in c.router_prefix:
                    c.router_prefix[inner] = inc_prefix + c.router_prefix[inner]

    # Pass 2: routes
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for dec in node.decorator_list:
            route = _parse_route_decorator(dec, c)
            if route is None:
                continue
            method, path_str, response_model = route
            c.endpoints.append(
                {
                    "method": method.upper(),
                    "path": path_str,
                    "handler": node.name,
                    "sourceFile": rel,
                    "sourceLine": node.lineno,
                    "func": node,
                    "response_model": response_model,
                }
            )


def _literal_str(node: ast.expr) -> str:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return ""


def _parse_route_decorator(dec: ast.expr, c: Collected):
    if not isinstance(dec, ast.Call):
        return None
    func = dec.func
    if not isinstance(func, ast.Attribute) or func.attr not in HTTP_METHODS:
        return None
    obj = func.value
    obj_name = obj.id if isinstance(obj, ast.Name) else ""
    prefix = c.router_prefix.get(obj_name, "")
    path_str = _literal_str(dec.args[0]) if dec.args else ""
    full = (prefix + path_str) or path_str
    if not full.startswith("/"):
        full = "/" + full
    response_model = ""
    for kw in dec.keywords:
        if kw.arg == "response_model":
            response_model = base_type(ann_to_str(kw.value))
    return func.attr, full, response_model


def expand_model(name: str, c: Collected, name_dict: dict, seen: set[str], depth: int, parent_path: str | None) -> list[dict]:
    """Recursively expand a pydantic model into flat interface-spec fields."""
    fields: list[dict] = []
    cls = c.models.get(name)
    if cls is None or name in seen or depth > 6:
        return fields
    seen = seen | {name}
    for stmt in cls.body:
        if not isinstance(stmt, ast.AnnAssign) or not isinstance(stmt.target, ast.Name):
            continue
        fname = stmt.target.id
        if fname.startswith("_") or fname.lower() in AUDIT:
            continue
        annotation = ann_to_str(stmt.annotation)
        has_default = stmt.value is not None
        path = f"{parent_path}.{fname}" if parent_path else fname
        fields.append(
            {
                "nameEn": fname,
                "nameKo": _ko(fname, name_dict),
                "dataType": annotation or "Any",
                "required": "N" if is_optional(annotation, has_default) else "Y",
                "note": "",
                "path": path,
                **({"parentPath": parent_path} if parent_path else {}),
                "depth": depth,
            }
        )
        leaf = base_type(annotation)
        if leaf in c.models and leaf != name:
            fields.extend(expand_model(leaf, c, name_dict, seen, depth + 1, path))
    return fields


def _ko(name_en: str, name_dict: dict) -> str:
    if name_en in name_dict:
        return name_dict[name_en]
    k = koreanize_identifier(name_en)
    return k if _HANGUL.search(k or "") else ""


def build_request_fields(func: ast.AST, path_str: str, c: Collected, name_dict: dict) -> list[dict]:
    fields: list[dict] = []
    path_params = set(re.findall(r"\{([^}:]+)", path_str))
    args = func.args
    defaults = {a.arg: True for a in args.args[len(args.args) - len(args.defaults):]}
    # Framework objects that are never part of the documented interface.
    framework_types = {"Request", "Response", "BackgroundTasks", "WebSocket", "SecurityScopes"}
    for a in args.args:
        if a.arg in ("self", "cls"):
            continue
        annotation = ann_to_str(a.annotation)
        leaf = base_type(annotation)
        # Skip Starlette Request/Response and DI dependencies — but only by
        # TYPE, so a pydantic body param named `request` is still captured.
        if leaf in framework_types or "Depends(" in annotation or "Security(" in annotation:
            continue
        if a.arg in path_params:
            fields.append({"nameEn": a.arg, "nameKo": _ko(a.arg, name_dict), "dataType": annotation or "str",
                           "required": "Y", "note": "path", "path": a.arg, "depth": 0})
        elif leaf in c.models:
            # request body model → expand
            fields.append({"nameEn": a.arg, "nameKo": _ko(a.arg, name_dict), "dataType": leaf,
                           "required": "N" if a.arg in defaults else "Y", "note": "body", "path": a.arg, "depth": 0})
            fields.extend(expand_model(leaf, c, name_dict, set(), 1, a.arg))
        else:
            has_default = a.arg in defaults
            fields.append({"nameEn": a.arg, "nameKo": _ko(a.arg, name_dict), "dataType": annotation or "str",
                           "required": "N" if is_optional(annotation, has_default) else "Y",
                           "note": "query", "path": a.arg, "depth": 0})
    return fields


def build_response_fields(ep: dict, c: Collected, name_dict: dict) -> list[dict]:
    model = ep["response_model"] or base_type(ann_to_str(ep["func"].returns))
    if model in c.models:
        return expand_model(model, c, name_dict, set(), 0, None)
    return []


def module_of(path: str, source_file: str) -> str:
    parts = [p for p in path.strip("/").split("/") if p and not p.startswith("{")]
    return parts[0] if parts else Path(source_file).stem


def korean_iface_name(handler: str, name_dict: dict) -> str:
    base = handler.replace("_", " ")
    if handler in name_dict:
        return name_dict[handler]
    k = koreanize_identifier(base)
    return k if _HANGUL.search(k or "") else ""


def load_custom_dict(path: Path) -> dict[str, str]:
    if path.suffix.lower() == ".json":
        raw = json.loads(path.read_text(encoding="utf-8"))
        return {str(k): str(v) for k, v in raw.items()}
    if path.suffix.lower() == ".csv":
        out = {}
        with path.open(encoding="utf-8-sig", newline="") as fh:
            for row in csv.reader(fh):
                if len(row) >= 2 and row[0].strip() and not row[0].startswith("#"):
                    out[row[0].strip()] = row[1].strip()
        return out
    raise SystemExit(f"--name-dict {path}: use .json or .csv")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--codebase-path", required=True)
    ap.add_argument("--out", default="interface-spec.json")
    ap.add_argument("--inventory-only", action="store_true")
    ap.add_argument("--modules", default="")
    ap.add_argument("--name-dict", default="")
    ap.add_argument("--codebase-name", default="")
    args = ap.parse_args()

    root = Path(args.codebase_path).resolve()
    if not root.exists():
        raise SystemExit(f"codebase path not found: {root}")

    c = Collected()
    for py in root.rglob("*.py"):
        if any(part in {".venv", "venv", "site-packages", "__pycache__", "tests", "test"} for part in py.parts):
            continue
        collect_file(py, root, c)

    # de-dupe endpoints by method+path (keep first)
    seen_keys: set[str] = set()
    endpoints = []
    for ep in c.endpoints:
        key = f"{ep['method']} {ep['path']}"
        if key in seen_keys:
            continue
        seen_keys.add(key)
        endpoints.append(ep)

    wanted = {m.strip() for m in args.modules.split(",") if m.strip()}
    if wanted:
        endpoints = [ep for ep in endpoints if module_of(ep["path"], ep["sourceFile"]) in wanted]

    if args.inventory_only:
        counts = Counter(module_of(ep["path"], ep["sourceFile"]) for ep in endpoints)
        json.dump(
            {
                "endpointCount": len(endpoints),
                "modules": dict(counts.most_common()),
                "endpoints": [
                    {"method": ep["method"], "path": ep["path"],
                     "module": module_of(ep["path"], ep["sourceFile"]), "handler": ep["handler"],
                     "sourceFile": ep["sourceFile"]}
                    for ep in endpoints
                ],
            },
            sys.stdout, ensure_ascii=False, indent=1,
        )
        print()
        return 0

    name_dict = load_name_dict()
    if args.name_dict:
        name_dict = {**name_dict, **load_custom_dict(Path(args.name_dict))}

    doc = {
        "schemaVersion": 1,
        "kind": "interface-spec",
        "cover": {"brand": "", "docName": "", "version": "", "department": ""},
        "source": {
            "codebaseName": args.codebase_name or root.name,
            "codebasePath": str(root),
            "language": "python",
            "framework": "fastapi",
            "collector": "static-fastapi",
        },
        "endpoints": [
            {
                "method": ep["method"],
                "path": ep["path"],
                "interfaceId": "",
                "interfaceName": korean_iface_name(ep["handler"], name_dict),
                "businessCode": "", "channel": "", "owner": "", "note": "",
                "moduleName": module_of(ep["path"], ep["sourceFile"]),
                "serviceName": "",
                "handlerName": ep["handler"],
                "sourceFile": ep["sourceFile"],
                "sourceLine": ep["sourceLine"],
                "authRequired": False,
                "requestBodyType": "",
                "queryDtoType": "",
                "responseType": ep["response_model"] or base_type(ann_to_str(ep["func"].returns)),
                "requestFields": build_request_fields(ep["func"], ep["path"], c, name_dict),
                "responseFields": build_response_fields(ep, c, name_dict),
            }
            for ep in sorted(endpoints, key=lambda e: (module_of(e["path"], e["sourceFile"]), e["path"], e["method"]))
        ],
    }

    Path(args.out).write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    counts = Counter(module_of(ep["path"], ep["sourceFile"]) for ep in endpoints)
    print(json.dumps({"out": str(Path(args.out).resolve()), "endpointCount": len(doc["endpoints"]),
                      "modelsFound": len(c.models), "modules": dict(counts.most_common())},
                     ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
