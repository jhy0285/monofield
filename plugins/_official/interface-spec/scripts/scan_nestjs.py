"""NestJS collector for the MonoField interface-spec pipeline.

Static scanner over TypeScript sources — stdlib only. Python's ast cannot
parse TypeScript, so this uses regex + string-aware brace/paren tracking
instead. Emits an interface-spec.json document (schema v1) that
`monofield docs render-interface-spec` accepts directly.

Handles:
  - @Controller('prefix') classes + @Get/@Post/@Put/@Patch/@Delete('path')
    method decorators -> path composition (/globalPrefix/prefix/path)
  - app.setGlobalPrefix('api') picked up from main.ts (fallback: any file)
  - @Param('id') -> path param (required Y)
  - @Query('x') single param / @Query() dto -> query fields
  - @Body() dto: XDto -> body (wrapper row + recursive DTO expansion)
  - class-validator required rule: `?:` optional marker or @IsOptional -> N;
    validators without @IsOptional -> Y; no signal -> Y (TS fields are
    non-optional by default)
  - nested DTO recursion for class-typed fields and X[] / Array<X> element
    classes, max depth 6
  - responseType from the method return annotation (Promise<X> unwrapped);
    response fields are expanded only when the type is a discovered class

Usage mirrors scan_fastapi.py:
  python scan_nestjs.py --codebase-path <path> [--inventory-only]
     [--modules a,b] [--name-dict <file.json|.csv>] [--out interface-spec.json]
     [--codebase-name NAME]
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
from tools.excel_generator.synthetic_examples import add_static_examples, load_sample_context  # noqa: E402
from tools.excel_generator.dictionary_loader import load_dictionary_file  # noqa: E402

try:
    from tools.excel_generator.rules.naming import koreanize_identifier, load_name_dict
except Exception:  # pragma: no cover - dictionary is optional
    def load_name_dict() -> dict[str, str]:
        return {}

    def koreanize_identifier(text: str) -> str:
        return text


HTTP_DECORATORS = {"Get", "Post", "Put", "Patch", "Delete", "Head", "Options", "All"}
INPUT_DECORATORS = {"Param", "Query", "Body"}
EXCLUDED_DIRS = {"node_modules", "dist", "build", "out", "coverage", "test", "tests", "__tests__", ".git"}
EXCLUDED_SUFFIXES = (".spec.ts", ".test.ts", ".d.ts", ".e2e-spec.ts")
MAX_DEPTH = 6
_HANGUL = re.compile(r"[가-힣]")
AUDIT = {
    "created_at", "updated_at", "created_by", "updated_by", "deleted_at",
    "createdat", "updatedat", "crtr_id", "creat_dttm", "updatr_id", "updat_dttm",
}
PRIMITIVES = {
    "string", "number", "boolean", "any", "unknown", "object", "void",
    "null", "undefined", "Date", "bigint", "symbol", "never",
}


# ---------------------------------------------------------------------------
# Lightweight TS lexing helpers (comment stripping, brace matching)
# ---------------------------------------------------------------------------

def strip_comments(src: str) -> str:
    """Blank out // and /* */ comments, preserving newlines and offsets."""
    out: list[str] = []
    i, n = 0, len(src)
    string_ch: str | None = None
    while i < n:
        ch = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if string_ch:
            out.append(ch)
            if ch == "\\" and nxt:
                out.append(nxt)
                i += 2
                continue
            if ch == string_ch:
                string_ch = None
            i += 1
            continue
        if ch == "/" and nxt == "/":
            while i < n and src[i] != "\n":
                out.append(" ")
                i += 1
            continue
        if ch == "/" and nxt == "*":
            out.append("  ")
            i += 2
            while i < n and not (src[i] == "*" and i + 1 < n and src[i + 1] == "/"):
                out.append("\n" if src[i] == "\n" else " ")
                i += 1
            if i < n:
                out.append("  ")
                i += 2
            continue
        if ch in "'\"`":
            string_ch = ch
        out.append(ch)
        i += 1
    return "".join(out)


def skip_ws(text: str, i: int) -> int:
    n = len(text)
    while i < n and text[i] in " \t\r\n":
        i += 1
    return i


