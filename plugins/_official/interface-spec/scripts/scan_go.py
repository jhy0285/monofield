"""Go (gin / echo / chi) collector for the Open Docs interface-spec pipeline.

Regex + brace tracking (Go has no stdlib AST binding for Python): parses
route registrations, router groups, struct definitions with json/binding
tags, and handler bodies to emit an interface-spec.json document
(schema v1) that `od docs render-interface-spec` accepts directly.

Handles:
  - gin  `r.GET("/path", handler)` (POST/PUT/PATCH/DELETE/...)
  - echo `e.GET("/path", handler)`
  - chi  `r.Get("/path", handler)`
  - group prefixes: `g := r.Group("/api")` chains (file-scoped variable
    tracking) and chi `r.Route("/prefix", func(r chi.Router) {...})`
    blocks (brace tracking)
  - struct expansion: json tag -> nameEn; binding:"required" /
    validate:"required" -> Y; `json:",omitempty"` or pointer type *T -> N;
    otherwise Y. Nested structs and []T elements recurse to depth 6.
  - request body: `c.ShouldBindJSON(&x)` / `c.BindJSON(&x)` / echo
    `c.Bind(&x)` / `json.NewDecoder(r.Body).Decode(&x)` — x's type is
    resolved from `var x T` / `x := T{...}` in the same handler
  - `c.Param("id")` (+ chi.URLParam) -> path param (required Y),
    `c.Query("x")` / `c.DefaultQuery` / echo `c.QueryParam` -> query (N)
  - response: `c.JSON(code, x)` — struct type of x resolved within the
    handler (2xx statuses preferred, gin.H/echo.Map skipped); empty when
    unresolvable

Static limits: routes registered through loops/variables, cross-package
type aliases, interface-typed responses, and anonymous struct fields are
not resolved (anonymous structs render as Object).

Usage mirrors scan_fastapi.py:
  python scan_go.py --codebase-path <path> [--inventory-only]
     [--modules a,b] [--name-dict <file.json|.csv>] [--out interface-spec.json]
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

try:
    from tools.excel_generator.rules.naming import koreanize_identifier, load_name_dict
except Exception:  # pragma: no cover - dictionary is optional
    def load_name_dict() -> dict[str, str]:
        return {}

    def koreanize_identifier(text: str) -> str:
        return text


_HANGUL = re.compile(r"[가-힣]")
AUDIT = {
    "created_at", "updated_at", "created_by", "updated_by", "deleted_at",
    "createdat", "updatedat", "crtr_id", "creat_dttm", "updatr_id", "updat_dttm",
}

EXCLUDED_DIRS = {"vendor", "testdata", "node_modules", ".git"}

GO_TYPE_MAP = {
    "string": "String", "bool": "Boolean",
    "int": "Integer", "int8": "Integer", "int16": "Integer", "int32": "Integer",
    "uint": "Integer", "uint8": "Integer", "uint16": "Integer", "uint32": "Integer",
    "rune": "Integer", "byte": "Integer",
    "int64": "Long", "uint64": "Long",
    "float32": "Number", "float64": "Number",
    "time.Time": "DateTime", "time.Duration": "Long",
    "interface{}": "Object", "any": "Object",
    "json.RawMessage": "Object",
}

# route method sets: gin/echo use upper-case, chi uses Title-case
GIN_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}
CHI_METHODS = {"Get", "Post", "Put", "Patch", "Delete", "Head", "Options"}

FRAMEWORK_IMPORTS = (
    ("gin", "github.com/gin-gonic/gin"),
    ("echo", "github.com/labstack/echo"),
    ("chi", "github.com/go-chi/chi"),
)

ROUTE_RE = re.compile(
    r"\b(\w+)\.(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|Get|Post|Put|Patch|Delete|Head|Options)"
    r"\(\s*\"([^\"]*)\"\s*,\s*(.+)\)"
)
GROUP_RE = re.compile(r"\b(\w+)\s*:?=\s*(\w+)\.Group\(\s*\"([^\"]*)\"")
CHI_ROUTE_BLOCK_RE = re.compile(
    r"\b(\w+)\.Route\(\s*\"([^\"]*)\"\s*,\s*func\(\s*(\w+)\s+chi\.Router\s*\)"
)
STRUCT_RE = re.compile(r"^type\s+(\w+)\s+struct\s*\{", re.M)
FUNC_RE = re.compile(
    r"^func\s*(?:\(\s*\w+\s+\*?(\w+)\s*\))?\s*(\w+)\s*\([^)]*\)[^{\n]*\{", re.M
)
TAG_RE = re.compile(r"`([^`]*)`")
JSON_TAG_RE = re.compile(r"json:\"([^\"]*)\"")
REQUIRED_TAG_RE = re.compile(r"(?:binding|validate):\"[^\"]*\brequired\b[^\"]*\"")
BIND_RE = re.compile(
    r"(?:ShouldBindJSON|ShouldBindBodyWith|BindJSON|ShouldBind|Bind)\(\s*&(\w+)\s*[,)]"
)
DECODE_RE = re.compile(r"json\.NewDecoder\([^)]*\)\s*\.\s*Decode\(\s*&(\w+)\s*\)")
PARAM_RE = re.compile(r"\b\w+\.Param\(\s*\"([^\"]+)\"\s*\)")
CHI_URLPARAM_RE = re.compile(r"\bchi\.URLParam\(\s*\w+\s*,\s*\"([^\"]+)\"\s*\)")
QUERY_RE = re.compile(r"\b\w+\.(?:Query|QueryParam)\(\s*\"([^\"]+)\"\s*\)")
DEFAULT_QUERY_RE = re.compile(r"\b\w+\.DefaultQuery\(\s*\"([^\"]+)\"")
JSON_RESP_RE = re.compile(r"\b\w+\.JSON\(\s*([^,]+),\s*(.+?)\)\s*$", re.M)
ENCODE_RESP_RE = re.compile(r"json\.NewEncoder\([^)]*\)\s*\.\s*Encode\(\s*&?([\w{]+)")

OK_STATUSES = {"200", "201", "202", "http.StatusOK", "http.StatusCreated", "http.StatusAccepted"}


def strip_comments(text: str) -> str:
    """Remove // and /* */ comments, preserving string and backtick literals."""
    out: list[str] = []
    i, n = 0, len(text)
    mode = ""  # "", '"', "`", "line", "block"
    while i < n:
        ch = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if mode == "":
            if ch == "/" and nxt == "/":
                mode = "line"
                i += 2
                continue
            if ch == "/" and nxt == "*":
                mode = "block"
                i += 2
                continue
            if ch in ('"', "`"):
                mode = ch
            out.append(ch)
        elif mode == "line":
            if ch == "\n":
                mode = ""
                out.append(ch)
        elif mode == "block":
            if ch == "*" and nxt == "/":
                mode = ""
                i += 2
                continue
            if ch == "\n":
                out.append(ch)  # keep line numbers stable
        elif mode == '"':
            out.append(ch)
            if ch == "\\":
                out.append(nxt)
                i += 2
                continue
            if ch == '"':
                mode = ""
        elif mode == "`":
            out.append(ch)
            if ch == "`":
                mode = ""
        i += 1
    return "".join(out)


