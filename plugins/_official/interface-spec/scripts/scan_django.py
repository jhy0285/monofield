"""Django/DRF collector for the Open Docs interface-spec pipeline.

AST-based (not regex): parses urls.py route tables, DRF routers/ViewSets,
@api_view function views, DRF serializers, and Django models to emit an
interface-spec.json document (schema v1) that
`od docs render-interface-spec` accepts directly.

Handles:
  - urls.py `path("x/", view)` / `re_path(r"^x/$", view)` entries and
    `include("app.urls")` prefix composition (root urlconf = any urls.py
    that no other urls.py includes)
  - DRF `router.register("prefix", ViewSet)` expanded to the standard five
    actions (list GET /prefix/, create POST /prefix/, retrieve GET
    /prefix/{pk}/, update PUT, destroy DELETE) — only the actions the
    ViewSet actually provides (explicitly defined methods, or the
    ModelViewSet / ReadOnlyModelViewSet defaults)
  - `@api_view(["GET", "POST"])` function views (one endpoint per method)
  - serializers.Serializer / ModelSerializer field expansion, including
    nested serializers (many=True) recursively up to depth 6
  - ModelSerializer Meta.model / Meta.fields resolution against models.py
  - required rule: required=False / allow_null=True / default= -> N;
    read_only=True fields appear in responses only, write_only=True in
    requests only
  - ViewSet serializer_class wiring: create/update take the serializer's
    writable fields as request body; list/retrieve return its readable
    fields as the response

Static limits: get_serializer_class() overrides, dynamically built
urlpatterns, and SerializerMethodField return types are not resolved.

Usage mirrors scan_fastapi.py:
  python scan_django.py --codebase-path <path> [--inventory-only]
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


_HANGUL = re.compile(r"[가-힣]")
AUDIT = {
    "created_at", "updated_at", "created_by", "updated_by", "deleted_at",
    "createdat", "updatedat", "crtr_id", "creat_dttm", "updatr_id", "updat_dttm",
}

EXCLUDED_DIRS = {
    ".venv", "venv", "site-packages", "__pycache__", "migrations",
    "tests", "test", "node_modules", ".git",
}

# DRF serializer field class -> workbook data type.
SERIALIZER_FIELD_TYPES = {
    "CharField": "String", "EmailField": "String", "SlugField": "String",
    "URLField": "String", "UUIDField": "String", "ChoiceField": "String",
    "FileField": "String", "ImageField": "String", "FilePathField": "String",
    "IPAddressField": "String", "RegexField": "String", "DurationField": "String",
    "StringRelatedField": "String", "SlugRelatedField": "String",
    "HyperlinkedIdentityField": "String", "HyperlinkedRelatedField": "String",
    "ReadOnlyField": "String", "SerializerMethodField": "String",
    "IntegerField": "Integer", "SmallIntegerField": "Integer",
    "PrimaryKeyRelatedField": "Integer",
    "BigIntegerField": "Long",
    "FloatField": "Number", "DecimalField": "Number",
    "BooleanField": "Boolean", "NullBooleanField": "Boolean",
    "DateField": "Date", "DateTimeField": "DateTime", "TimeField": "Time",
    "JSONField": "Object", "DictField": "Object", "HStoreField": "Object",
    "ListField": "Array", "MultipleChoiceField": "Array",
}

# Django model field class -> workbook data type.
MODEL_FIELD_TYPES = {
    "CharField": "String", "TextField": "String", "EmailField": "String",
    "SlugField": "String", "URLField": "String", "UUIDField": "String",
    "FileField": "String", "ImageField": "String", "FilePathField": "String",
    "GenericIPAddressField": "String",
    "IntegerField": "Integer", "PositiveIntegerField": "Integer",
    "PositiveSmallIntegerField": "Integer", "SmallIntegerField": "Integer",
    "AutoField": "Integer", "PositiveBigIntegerField": "Long",
    "BigAutoField": "Long", "BigIntegerField": "Long",
    "FloatField": "Number", "DecimalField": "Number",
    "BooleanField": "Boolean",
    "DateField": "Date", "DateTimeField": "DateTime", "TimeField": "Time",
    "DurationField": "String", "JSONField": "Object",
    "ForeignKey": "Integer", "OneToOneField": "Integer",
    "ManyToManyField": "Array",
}

VIEWSET_ACTIONS = (
    ("list", "GET", False),
    ("create", "POST", False),
    ("retrieve", "GET", True),
    ("update", "PUT", True),
    ("destroy", "DELETE", True),
)
MODEL_VIEWSET_DEFAULTS = {"list", "create", "retrieve", "update", "destroy"}
READONLY_VIEWSET_DEFAULTS = {"list", "retrieve"}


def ann_to_str(node: ast.expr | None) -> str:
    if node is None:
        return ""
    try:
        return ast.unparse(node)
    except Exception:
        return ""


def _literal_str(node: ast.expr) -> str:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return ""


def _is_true(node: ast.expr | None) -> bool:
    return isinstance(node, ast.Constant) and node.value is True


def _is_false(node: ast.expr | None) -> bool:
    return isinstance(node, ast.Constant) and node.value is False


def _last_name(expr: ast.expr) -> str:
    """`views.list_users` -> "list_users", `OrderViewSet` -> "OrderViewSet"."""
    return ann_to_str(expr).split(".")[-1]


def join_url(prefix: str, segment: str) -> str:
    a, b = prefix.strip(), segment.strip()
    if not a:
        out = b
    elif not b:
        out = a
    else:
        out = a.rstrip("/") + "/" + b.lstrip("/")
    if not out.startswith("/"):
        out = "/" + out
    return out


def convert_path_route(route: str) -> str:
    """Django path converter syntax -> spec braces: users/<int:pk>/ -> users/{pk}/."""
    return re.sub(r"<(?:[\w.]+:)?(\w+)>", r"{\1}", route)


def convert_regex_route(pattern: str) -> str:
    """Best-effort re_path regex -> spec path: ^(?P<pk>\\d+)/roles/$ -> {pk}/roles/."""
    p = pattern.lstrip("^").rstrip("$")
    p = re.sub(r"\(\?P<(\w+)>[^)]*\)", r"{\1}", p)
    p = p.replace("\\.", ".").replace("\\-", "-").replace("\\/", "/")
    p = re.sub(r"[\\^$?+*()\[\]|]", "", p)
    return p


def path_param_type(name: str) -> str:
    n = name.lower()
    if n in ("pk", "id") or n.endswith("_id") or n.endswith("_pk"):
        return "Integer"
    return "String"


class SerializerField:
    __slots__ = ("name", "data_type", "optional", "read_only", "write_only",
                 "nested", "many")

    def __init__(self, name: str, data_type: str, optional: bool,
                 read_only: bool, write_only: bool,
                 nested: str = "", many: bool = False) -> None:
        self.name = name
        self.data_type = data_type
        self.optional = optional
        self.read_only = read_only
        self.write_only = write_only
        self.nested = nested        # nested serializer class name, if any
        self.many = many


class Collected:
    def __init__(self) -> None:
        # short name -> parsed definition (app kept for disambiguation)
        self.serializers: dict[str, dict] = {}
        self.models: dict[str, dict] = {}
        self.viewsets: dict[str, dict] = {}
        self.api_views: dict[str, dict] = {}
        # dotted urls module ("orders.urls") -> parsed url table
        self.urlconfs: dict[str, dict] = {}
        self.endpoints: list[dict] = []


# ---------------------------------------------------------------------------
# Pass 1: definitions (serializers / models / viewsets / @api_view functions)
# ---------------------------------------------------------------------------

def parse_serializer_class(node: ast.ClassDef) -> dict:
    fields: list[SerializerField] = []
    meta_model = ""
    meta_fields: list[str] | str = []
    meta_read_only: list[str] = []

    for stmt in node.body:
        if isinstance(stmt, ast.ClassDef) and stmt.name == "Meta":
            for m in stmt.body:
                if not isinstance(m, ast.Assign) or not isinstance(m.targets[0], ast.Name):
                    continue
                key = m.targets[0].id
                if key == "model":
                    meta_model = _last_name(m.value)
                elif key == "fields":
                    if isinstance(m.value, ast.Constant) and m.value.value == "__all__":
                        meta_fields = "__all__"
                    elif isinstance(m.value, (ast.List, ast.Tuple)):
                        meta_fields = [_literal_str(e) for e in m.value.elts if _literal_str(e)]
                elif key == "read_only_fields" and isinstance(m.value, (ast.List, ast.Tuple)):
                    meta_read_only = [_literal_str(e) for e in m.value.elts if _literal_str(e)]
            continue
        if not isinstance(stmt, ast.Assign) or len(stmt.targets) != 1:
            continue
        target = stmt.targets[0]
        if not isinstance(target, ast.Name) or not isinstance(stmt.value, ast.Call):
            continue
        fields.append(parse_serializer_field(target.id, stmt.value))

    return {
        "name": node.name,
        "bases": [_last_name(b) for b in node.bases],
        "fields": [f for f in fields if f is not None],
        "meta_model": meta_model,
        "meta_fields": meta_fields,
        "meta_read_only": meta_read_only,
    }


def parse_serializer_field(name: str, call: ast.Call) -> SerializerField:
    func_name = _last_name(call.func)
    kwargs = {kw.arg: kw.value for kw in call.keywords if kw.arg}

    optional = (
        _is_false(kwargs.get("required"))
        or _is_true(kwargs.get("allow_null"))
        or "default" in kwargs
    )
    read_only = _is_true(kwargs.get("read_only")) or func_name in (
        "SerializerMethodField", "ReadOnlyField", "HyperlinkedIdentityField",
    )
    write_only = _is_true(kwargs.get("write_only"))
    many = _is_true(kwargs.get("many"))

    nested = ""
    if func_name in SERIALIZER_FIELD_TYPES:
        data_type = SERIALIZER_FIELD_TYPES[func_name]
        child = kwargs.get("child")
        if func_name == "ListField" and isinstance(child, ast.Call):
            child_name = _last_name(child.func)
            if child_name.endswith("Serializer"):
                nested, many = child_name, True
                data_type = f"List<{child_name}>"
    elif func_name.endswith("Serializer"):
        nested = func_name
        data_type = f"List<{func_name}>" if many else func_name
    else:
        data_type = "String"

    return SerializerField(name, data_type, optional, read_only, write_only, nested, many)


def parse_model_class(node: ast.ClassDef) -> dict:
    fields: list[dict] = []
    for stmt in node.body:
        if not isinstance(stmt, ast.Assign) or len(stmt.targets) != 1:
            continue
        target = stmt.targets[0]
        if not isinstance(target, ast.Name) or not isinstance(stmt.value, ast.Call):
            continue
        func_name = _last_name(stmt.value.func)
        if func_name not in MODEL_FIELD_TYPES:
            continue
        kwargs = {kw.arg: kw.value for kw in stmt.value.keywords if kw.arg}
        auto = _is_true(kwargs.get("auto_now")) or _is_true(kwargs.get("auto_now_add")) \
            or func_name in ("AutoField", "BigAutoField")
        optional = (
            _is_true(kwargs.get("null")) or _is_true(kwargs.get("blank"))
            or "default" in kwargs or auto
        )
        fields.append({
            "name": target.id,
            "dataType": MODEL_FIELD_TYPES[func_name],
            "optional": optional,
            "auto": auto,
        })
    return {"name": node.name, "fields": fields}


def parse_viewset_class(node: ast.ClassDef) -> dict:
    bases = [_last_name(b) for b in node.bases]
    explicit = {
        s.name for s in node.body
        if isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef))
        and s.name in MODEL_VIEWSET_DEFAULTS
    }
    if any(b == "ModelViewSet" for b in bases):
        actions = MODEL_VIEWSET_DEFAULTS | explicit
    elif any(b == "ReadOnlyModelViewSet" for b in bases):
        actions = READONLY_VIEWSET_DEFAULTS | explicit
    else:  # plain ViewSet / GenericViewSet: only explicitly defined actions
        actions = explicit
    serializer_class = ""
    for stmt in node.body:
        if isinstance(stmt, ast.Assign) and isinstance(stmt.targets[0], ast.Name) \
                and stmt.targets[0].id == "serializer_class":
            serializer_class = _last_name(stmt.value)
    return {"name": node.name, "actions": actions, "serializer": serializer_class}


def parse_api_view(node: ast.FunctionDef | ast.AsyncFunctionDef) -> dict | None:
    methods: list[str] | None = None
    for dec in node.decorator_list:
        if isinstance(dec, ast.Call) and _last_name(dec.func) == "api_view":
            methods = ["GET"]
            if dec.args and isinstance(dec.args[0], (ast.List, ast.Tuple)):
                methods = [
                    _literal_str(e).upper()
                    for e in dec.args[0].elts if _literal_str(e)
                ] or ["GET"]
    if methods is None:
        return None

    req_serializer = ""
    resp_serializer = ""
    resp_many = False
    query_params: list[str] = []
    for sub in ast.walk(node):
        if not isinstance(sub, ast.Call):
            continue
        fn = sub.func
        # XSerializer(data=...) -> request body; XSerializer(obj[, many=True]) -> response
        name = _last_name(fn)
        if name.endswith("Serializer"):
            if any(kw.arg == "data" for kw in sub.keywords):
                req_serializer = req_serializer or name
            else:
                if not resp_serializer:
                    resp_serializer = name
                    resp_many = any(
                        kw.arg == "many" and _is_true(kw.value) for kw in sub.keywords
                    )
        # request.query_params.get("x") / request.GET.get("x") -> query param
        if isinstance(fn, ast.Attribute) and fn.attr == "get" \
                and isinstance(fn.value, ast.Attribute) \
                and fn.value.attr in ("query_params", "GET") \
                and sub.args and _literal_str(sub.args[0]):
            query_params.append(_literal_str(sub.args[0]))

    return {
        "name": node.name,
        "methods": methods,
        "request_serializer": req_serializer,
        "response_serializer": resp_serializer,
        "response_many": resp_many,
        "query_params": query_params,
        "line": node.lineno,
    }


def collect_definitions(tree: ast.Module, rel: str, app: str, c: Collected) -> None:
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            bases = [_last_name(b) for b in node.bases]
            if any(b.endswith("Serializer") for b in bases):
                d = parse_serializer_class(node)
                d.update({"app": app, "file": rel, "line": node.lineno})
                c.serializers[node.name] = d
            elif any(b == "Model" for b in bases):
                d = parse_model_class(node)
                d.update({"app": app, "file": rel})
                c.models[node.name] = d
            elif any(b.endswith("ViewSet") for b in bases):
                d = parse_viewset_class(node)
                d.update({"app": app, "file": rel, "line": node.lineno})
                c.viewsets[node.name] = d
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            d = parse_api_view(node)
            if d is not None:
                d.update({"app": app, "file": rel})
                c.api_views[node.name] = d


# ---------------------------------------------------------------------------
# Pass 2: urls.py tables (path / re_path / include / router.register)
# ---------------------------------------------------------------------------

def parse_urlconf(tree: ast.Module, dotted: str, rel: str, c: Collected) -> None:
    routers: dict[str, list[tuple[str, str]]] = {}   # var -> [(prefix, viewset)]
    entries: list[dict] = []

    def handle_pattern_call(call: ast.Call) -> None:
        func_name = _last_name(call.func)
        if func_name not in ("path", "re_path", "url") or not call.args:
            return
        raw = _literal_str(call.args[0])
        route = convert_regex_route(raw) if func_name in ("re_path", "url") else convert_path_route(raw)
        if len(call.args) < 2:
            return
        target = call.args[1]
        if isinstance(target, ast.Call) and _last_name(target.func) == "include":
            inc = target.args[0] if target.args else None
            if isinstance(inc, ast.Tuple) and inc.elts:
                inc = inc.elts[0]
            if inc is None:
                return
            if isinstance(inc, ast.Constant) and isinstance(inc.value, str):
                entries.append({"kind": "include-module", "route": route, "module": inc.value})
            elif isinstance(inc, ast.Attribute) and inc.attr == "urls" \
                    and isinstance(inc.value, ast.Name) and inc.value.id in routers:
                entries.append({"kind": "include-router", "route": route, "router": inc.value.id})
        elif isinstance(target, (ast.Name, ast.Attribute)):
            entries.append({"kind": "view", "route": route, "view": _last_name(target)})
        # X.as_view() class-based views are out of scope for this collector.

    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call) \
                and _last_name(node.value.func) in ("DefaultRouter", "SimpleRouter"):
            for tgt in node.targets:
                if isinstance(tgt, ast.Name):
                    routers[tgt.id] = []
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) \
                and node.func.attr == "register" \
                and isinstance(node.func.value, ast.Name) \
                and node.func.value.id in routers and len(node.args) >= 2:
            prefix = _literal_str(node.args[0])
            viewset = _last_name(node.args[1])
            routers[node.func.value.id].append((prefix, viewset))
        elif isinstance(node, (ast.Assign, ast.AugAssign)):
            tgt = node.targets[0] if isinstance(node, ast.Assign) else node.target
            if isinstance(tgt, ast.Name) and tgt.id == "urlpatterns" \
                    and isinstance(node.value, (ast.List, ast.Tuple)):
                for elt in node.value.elts:
                    if isinstance(elt, ast.Call):
                        handle_pattern_call(elt)

    c.urlconfs[dotted] = {"entries": entries, "routers": routers, "file": rel,
                          "app": dotted.split(".")[0]}


def compose_endpoints(c: Collected) -> None:
    included = {
        e["module"]
        for conf in c.urlconfs.values()
        for e in conf["entries"] if e["kind"] == "include-module"
    }
    roots = [name for name in c.urlconfs if name not in included]

    def emit_view(prefix: str, route: str, view_name: str, app: str, conf: dict) -> None:
        fn = c.api_views.get(view_name)
        if fn is None:
            return  # not an @api_view function -> out of collector scope
        full = join_url(prefix, route)
        for method in fn["methods"]:
            c.endpoints.append({
                "method": method,
                "path": full,
                "handler": fn["name"],
                "sourceFile": fn["file"],
                "sourceLine": fn["line"],
                "app": app or fn["app"],
                "kind": "function",
                "view": fn,
            })

    def emit_router(prefix: str, route: str, registrations: list, app: str, conf: dict) -> None:
        base = join_url(prefix, route)
        for reg_prefix, viewset_name in registrations:
            vs = c.viewsets.get(viewset_name)
            if vs is None:
                continue
            resource = join_url(base, reg_prefix)
            for action, method, detail in VIEWSET_ACTIONS:
                if action not in vs["actions"]:
                    continue
                path_str = (resource.rstrip("/") + "/{pk}/") if detail else (resource.rstrip("/") + "/")
                c.endpoints.append({
                    "method": method,
                    "path": path_str,
                    "handler": f"{viewset_name}.{action}",
                    "sourceFile": vs["file"],
                    "sourceLine": vs["line"],
                    "app": app or vs["app"],
                    "kind": "viewset",
                    "viewset": vs,
                    "action": action,
                })

    def walk(module: str, prefix: str, app: str, seen: frozenset) -> None:
        conf = c.urlconfs.get(module)
        if conf is None or module in seen:
            return
        seen = seen | {module}
        for entry in conf["entries"]:
            if entry["kind"] == "include-module":
                target = entry["module"]
                target_app = target.split(".")[0]
                walk(target, join_url(prefix, entry["route"]), target_app, seen)
            elif entry["kind"] == "include-router":
                emit_router(prefix, entry["route"], conf["routers"][entry["router"]], app, conf)
            elif entry["kind"] == "view":
                emit_view(prefix, entry["route"], entry["view"], app, conf)

    for root in sorted(roots):
        walk(root, "", "", frozenset())


# ---------------------------------------------------------------------------
# Serializer expansion -> interface-spec fields
# ---------------------------------------------------------------------------

def _serializer_all_fields(name: str, c: Collected, seen_bases: frozenset = frozenset()) -> tuple[list[SerializerField], set[str]]:
    """Declared fields (base classes first) + Meta-resolved model fields.

    Returns (fields, response_only_names) where response_only covers
    Meta.read_only_fields and auto model fields (pk, auto_now...).
    """
    d = c.serializers.get(name)
    if d is None or name in seen_bases:
        return [], set()
    fields: list[SerializerField] = []
    response_only: set[str] = set()

    for base in d["bases"]:
        if base in c.serializers and base != name:
            bf, bro = _serializer_all_fields(base, c, seen_bases | {name})
            fields.extend(bf)
            response_only |= bro

    declared = {f.name: f for f in d["fields"]}
    fields = [f for f in fields if f.name not in declared]
    fields.extend(d["fields"])

    meta_fields = d["meta_fields"]
    model = c.models.get(d["meta_model"]) if d["meta_model"] else None
    if model is not None and meta_fields:
        model_fields = {mf["name"]: mf for mf in model["fields"]}
        wanted = [mf["name"] for mf in model["fields"]] if meta_fields == "__all__" else list(meta_fields)
        if meta_fields == "__all__" and "id" not in model_fields:
            wanted.insert(0, "id")
        for fname in wanted:
            if fname in declared:
                continue
            if fname == "id" and fname not in model_fields:  # implicit pk
                fields.append(SerializerField("id", "Integer", True, True, False))
                response_only.add("id")
                continue
            mf = model_fields.get(fname)
            if mf is None:
                continue
            read_only = mf["auto"] or fname in d["meta_read_only"]
            fields.append(SerializerField(fname, mf["dataType"], mf["optional"], read_only, False))
    for ro_name in d["meta_read_only"]:
        response_only.add(ro_name)

    return fields, response_only


def expand_serializer(name: str, mode: str, c: Collected, name_dict: dict,
                      seen: frozenset, depth: int, parent_path: str | None) -> list[dict]:
    """Recursively expand a serializer into flat interface-spec fields.

    mode: "request" drops read_only fields, "response" drops write_only.
    """
    if depth > 6 or name in seen:
        return []
    fields, response_only = _serializer_all_fields(name, c)
    if not fields:
        return []
    seen = seen | {name}
    out: list[dict] = []
    for f in fields:
        if f.name.startswith("_") or f.name.lower() in AUDIT:
            continue
        read_only = f.read_only or f.name in response_only
        if mode == "request" and read_only:
            continue
        if mode == "response" and f.write_only:
            continue
        path = f"{parent_path}.{f.name}" if parent_path else f.name
        out.append({
            "nameEn": f.name,
            "nameKo": _ko(f.name, name_dict),
            "dataType": f.data_type,
            "required": "N" if f.optional else "Y",
            "note": "",
            "path": path,
            **({"parentPath": parent_path} if parent_path else {}),
            "depth": depth,
        })
        if f.nested and f.nested != name:
            out.extend(expand_serializer(f.nested, mode, c, name_dict, seen, depth + 1, path))
    return out


def _ko(name_en: str, name_dict: dict) -> str:
    if name_en in name_dict:
        return name_dict[name_en]
    k = koreanize_identifier(name_en)
    return k if _HANGUL.search(k or "") else ""


def path_param_fields(path_str: str, name_dict: dict) -> list[dict]:
    return [
        {"nameEn": p, "nameKo": _ko(p, name_dict), "dataType": path_param_type(p),
         "required": "Y", "note": "path", "path": p, "depth": 0}
        for p in re.findall(r"\{([^}]+)\}", path_str)
    ]


def build_fields(ep: dict, c: Collected, name_dict: dict) -> tuple[list[dict], list[dict], str, str]:
    """Returns (request_fields, response_fields, requestBodyType, responseType)."""
    req = path_param_fields(ep["path"], name_dict)
    resp: list[dict] = []
    body_type = ""
    resp_type = ""

    if ep["kind"] == "viewset":
        serializer = ep["viewset"]["serializer"]
        action = ep["action"]
        if serializer:
            if action in ("create", "update"):
                req.extend(expand_serializer(serializer, "request", c, name_dict, frozenset(), 0, None))
                for f in req:
                    if not f["note"]:
                        f["note"] = "body"
                body_type = serializer
            if action != "destroy":
                resp = expand_serializer(serializer, "response", c, name_dict, frozenset(), 0, None)
                resp_type = f"List<{serializer}>" if action == "list" else serializer
    else:
        fn = ep["view"]
        for q in fn["query_params"]:
            if ep["method"] == "GET":
                req.append({"nameEn": q, "nameKo": _ko(q, name_dict), "dataType": "String",
                            "required": "N", "note": "query", "path": q, "depth": 0})
        if ep["method"] in ("POST", "PUT", "PATCH") and fn["request_serializer"]:
            body = expand_serializer(fn["request_serializer"], "request", c, name_dict, frozenset(), 0, None)
            for f in body:
                if not f["note"]:
                    f["note"] = "body"
            req.extend(body)
            body_type = fn["request_serializer"]
        resp_serializer = fn["response_serializer"] or fn["request_serializer"]
        if resp_serializer:
            resp = expand_serializer(resp_serializer, "response", c, name_dict, frozenset(), 0, None)
            resp_type = f"List<{resp_serializer}>" if fn["response_many"] and ep["method"] == "GET" else resp_serializer

    return req, resp, body_type, resp_type


def module_of(ep: dict) -> str:
    if ep.get("app"):
        return ep["app"]
    parts = [p for p in ep["path"].strip("/").split("/") if p and not p.startswith("{")]
    return parts[0] if parts else Path(ep["sourceFile"]).stem


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


def should_skip(py: Path) -> bool:
    if any(part in EXCLUDED_DIRS for part in py.parts):
        return True
    name = py.name
    return name == "tests.py" or name.startswith("test_")


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
    url_files: list[tuple[ast.Module, str]] = []
    for py in root.rglob("*.py"):
        if should_skip(py):
            continue
        try:
            tree = ast.parse(py.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):
            continue
        rel = str(py.relative_to(root)).replace("\\", "/")
        app = rel.split("/")[0] if "/" in rel else ""
        collect_definitions(tree, rel, app, c)
        if py.name == "urls.py":
            dotted = rel[:-3].replace("/", ".")
            parse_urlconf(tree, dotted, rel, c)

    compose_endpoints(c)

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
        endpoints = [ep for ep in endpoints if module_of(ep) in wanted]

    if args.inventory_only:
        counts = Counter(module_of(ep) for ep in endpoints)
        json.dump(
            {
                "endpointCount": len(endpoints),
                "modules": dict(counts.most_common()),
                "endpoints": [
                    {"method": ep["method"], "path": ep["path"],
                     "module": module_of(ep), "handler": ep["handler"],
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
    for ep in sorted(endpoints, key=lambda e: (module_of(e), e["path"], e["method"])):
        req, resp, body_type, resp_type = build_fields(ep, c, name_dict)
        out_endpoints.append({
            "method": ep["method"],
            "path": ep["path"],
            "interfaceId": "",
            "interfaceName": korean_iface_name(ep["handler"], name_dict),
            "businessCode": "", "channel": "", "owner": "", "note": "",
            "moduleName": module_of(ep),
            "serviceName": "",
            "handlerName": ep["handler"],
            "sourceFile": ep["sourceFile"],
            "sourceLine": ep["sourceLine"],
            "authRequired": False,
            "requestBodyType": body_type,
            "queryDtoType": "",
            "responseType": resp_type,
            "requestFields": req,
            "responseFields": resp,
        })

    doc = {
        "schemaVersion": 1,
        "kind": "interface-spec",
        "cover": {"brand": "", "docName": "", "version": "", "department": ""},
        "source": {
            "codebaseName": args.codebase_name or root.name,
            "codebasePath": str(root),
            "language": "python",
            "framework": "django",
            "collector": "static-django",
        },
        "endpoints": out_endpoints,
    }

    Path(args.out).write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    counts = Counter(module_of(ep) for ep in endpoints)
    print(json.dumps({"out": str(Path(args.out).resolve()), "endpointCount": len(doc["endpoints"]),
                      "serializersFound": len(c.serializers), "modelsFound": len(c.models),
                      "modules": dict(counts.most_common())},
                     ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