def find_matching(text: str, open_idx: int, open_ch: str = "{", close_ch: str = "}") -> int:
    """Index of the delimiter matching text[open_idx], string-aware. -1 if none."""
    depth = 0
    i, n = open_idx, len(text)
    string_ch: str | None = None
    while i < n:
        ch = text[i]
        if string_ch:
            if ch == "\\":
                i += 2
                continue
            if ch == string_ch:
                string_ch = None
        elif ch in "'\"`":
            string_ch = ch
        elif ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def _depth_scan(text: str):
    """Yield (index, char, at_top_level) skipping strings; tracks (), [], {}, <>."""
    dr = ds = dc = da = 0
    i, n = 0, len(text)
    string_ch: str | None = None
    while i < n:
        ch = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if string_ch:
            if ch == "\\":
                i += 2
                continue
            if ch == string_ch:
                string_ch = None
            i += 1
            continue
        if ch in "'\"`":
            string_ch = ch
            i += 1
            continue
        if ch == "=" and nxt == ">":  # arrow, not a comparison / initializer
            i += 2
            continue
        at_top = dr == ds == dc == da == 0
        yield i, ch, at_top
        if ch == "(":
            dr += 1
        elif ch == ")":
            dr = max(0, dr - 1)
        elif ch == "[":
            ds += 1
        elif ch == "]":
            ds = max(0, ds - 1)
        elif ch == "{":
            dc += 1
        elif ch == "}":
            dc = max(0, dc - 1)
        elif ch == "<":
            da += 1
        elif ch == ">":
            da = max(0, da - 1)
        i += 1


def split_top_level(text: str, sep: str = ",") -> list[str]:
    parts: list[str] = []
    last = 0
    for i, ch, at_top in _depth_scan(text):
        if at_top and ch == sep:
            parts.append(text[last:i])
            last = i + 1
    parts.append(text[last:])
    return parts


def find_top_level_char(text: str, target: str) -> int:
    for i, ch, at_top in _depth_scan(text):
        if at_top and ch == target:
            return i
    return -1


def read_until(text: str, start: int, stop_chars: str) -> tuple[str, int]:
    """Read from `start` until one of stop_chars at top level. -> (chunk, stop_index)."""
    for i, ch, at_top in _depth_scan(text[start:]):
        if at_top and ch in stop_chars:
            return text[start:start + i], start + i
    return text[start:], len(text)


# ---------------------------------------------------------------------------
# TS class member parsing
# ---------------------------------------------------------------------------

MODIFIERS = {
    "public", "private", "protected", "readonly", "static", "abstract",
    "async", "declare", "override", "get", "set",
}
IDENT_RE = re.compile(r"[A-Za-z_$][\w$]*")