def find_block(text: str, open_idx: int) -> int:
    """Index just past the matching '}' for the '{' at open_idx."""
    depth = 0
    for i in range(open_idx, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return i + 1
    return len(text)


class StructField:
    __slots__ = ("name", "json_name", "go_type", "required", "embedded")

    def __init__(self, name: str, json_name: str, go_type: str,
                 required: bool, embedded: bool = False) -> None:
        self.name = name
        self.json_name = json_name
        self.go_type = go_type
        self.required = required
        self.embedded = embedded


class Collected:
    def __init__(self) -> None:
        self.structs: dict[str, list[StructField]] = {}
        self.func_bodies: dict[str, str] = {}   # "Name" and "Recv.Name" -> body
        self.endpoints: list[dict] = []
        self.imports: set[str] = set()


def parse_struct_body(body: str, fields: list[StructField]) -> None:
    for raw in body.splitlines():
        line = raw.strip()
        if not line or line in ("{", "}"):
            continue
        tag_m = TAG_RE.search(line)
        tag = tag_m.group(1) if tag_m else ""
        decl = TAG_RE.sub("", line).strip()
        if not decl or decl.startswith("}"):
            continue
        tokens = decl.split(None, 1)
        if len(tokens) == 1:
            # embedded type, e.g. `BaseModel` or `*BaseModel`
            t = tokens[0].lstrip("*")
            name = t.split(".")[-1]
            if name and name[0].isupper():
                fields.append(StructField(name, "", t, True, embedded=True))
            continue
        names_part, type_part = tokens[0], tokens[1].strip()
        if not names_part[0].isupper():
            continue  # unexported field -> not part of the JSON interface
        json_name = ""
        omitempty = False
        skip = False
        jm = JSON_TAG_RE.search(tag)
        if jm:
            parts = jm.group(1).split(",")
            if parts[0] == "-":
                skip = True
            json_name = parts[0]
            omitempty = "omitempty" in parts[1:]
        if skip:
            continue
        tag_required = bool(REQUIRED_TAG_RE.search(tag))
        pointer = type_part.startswith("*")
        required = True
        if tag_required:
            required = True
        elif omitempty or pointer:
            required = False
        for fname in (n.strip() for n in names_part.split(",")):
            if not fname or not fname[0].isupper():
                continue
            fields.append(StructField(fname, json_name or fname, type_part, required))


def collect_file(path: Path, root: Path, c: Collected) -> None:
    try:
        text = strip_comments(path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, OSError):
        return
    rel = str(path.relative_to(root)).replace("\\", "/")

    for imp in re.findall(r"\"([\w./-]+)\"", _import_section(text)):
        c.imports.add(imp)

    # structs
    for m in STRUCT_RE.finditer(text):
        name = m.group(1)
        open_idx = text.index("{", m.start())
        end = find_block(text, open_idx)
        fields: list[StructField] = []
        parse_struct_body(text[open_idx + 1:end - 1], fields)
        c.structs[name] = fields

    # function bodies
    for m in FUNC_RE.finditer(text):
        recv, name = m.group(1), m.group(2)
        open_idx = text.index("{", m.end() - 1)
        end = find_block(text, open_idx)
        body = text[open_idx + 1:end - 1]
        c.func_bodies.setdefault(name, body)
        if recv:
            c.func_bodies[f"{recv}.{name}"] = body

    # routes (line-oriented with group / chi.Route scope tracking)
    group_prefix: dict[str, str] = {}
    scope_stack: list[dict] = []  # {"var":..., "prefix":..., "depth":...}
    depth = 0
    for lineno, line in enumerate(text.splitlines(), start=1):
        gm = GROUP_RE.search(line)
        if gm:
            child, parent, seg = gm.group(1), gm.group(2), gm.group(3)
            parent_prefix = group_prefix.get(parent)
            if parent_prefix is None:
                parent_prefix = _scope_prefix(parent, scope_stack) or ""
            group_prefix[child] = parent_prefix + seg

        cm = CHI_ROUTE_BLOCK_RE.search(line)
        if cm:
            outer, seg, inner = cm.group(1), cm.group(2), cm.group(3)
            outer_prefix = _scope_prefix(outer, scope_stack) or group_prefix.get(outer, "")
            scope_stack.append({"var": inner, "prefix": outer_prefix + seg, "depth": depth})

        rm = ROUTE_RE.search(line)
        if rm and not (cm and rm.start() >= cm.start()):
            var, method, seg, rest = rm.group(1), rm.group(2), rm.group(3), rm.group(4)
            prefix = _scope_prefix(var, scope_stack)
            if prefix is None:
                prefix = group_prefix.get(var, "")
            handler = _handler_expr(rest)
            if handler:
                full = normalize_path(prefix + seg)
                c.endpoints.append({
                    "method": method.upper(),
                    "path": full,
                    "handler": handler,
                    "handlerShort": handler.split(".")[-1],
                    "sourceFile": rel,
                    "sourceLine": lineno,
                })

        depth += line.count("{") - line.count("}")
        while scope_stack and depth <= scope_stack[-1]["depth"]:
            scope_stack.pop()


def _scope_prefix(var: str, scope_stack: list[dict]) -> str | None:
    for scope in reversed(scope_stack):
        if scope["var"] == var:
            return scope["prefix"]
    return None


def _import_section(text: str) -> str:
    out = []
    for m in re.finditer(r"^import\s*\(([^)]*)\)", text, re.M | re.S):
        out.append(m.group(1))
    for m in re.finditer(r"^import\s+(\"[^\"]+\")", text, re.M):
        out.append(m.group(1))
    return "\n".join(out)


def _handler_expr(rest: str) -> str:
    """Last argument of the route call: `mw(), h.Create)` -> "h.Create"."""
    rest = rest.strip()
    while rest.endswith(")"):
        rest = rest[:-1].rstrip()
    last = rest.split(",")[-1].strip()
    m = re.match(r"^[\w.]+$", last)
    return last if m else ""


def normalize_path(path: str) -> str:
    """gin/echo `:id` and `*rest` -> `{id}` / `{rest}`; chi keeps braces."""
    path = re.sub(r":(\w+)", r"{\1}", path)
    path = re.sub(r"\*(\w+)", r"{\1}", path)
    if not path.startswith("/"):
        path = "/" + path
    return re.sub(r"//+", "/", path)


# ---------------------------------------------------------------------------
# Struct expansion -> interface-spec fields
# ---------------------------------------------------------------------------

def leaf_struct(go_type: str) -> str:
    """Strip *, [] and package qualifiers to look up a local struct name."""
    t = go_type.strip().lstrip("*")
    while t.startswith("[]"):
        t = t[2:].lstrip("*")
    if t.startswith("map["):
        return ""
    return t.split(".")[-1]


def map_go_type(go_type: str, c: Collected) -> str:
    t = go_type.strip().lstrip("*")
    if t.startswith("[]"):
        inner = map_go_type(t[2:], c)
        return f"List<{inner}>"
    if t.startswith("map["):
        return "Object"
    if t in GO_TYPE_MAP:
        return GO_TYPE_MAP[t]
    short = t.split(".")[-1]
    if short in GO_TYPE_MAP:
        return GO_TYPE_MAP[short]
    if t == "[]byte":
        return "String"
    if short in c.structs:
        return short
    if t.startswith("struct"):
        return "Object"
    return short or "Object"


def expand_struct(name: str, c: Collected, name_dict: dict, seen: frozenset,
                  depth: int, parent_path: str | None, note: str = "") -> list[dict]:
    """Recursively expand a struct into flat interface-spec fields."""
    fields = c.structs.get(name)
    if fields is None or name in seen or depth > 6:
        return []
    seen = seen | {name}
    out: list[dict] = []
    for f in fields:
        if f.embedded:
            embedded_name = leaf_struct(f.go_type)
            if embedded_name in c.structs and embedded_name not in seen:
                # Go JSON flattens embedded structs into the parent object.
                out.extend(expand_struct(embedded_name, c, name_dict, seen, depth, parent_path, note))
            continue
        json_name = f.json_name
        if not json_name or json_name.lower() in AUDIT or json_name.startswith("_"):
            continue
        path = f"{parent_path}.{json_name}" if parent_path else json_name
        data_type = map_go_type(f.go_type, c)
        out.append({
            "nameEn": json_name,
            "nameKo": _ko(json_name, name_dict),
            "dataType": data_type,
            "required": "Y" if f.required else "N",
            "note": note,
            "path": path,
            **({"parentPath": parent_path} if parent_path else {}),
            "depth": depth,
        })
        nested = leaf_struct(f.go_type)
        if nested and nested != name and nested in c.structs:
            out.extend(expand_struct(nested, c, name_dict, seen, depth + 1, path, note))
    return out


def _ko(name_en: str, name_dict: dict) -> str:
    if name_en in name_dict:
        return name_dict[name_en]
    k = koreanize_identifier(name_en)
    return k if _HANGUL.search(k or "") else ""


# ---------------------------------------------------------------------------
# Handler body analysis
# ---------------------------------------------------------------------------

def var_type_in(body: str, var: str) -> str:
    m = re.search(rf"\bvar\s+{re.escape(var)}\s+([\w.\[\]*]+)", body)
    if m:
        return m.group(1)
    m = re.search(rf"\b{re.escape(var)}\s*:=\s*&?([\w.]+)\{{", body)
    if m:
        return m.group(1)
    m = re.search(rf"\b{re.escape(var)}\s*:=\s*new\(\s*([\w.]+)\s*\)", body)
    if m:
        return m.group(1)
    m = re.search(rf"\b{re.escape(var)}\s*:=\s*(\[\][\w.]+)\{{", body)
    if m:
        return m.group(1)
    return ""


def request_body_type(body: str) -> str:
    for rx in (BIND_RE, DECODE_RE):
        m = rx.search(body)
        if m:
            t = var_type_in(body, m.group(1))
            if t:
                return t
    return ""


def response_type_of(body: str, c: Collected) -> str:
    candidates: list[tuple[bool, str]] = []
    for m in JSON_RESP_RE.finditer(body):
        status = m.group(1).strip()
        expr = m.group(2).strip().rstrip(")").strip()
        t = _expr_type(expr, body)
        if not t:
            continue
        if leaf_struct(t) in ("H", "Map") or t.startswith("map["):
            continue
        candidates.append((status in OK_STATUSES, t))
    for m in ENCODE_RESP_RE.finditer(body):
        expr = m.group(1).strip()
        t = _expr_type(expr, body)
        if t:
            candidates.append((True, t))
    for ok, t in candidates:
        if ok and leaf_struct(t) in c.structs:
            return t
    for _, t in candidates:
        if leaf_struct(t) in c.structs:
            return t
    return ""


def _expr_type(expr: str, body: str) -> str:
    expr = expr.strip().lstrip("&")
    m = re.match(r"^(\[\][\w.]+|[\w.]+)\{", expr)  # composite literal X{...} / []X{...}
    if m:
        return m.group(1)
    if re.match(r"^\w+$", expr):
        return var_type_in(body, expr)
    return ""


def build_request_fields(ep: dict, body: str, c: Collected, name_dict: dict) -> tuple[list[dict], str]:
    fields: list[dict] = []
    seen_names: set[str] = set()

    path_params = re.findall(r"\{([^}]+)\}", ep["path"])
    for p in PARAM_RE.findall(body) + CHI_URLPARAM_RE.findall(body):
        if p not in path_params:
            path_params.append(p)
    for p in path_params:
        if p in seen_names:
            continue
        seen_names.add(p)
        fields.append({"nameEn": p, "nameKo": _ko(p, name_dict), "dataType": "String",
                       "required": "Y", "note": "path", "path": p, "depth": 0})

    for q in QUERY_RE.findall(body) + DEFAULT_QUERY_RE.findall(body):
        if q in seen_names:
            continue
        seen_names.add(q)
        fields.append({"nameEn": q, "nameKo": _ko(q, name_dict), "dataType": "String",
                       "required": "N", "note": "query", "path": q, "depth": 0})

    body_type = request_body_type(body)
    struct_name = leaf_struct(body_type) if body_type else ""
    if struct_name in c.structs:
        fields.extend(expand_struct(struct_name, c, name_dict, frozenset(), 0, None, "body"))
    return fields, struct_name


def build_response_fields(body: str, c: Collected, name_dict: dict) -> tuple[list[dict], str]:
    t = response_type_of(body, c)
    if not t:
        return [], ""
    struct_name = leaf_struct(t)
    if struct_name not in c.structs:
        return [], ""
    resp_type = f"List<{struct_name}>" if t.lstrip("*&").startswith("[]") else struct_name
    return expand_struct(struct_name, c, name_dict, frozenset(), 0, None), resp_type


def module_of(path: str, source_file: str) -> str:
    parts = [p for p in path.strip("/").split("/") if p and not p.startswith("{")]
    # skip generic api/version prefixes (/api/v1/orders -> "orders")
    while parts and (parts[0].lower() == "api" or re.fullmatch(r"v\d+", parts[0].lower())):
        parts.pop(0)
    return parts[0] if parts else Path(source_file).stem


def detect_framework(c: Collected) -> str:
    for name, needle in FRAMEWORK_IMPORTS:
        if any(needle in imp for imp in c.imports):
            return name
    return "gin"


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
    for go in root.rglob("*.go"):
        if any(part in EXCLUDED_DIRS for part in go.parts):
            continue
        if go.name.endswith("_test.go"):
            continue
        collect_file(go, root, c)

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

    out_endpoints = []
    for ep in sorted(endpoints, key=lambda e: (module_of(e["path"], e["sourceFile"]), e["path"], e["method"])):
        body = c.func_bodies.get(ep["handler"], "") or c.func_bodies.get(ep["handlerShort"], "")
        req_fields, body_type = build_request_fields(ep, body, c, name_dict)
        resp_fields, resp_type = build_response_fields(body, c, name_dict)
        out_endpoints.append({
            "method": ep["method"],
            "path": ep["path"],
            "interfaceId": "",
            "interfaceName": korean_iface_name(ep["handlerShort"], name_dict),
            "businessCode": "", "channel": "", "owner": "", "note": "",
            "moduleName": module_of(ep["path"], ep["sourceFile"]),
            "serviceName": "",
            "handlerName": ep["handler"],
            "sourceFile": ep["sourceFile"],
            "sourceLine": ep["sourceLine"],
            "authRequired": False,
            "requestBodyType": body_type,
            "queryDtoType": "",
            "responseType": resp_type,
            "requestFields": req_fields,
            "responseFields": resp_fields,
        })

    doc = {
        "schemaVersion": 1,
        "kind": "interface-spec",
        "cover": {"brand": "", "docName": "", "version": "", "department": ""},
        "source": {
            "codebaseName": args.codebase_name or root.name,
            "codebasePath": str(root),
            "language": "go",
            "framework": detect_framework(c),
            "collector": "static-go",
        },
        "endpoints": out_endpoints,
    }

    Path(args.out).write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    counts = Counter(module_of(ep["path"], ep["sourceFile"]) for ep in endpoints)
    print(json.dumps({"out": str(Path(args.out).resolve()), "endpointCount": len(doc["endpoints"]),
                      "structsFound": len(c.structs), "modules": dict(counts.most_common())},
                     ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