def parse_class_members(body: str) -> list[dict]:
    """Walk the top level of a class body, collecting fields and methods.

    Returns dicts:
      {"kind": "field",  "name", "optional", "type", "decorators", "offset"}
      {"kind": "method", "name", "params", "returnType", "decorators", "offset"}
    where decorators is a list of (name, arg_text) tuples.
    """
    members: list[dict] = []
    pending: list[tuple[str, str]] = []
    i, n = 0, len(body)
    while i < n:
        ch = body[i]
        if ch in " \t\r\n;,":
            i += 1
            continue
        if ch == "@":
            dm = re.match(r"@([A-Za-z_$][\w$]*)", body[i:])
            if not dm:
                i += 1
                continue
            j = i + dm.end()
            k = skip_ws(body, j)
            args = ""
            if k < n and body[k] == "(":
                close = find_matching(body, k, "(", ")")
                if close == -1:
                    break
                args = body[k + 1:close]
                j = close + 1
            pending.append((dm.group(1), args.strip()))
            i = j
            continue
        if ch == "[":  # index signature / computed name: skip the bracket group
            close = find_matching(body, i, "[", "]")
            i = close + 1 if close != -1 else i + 1
            continue
        im = IDENT_RE.match(body, i)
        if not im:
            i += 1
            continue
        word = im.group(0)
        j = im.end()
        k = skip_ws(body, j)
        if word in MODIFIERS and k < n and body[k] not in ":?!(=":
            i = j
            continue
        optional = False
        if k < n and body[k] in "?!":
            optional = body[k] == "?"
            k = skip_ws(body, k + 1)
        if k < n and body[k] == "(":  # method (or constructor / getter)
            close = find_matching(body, k, "(", ")")
            if close == -1:
                break
            params_src = body[k + 1:close]
            j2 = skip_ws(body, close + 1)
            ret = ""
            if j2 < n and body[j2] == ":":
                ret, j2 = read_until(body, j2 + 1, "{;")
            j3 = skip_ws(body, j2)
            if j3 < n and body[j3] == "{":
                close_b = find_matching(body, j3, "{", "}")
                j3 = close_b + 1 if close_b != -1 else n
            members.append({
                "kind": "method", "name": word, "params": params_src,
                "returnType": ret.strip(), "decorators": pending, "offset": i,
            })
            pending = []
            i = j3
            continue
        if k < n and body[k] == ":":  # typed field
            type_str, j2 = read_until(body, k + 1, "=;")
            j2 = skip_ws(body, j2)
            if j2 < n and body[j2] == "=":
                _, j2 = read_until(body, j2 + 1, ";")
            members.append({
                "kind": "field", "name": word, "optional": optional,
                "type": type_str.strip(), "decorators": pending, "offset": i,
            })
            pending = []
            i = j2
            continue
        if k < n and body[k] == "=":  # field with initializer, no annotation
            _, j2 = read_until(body, k + 1, ";")
            members.append({
                "kind": "field", "name": word, "optional": optional,
                "type": "", "decorators": pending, "offset": i,
            })
            pending = []
            i = j2
            continue
        i = k if k > i else i + 1
    return members


def parse_params(params_src: str) -> list[dict]:
    """Split a method parameter list into decorated parameter records."""
    params: list[dict] = []
    for raw in split_top_level(params_src, ","):
        chunk = raw.strip()
        if not chunk:
            continue
        decorators: list[tuple[str, str]] = []
        while chunk.startswith("@"):
            dm = re.match(r"@([A-Za-z_$][\w$]*)\s*", chunk)
            if not dm:
                break
            name = dm.group(1)
            rest = chunk[dm.end():]
            args = ""
            if rest.startswith("("):
                close = find_matching(rest, 0, "(", ")")
                if close == -1:
                    rest = ""
                else:
                    args = rest[1:close]
                    rest = rest[close + 1:]
            decorators.append((name, args.strip()))
            chunk = rest.strip()
        if not chunk:
            continue
        default = ""
        eq = find_top_level_char(chunk, "=")
        if eq != -1:
            default = chunk[eq + 1:].strip()
            chunk = chunk[:eq].strip()
        name_part, type_part = chunk, ""
        colon = find_top_level_char(chunk, ":")
        if colon != -1:
            name_part = chunk[:colon].strip()
            type_part = chunk[colon + 1:].strip()
        optional = name_part.endswith("?")
        name_part = name_part.rstrip("?!").strip()
        if not IDENT_RE.fullmatch(name_part or ""):
            continue
        params.append({
            "name": name_part, "optional": optional, "type": type_part,
            "default": default, "decorators": decorators,
        })
    return params


# ---------------------------------------------------------------------------
# Type helpers
# ---------------------------------------------------------------------------

def unwrap_promise(t: str) -> str:
    t = (t or "").strip()
    m = re.match(r"^Promise\s*<(.*)>$", t, re.S)
    return m.group(1).strip() if m else t


def ts_leaf_type(t: str) -> str:
    """Strip Promise/Array/[]/union wrappers down to a bare class-ish token."""
    t = unwrap_promise(t)
    for part in split_top_level(t, "|"):
        p = part.strip()
        if p and p not in ("null", "undefined"):
            t = p
            break
    while True:
        m = re.match(r"^(?:Array|ReadonlyArray)\s*<(.*)>$", t, re.S)
        if m:
            t = m.group(1).strip()
            continue
        if t.endswith("[]"):
            t = t[:-2].strip()
            continue
        break
    return t.strip()


def first_quoted(text: str) -> str:
    m = re.search(r"['\"`]([^'\"`]*)['\"`]", text or "")
    return m.group(1) if m else ""


def controller_prefix(args: str) -> str:
    args = (args or "").strip()
    if not args:
        return ""
    m = re.match(r"^['\"`]([^'\"`]*)['\"`]", args)
    if m:
        return m.group(1)
    m = re.search(r"path\s*:\s*['\"`]([^'\"`]*)['\"`]", args)
    return m.group(1) if m else ""


def join_path(*parts: str) -> str:
    segs: list[str] = []
    for p in parts:
        p = (p or "").strip().strip("/")
        if p:
            segs.append(p)
    return "/" + "/".join(segs)


# ---------------------------------------------------------------------------
# Collection
# ---------------------------------------------------------------------------

class Collected:
    def __init__(self) -> None:
        self.classes: dict[str, dict] = {}   # class name -> {"fields", "file"}
        self.endpoints: list[dict] = []
        self.global_prefix = ""
        self._global_prefix_from_main = False


GLOBAL_PREFIX_RE = re.compile(r"\.setGlobalPrefix\(\s*['\"`]([^'\"`]+)['\"`]")
CLASS_RE = re.compile(r"\bclass\s+([A-Za-z_$][\w$]*)")
CONTROLLER_RE = re.compile(r"@Controller\b")


def iter_ts_files(root: Path):
    for p in sorted(root.rglob("*.ts")):
        rel_parts = p.relative_to(root).parts
        if any(part.lower() in EXCLUDED_DIRS for part in rel_parts[:-1]):
            continue
        if p.name.lower().endswith(EXCLUDED_SUFFIXES):
            continue
        yield p


def collect_file(path: Path, root: Path, c: Collected) -> None:
    try:
        src = strip_comments(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError):
        return
    rel = str(path.relative_to(root)).replace("\\", "/")

    gp = GLOBAL_PREFIX_RE.search(src)
    if gp and (not c.global_prefix or (path.name == "main.ts" and not c._global_prefix_from_main)):
        c.global_prefix = gp.group(1)
        c._global_prefix_from_main = path.name == "main.ts"

    # Pass 1: register every class as a potential DTO (fields only).
    for m in CLASS_RE.finditer(src):
        name = m.group(1)
        brace = src.find("{", m.end())
        if brace == -1:
            continue
        end = find_matching(src, brace, "{", "}")
        if end == -1:
            continue
        members = parse_class_members(src[brace + 1:end])
        fields = [mm for mm in members if mm["kind"] == "field"]
        if name not in c.classes:  # first definition wins on name collisions
            c.classes[name] = {"fields": fields, "file": rel}

    # Pass 2: controllers -> endpoints.
    for cm in CONTROLLER_RE.finditer(src):
        i = skip_ws(src, cm.end())
        args = ""
        if i < len(src) and src[i] == "(":
            close = find_matching(src, i, "(", ")")
            if close == -1:
                continue
            args = src[i + 1:close]
            i = close + 1
        # Skip any further decorators / export keywords before `class`.
        while True:
            i = skip_ws(src, i)
            if src.startswith("@", i):
                dm = re.match(r"@[A-Za-z_$][\w$]*", src[i:])
                if not dm:
                    break
                i += dm.end()
                i = skip_ws(src, i)
                if i < len(src) and src[i] == "(":
                    close = find_matching(src, i, "(", ")")
                    if close == -1:
                        break
                    i = close + 1
                continue
            km = re.match(r"(?:export|default|abstract)\b", src[i:])
            if km:
                i += km.end()
                continue
            break
        clm = re.match(r"class\s+([A-Za-z_$][\w$]*)", src[i:])
        if not clm:
            continue
        cls_name = clm.group(1)
        brace = src.find("{", i + clm.end())
        if brace == -1:
            continue
        end = find_matching(src, brace, "{", "}")
        if end == -1:
            continue
        prefix = controller_prefix(args)
        body = src[brace + 1:end]
        for mem in parse_class_members(body):
            if mem["kind"] != "method":
                continue
            http = next(((n, a) for n, a in mem["decorators"] if n in HTTP_DECORATORS), None)
            if http is None:
                continue
            dec_name, dec_args = http
            abs_offset = brace + 1 + mem["offset"]
            c.endpoints.append({
                "method": dec_name.upper(),
                "methodPath": first_quoted(dec_args),
                "ctrlPrefix": prefix,
                "controller": cls_name,
                "handler": mem["name"],
                "params": parse_params(mem["params"]),
                "returnType": mem["returnType"],
                "sourceFile": rel,
                "sourceLine": src[:abs_offset].count("\n") + 1,
            })


# ---------------------------------------------------------------------------
# Field expansion
# ---------------------------------------------------------------------------

def _ko(name_en: str, name_dict: dict) -> str:
    if name_en in name_dict:
        return name_dict[name_en]
    k = koreanize_identifier(name_en)
    return k if _HANGUL.search(k or "") else ""


def dto_required(optional: bool, decorators: list[tuple[str, str]]) -> str:
    dec_names = {n for n, _ in decorators}
    if optional or "IsOptional" in dec_names:
        return "N"
    return "Y"  # validators present without @IsOptional, or plain TS field


def expand_class(name: str, c: Collected, name_dict: dict, seen: set[str],
                 depth: int, parent_path: str | None) -> list[dict]:
    """Recursively expand a DTO class into flat interface-spec fields."""
    fields: list[dict] = []
    cls = c.classes.get(name)
    if cls is None or name in seen or depth > MAX_DEPTH:
        return fields
    seen = seen | {name}
    for f in cls["fields"]:
        fname = f["name"]
        if fname.startswith("_") or fname.lower() in AUDIT:
            continue
        path = f"{parent_path}.{fname}" if parent_path else fname
        fields.append({
            "nameEn": fname,
            "nameKo": _ko(fname, name_dict),
            "dataType": f["type"] or "any",
            "required": dto_required(f["optional"], f["decorators"]),
            "note": "",
            "path": path,
            **({"parentPath": parent_path} if parent_path else {}),
            "depth": depth,
        })
        leaf = ts_leaf_type(f["type"])
        if leaf in c.classes and leaf != name and leaf not in PRIMITIVES:
            fields.extend(expand_class(leaf, c, name_dict, seen, depth + 1, path))
    return fields


def build_request_fields(ep: dict, c: Collected, name_dict: dict) -> tuple[list[dict], str, str]:
    fields: list[dict] = []
    body_type = ""
    query_dto = ""
    for p in ep["params"]:
        dec = next(((n, a) for n, a in p["decorators"] if n in INPUT_DECORATORS), None)
        if dec is None:  # @Req/@Res/DI/custom decorators are not interface inputs
            continue
        dec_name, dec_args = dec
        bound = first_quoted(dec_args)
        leaf = ts_leaf_type(p["type"])
        if dec_name == "Param":
            name = bound or p["name"]
            fields.append({
                "nameEn": name, "nameKo": _ko(name, name_dict),
                "dataType": p["type"] or "string", "required": "Y",
                "note": "path", "path": name, "depth": 0,
            })
        elif dec_name == "Query":
            if bound:
                required = "N" if (p["optional"] or p["default"]) else "Y"
                fields.append({
                    "nameEn": bound, "nameKo": _ko(bound, name_dict),
                    "dataType": p["type"] or "string", "required": required,
                    "note": "query", "path": bound, "depth": 0,
                })
            elif leaf in c.classes:
                query_dto = leaf
                expanded = expand_class(leaf, c, name_dict, set(), 0, None)
                for f in expanded:
                    if f["depth"] == 0:
                        f["note"] = "query"
                fields.extend(expanded)
            else:
                required = "N" if (p["optional"] or p["default"]) else "Y"
                fields.append({
                    "nameEn": p["name"], "nameKo": _ko(p["name"], name_dict),
                    "dataType": p["type"] or "any", "required": required,
                    "note": "query", "path": p["name"], "depth": 0,
                })
        elif dec_name == "Body":
            if bound:
                fields.append({
                    "nameEn": bound, "nameKo": _ko(bound, name_dict),
                    "dataType": p["type"] or "any",
                    "required": "N" if (p["optional"] or p["default"]) else "Y",
                    "note": "body", "path": bound, "depth": 0,
                })
            elif leaf in c.classes:
                body_type = leaf
                fields.append({
                    "nameEn": p["name"], "nameKo": _ko(p["name"], name_dict),
                    "dataType": leaf,
                    "required": "N" if (p["optional"] or p["default"]) else "Y",
                    "note": "body", "path": p["name"], "depth": 0,
                })
                fields.extend(expand_class(leaf, c, name_dict, set(), 1, p["name"]))
            else:
                body_type = leaf if leaf not in PRIMITIVES else ""
                fields.append({
                    "nameEn": p["name"], "nameKo": _ko(p["name"], name_dict),
                    "dataType": p["type"] or "any",
                    "required": "N" if (p["optional"] or p["default"]) else "Y",
                    "note": "body", "path": p["name"], "depth": 0,
                })
    return fields, body_type, query_dto


def build_response_fields(ep: dict, c: Collected, name_dict: dict) -> tuple[str, list[dict]]:
    rt = unwrap_promise(ep["returnType"])
    leaf = ts_leaf_type(rt)
    if leaf in c.classes and leaf not in PRIMITIVES:
        return rt, expand_class(leaf, c, name_dict, set(), 0, None)
    return rt, []


def module_of(ep: dict) -> str:
    segs = [s for s in ep["ctrlPrefix"].strip("/").split("/") if s and not s.startswith(":")]
    if segs:
        return segs[0]
    stem = Path(ep["sourceFile"]).stem
    return stem[:-len(".controller")] if stem.endswith(".controller") else stem


def korean_iface_name(handler: str, name_dict: dict) -> str:
    if handler in name_dict:
        return name_dict[handler]
    k = koreanize_identifier(handler)
    return k if _HANGUL.search(k or "") else ""


def load_custom_dict(path: Path) -> dict[str, str]:
    return load_dictionary_file(path)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--codebase-path", required=True)
    ap.add_argument("--out", default="interface-spec.json")
    ap.add_argument("--inventory-only", action="store_true")
    ap.add_argument("--modules", default="")
    ap.add_argument("--name-dict", default="")
    ap.add_argument("--sample-context", default="", help="approved database-context JSON; never credentials")
    ap.add_argument("--codebase-name", default="")
    args = ap.parse_args()

    root = Path(args.codebase_path).resolve()
    if not root.exists():
        raise SystemExit(f"codebase path not found: {root}")

    c = Collected()
    for ts in iter_ts_files(root):
        collect_file(ts, root, c)

    # Compose full paths only after every file (incl. main.ts, which holds
    # the global prefix) has been scanned.
    for ep in c.endpoints:
        ep["path"] = join_path(c.global_prefix, ep["ctrlPrefix"], ep["methodPath"])

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
                    {"method": ep["method"], "path": ep["path"], "module": module_of(ep),
                     "handler": ep["handler"], "sourceFile": ep["sourceFile"]}
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
        request_fields, body_type, query_dto = build_request_fields(ep, c, name_dict)
        response_type, response_fields = build_response_fields(ep, c, name_dict)
        out_endpoints.append({
            "method": ep["method"],
            "path": ep["path"],
            "interfaceId": "",
            "interfaceName": korean_iface_name(ep["handler"], name_dict),
            "businessCode": "", "channel": "", "owner": "", "note": "",
            "moduleName": module_of(ep),
            "serviceName": ep["controller"],
            "handlerName": ep["handler"],
            "sourceFile": ep["sourceFile"],
            "sourceLine": ep["sourceLine"],
            "authRequired": False,
            "requestBodyType": body_type,
            "queryDtoType": query_dto,
            "responseType": response_type,
            "requestFields": request_fields,
            "responseFields": response_fields,
        })

    doc = {
        "schemaVersion": 1,
        "kind": "interface-spec",
        "cover": {"brand": "", "docName": "", "version": "", "department": ""},
        "source": {
            "codebaseName": args.codebase_name or root.name,
            "codebasePath": str(root),
            "language": "typescript",
            "framework": "nestjs",
            "collector": "static-nestjs",
        },
        "endpoints": out_endpoints,
    }
    add_static_examples(out_endpoints, load_sample_context(args.sample_context, args.codebase_path))

    Path(args.out).write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    counts = Counter(module_of(ep) for ep in endpoints)
    print(json.dumps({"out": str(Path(args.out).resolve()), "endpointCount": len(out_endpoints),
                      "classesFound": len(c.classes), "globalPrefix": c.global_prefix,
                      "modules": dict(counts.most_common())},
                     ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
