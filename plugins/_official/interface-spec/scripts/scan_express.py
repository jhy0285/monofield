"""Express collector for the MonoField interface-spec pipeline.

Static scanner over JavaScript sources — stdlib only (regex + string-aware
brace/paren tracking; there is no JS parser in the stdlib). Emits an
interface-spec.json document (schema v1) that `od docs render-interface-spec`
accepts directly.

Handles:
  - router.get/post/put/patch/delete('/path', ...) and app.get(...) direct
    registrations, plus router.route('/path').get(...).post(...) chains
  - mounts: app.use('/prefix', xxxRouter) / router.use(...) — router
    variables are traced through require()/import paths so mount prefixes
    compose transitively; unresolvable mounts fall back to the route path
    as written in the router file
  - request fields:
      (a) celebrate/Joi or zod schemas attached to the route -> schema keys
          (required from .required()/.optional(); nested Joi.object /
          z.object recursion, max depth 6), or
      (b) otherwise req.body.X / req.query.X / req.params.X usages in the
          handler body (params -> required Y, everything else N)
    plus :param tokens from the route path itself (always required)
  - response fields: top-level keys of the first successful res.json({...})
    object literal (2xx or no status); responseType stays "" (JS handlers
    rarely name a response type)

Usage mirrors scan_fastapi.py:
  python scan_express.py --codebase-path <path> [--inventory-only]
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


HTTP_VERBS = {"get", "post", "put", "patch", "delete", "head", "options", "all"}
EXCLUDED_DIRS = {"node_modules", "dist", "build", "out", "coverage", "test", "tests", "__tests__", ".git", "public"}
EXCLUDED_SUFFIXES = (".test.js", ".spec.js", ".min.js", ".test.mjs", ".spec.mjs")
MAX_DEPTH = 6
_HANGUL = re.compile(r"[가-힣]")
AUDIT = {
    "created_at", "updated_at", "created_by", "updated_by", "deleted_at",
    "createdat", "updatedat", "crtr_id", "creat_dttm", "updatr_id", "updat_dttm",
}


# ---------------------------------------------------------------------------
# Lightweight JS lexing helpers (comment stripping, brace matching)
# ---------------------------------------------------------------------------

def strip_comments(src: str) -> str:
    """Blank out // and /* */ comments, preserving newlines and offsets.

    Regex literals are not tracked; a literal containing `//` may blank the
    rest of that line (acceptable for route scanning).
    """
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


def find_matching(text: str, open_idx: int, open_ch: str = "(", close_ch: str = ")") -> int:
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
    """Yield (index, char, at_top_level) skipping strings; tracks (), [], {}."""
    dr = ds = dc = 0
    i, n = 0, len(text)
    string_ch: str | None = None
    while i < n:
        ch = text[i]
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
        at_top = dr == ds == dc == 0
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


def top_chain(text: str) -> str:
    """Keep only the top-level method chain of an expression (mask the
    contents of nested (), [], {} groups) so `.required()` checks do not
    leak in from nested schemas."""
    out: list[str] = []
    depth = 0
    i, n = 0, len(text)
    string_ch: str | None = None
    while i < n:
        ch = text[i]
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
        if ch in "([{":
            if depth == 0:
                out.append(ch)
            depth += 1
        elif ch in ")]}":
            depth = max(0, depth - 1)
            if depth == 0:
                out.append(ch)
        elif depth == 0:
            out.append(ch)
        i += 1
    return "".join(out)


FIRST_STRING_RE = re.compile(r"^\s*(['\"`])((?:\\.|(?!\1).)*)\1", re.S)
IDENT_ONLY_RE = re.compile(r"^[A-Za-z_$][\w$]*$")


# ---------------------------------------------------------------------------
# Per-file parsing
# ---------------------------------------------------------------------------

APP_RE = re.compile(
    r"(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:express\s*\(\s*\)|require\(\s*['\"]express['\"]\s*\)\s*\(\s*\))"
)
ROUTER_RE = re.compile(
    r"(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:express\s*\.\s*Router|Router)\s*\("
)
REQUIRE_RE = re.compile(
    r"(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['\"]([^'\"]+)['\"]\s*\)"
)
IMPORT_RE = re.compile(r"import\s+([A-Za-z_$][\w$]*)\s+from\s+['\"]([^'\"]+)['\"]")
EXPORT_RE = re.compile(r"module\.exports\s*=\s*([A-Za-z_$][\w$]*)|export\s+default\s+([A-Za-z_$][\w$]*)")
CALL_RE = re.compile(r"\b([A-Za-z_$][\w$]*)\s*\.\s*(get|post|put|patch|delete|head|options|all|use|route)\s*\(")
FUNC_DECL_RE = re.compile(r"\bfunction\s+([A-Za-z_$][\w$]*)\s*\(")
FUNC_EXPR_RE = re.compile(r"(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\()")
INLINE_REQUIRE_RE = re.compile(r"require\(\s*['\"]([^'\"]+)['\"]\s*\)")


class JsFileRec:
    def __init__(self, path: Path, rel: str, src: str) -> None:
        self.path = path
        self.rel = rel
        self.src = src
        self.app_vars: set[str] = set()
        self.router_vars: set[str] = set()
        self.imports: dict[str, Path | None] = {}
        self.exported: str | None = None
        self.functions: dict[str, str] = {}
        self.routes: list[dict] = []   # owner, method, path, args, line
        self.mounts: list[dict] = []   # owner, prefix, target (str ident or Path)


def resolve_module(base_file: Path, spec: str) -> Path | None:
    if not spec.startswith("."):
        return None  # package import — never a local router file
    base = (base_file.parent / spec).resolve()
    candidates = [base]
    if not base.suffix:
        candidates += [base.with_suffix(".js"), base.with_suffix(".mjs"), base.with_suffix(".cjs"),
                       base / "index.js", base / "index.mjs"]
    for cand in candidates:
        if cand.is_file():
            return cand
    return None


def _collect_function(src: str, open_paren: int, name: str, rec: JsFileRec) -> None:
    close = find_matching(src, open_paren, "(", ")")
    if close == -1:
        return
    i = skip_ws(src, close + 1)
    if src.startswith("=>", i):
        i = skip_ws(src, i + 2)
    if i < len(src) and src[i] == "{":
        end = find_matching(src, i, "{", "}")
        if end != -1:
            rec.functions[name] = src[open_paren:end + 1]


def parse_js_file(path: Path, root: Path) -> JsFileRec:
    src = strip_comments(path.read_text(encoding="utf-8", errors="replace"))
    rel = str(path.relative_to(root)).replace("\\", "/")
    rec = JsFileRec(path, rel, src)

    for m in APP_RE.finditer(src):
        rec.app_vars.add(m.group(1))
    for m in ROUTER_RE.finditer(src):
        rec.router_vars.add(m.group(1))
    for m in REQUIRE_RE.finditer(src):
        if m.group(2) != "express":
            rec.imports[m.group(1)] = resolve_module(path, m.group(2))
    for m in IMPORT_RE.finditer(src):
        if m.group(2) != "express":
            rec.imports[m.group(1)] = resolve_module(path, m.group(2))
    em = EXPORT_RE.search(src)
    if em:
        rec.exported = em.group(1) or em.group(2)
    for m in FUNC_DECL_RE.finditer(src):
        paren = src.find("(", m.end() - 1)
        if paren != -1:
            _collect_function(src, paren, m.group(1), rec)
    for m in FUNC_EXPR_RE.finditer(src):
        paren = src.find("(", m.end() - 1)
        if paren != -1 and m.group(1) not in rec.functions:
            _collect_function(src, paren, m.group(1), rec)

    known_owners = rec.app_vars | rec.router_vars
    for m in CALL_RE.finditer(src):
        owner, verb = m.group(1), m.group(2)
        if owner not in known_owners:
            continue
        open_paren = src.rfind("(", m.start(), m.end())
        close = find_matching(src, open_paren, "(", ")")
        if close == -1:
            continue
        args = src[open_paren + 1:close]
        line = src[:m.start()].count("\n") + 1
        if verb == "use":
            _parse_mount(rec, path, owner, args)
            continue
        sm = FIRST_STRING_RE.match(args)
        if not sm:
            continue
        route_path = sm.group(2)
        comma = _first_top_comma(args)
        rest = args[comma + 1:] if comma != -1 else ""
        if verb == "route":
            _parse_route_chain(rec, src, owner, route_path, close + 1, line)
        else:
            rec.routes.append({"owner": owner, "method": verb.upper(),
                               "path": route_path, "args": rest, "line": line})
    return rec


def _first_top_comma(text: str) -> int:
    for i, ch, at_top in _depth_scan(text):
        if at_top and ch == ",":
            return i
    return -1


def _parse_mount(rec: JsFileRec, path: Path, owner: str, args: str) -> None:
    parts = split_top_level(args, ",")
    if not parts:
        return
    sm = FIRST_STRING_RE.match(parts[0])
    if not sm:
        return  # app.use(middleware) — not a mount with a prefix
    prefix = sm.group(2)
    target: str | Path | None = None
    for part in parts[1:]:
        p = part.strip()
        if IDENT_ONLY_RE.match(p):
            target = p  # last identifier arg wins (middlewares come first)
        else:
            rm = INLINE_REQUIRE_RE.search(p)
            if rm:
                resolved = resolve_module(path, rm.group(1))
                if resolved is not None:
                    target = resolved
    if target is not None:
        rec.mounts.append({"owner": owner, "prefix": prefix, "target": target})


def _parse_route_chain(rec: JsFileRec, src: str, owner: str, route_path: str,
                       start: int, line: int) -> None:
    """Handle router.route('/x').get(h).post(h) chains."""
    i = start
    n = len(src)
    while True:
        i = skip_ws(src, i)
        if i >= n or src[i] != ".":
            break
        im = re.match(r"\.\s*([A-Za-z_$][\w$]*)\s*\(", src[i:])
        if not im:
            break
        verb = im.group(1)
        open_paren = i + im.end() - 1
        close = find_matching(src, open_paren, "(", ")")
        if close == -1:
            break
        if verb in HTTP_VERBS:
            rec.routes.append({"owner": owner, "method": verb.upper(),
                               "path": route_path, "args": src[open_paren + 1:close],
                               "line": line})
        i = close + 1


# ---------------------------------------------------------------------------
# Mount graph -> prefix resolution
# ---------------------------------------------------------------------------

def compute_prefixes(files: list[JsFileRec]) -> dict[tuple[str, str], set[str]]:
    by_path = {str(f.path): f for f in files}

    def resolve_target(f: JsFileRec, target) -> tuple[str, str] | None:
        if isinstance(target, Path):
            tf = by_path.get(str(target))
            if tf is None:
                return None
            return (str(target), _entry_var(tf))
        if target in f.imports:
            rp = f.imports[target]
            if rp is None:
                return None
            tf = by_path.get(str(rp))
            if tf is None:
                return None
            return (str(rp), _entry_var(tf))
        return (str(f.path), target)  # same-file router variable

    def _entry_var(tf: JsFileRec) -> str:
        if tf.exported:
            return tf.exported
        if len(tf.router_vars) == 1:
            return next(iter(tf.router_vars))
        return "__default__"

    prefixes: dict[tuple[str, str], set[str]] = {}
    for f in files:
        for a in f.app_vars:
            prefixes.setdefault((str(f.path), a), set()).add("")

    changed = True
    guard = 0
    while changed and guard < 50:
        changed = False
        guard += 1
        for f in files:
            for m in f.mounts:
                owner_node = (str(f.path), m["owner"])
                tgt = resolve_target(f, m["target"])
                if tgt is None:
                    continue
                for p in prefixes.get(owner_node, set()):
                    np = _join_prefix(p, m["prefix"])
                    bucket = prefixes.setdefault(tgt, set())
                    if np not in bucket:
                        bucket.add(np)
                        changed = True
    return prefixes


def _join_prefix(a: str, b: str) -> str:
    segs = [s for part in (a, b) for s in part.strip("/").split("/") if s]
    return "/" + "/".join(segs) if segs else ""


def join_path(prefix: str, route_path: str) -> str:
    segs = [s for part in (prefix, route_path) for s in part.strip("/").split("/") if s]
    return "/" + "/".join(segs)


# ---------------------------------------------------------------------------
# Field extraction
# ---------------------------------------------------------------------------

def _ko(name_en: str, name_dict: dict) -> str:
    if name_en in name_dict:
        return name_dict[name_en]
    k = koreanize_identifier(name_en)
    return k if _HANGUL.search(k or "") else ""


def _field(name: str, name_dict: dict, dtype: str, required: str, note: str,
           path: str, parent: str | None, depth: int) -> dict:
    return {
        "nameEn": name,
        "nameKo": _ko(name, name_dict),
        "dataType": dtype,
        "required": required,
        "note": note,
        "path": path,
        **({"parentPath": parent} if parent else {}),
        "depth": depth,
    }


JOI_OBJECT_RE = re.compile(r"\b(?:Joi|joi)\s*\.\s*object\s*\(")
JOI_TYPE_RE = re.compile(r"\b(?:Joi|joi)\s*\.\s*(string|number|integer|boolean|bool|date|array|object|binary|any|alternatives)")
ZOD_OBJECT_RE = re.compile(r"\bz\s*\.\s*object\s*\(")
ZOD_TYPE_RE = re.compile(r"\bz\s*\.\s*(?:coerce\s*\.\s*)?(string|number|boolean|date|bigint|array|object|enum|literal|any)")
KEY_RE = re.compile(r"^(?:\[?\s*['\"]([^'\"]+)['\"]\s*\]?|([A-Za-z_$][\w$]*))\s*:\s*(.+)$", re.S)


def _object_braces_content(text: str, call_open: int) -> str:
    """Given index of '(' of Joi.object( / z.object(, return the {...} body."""
    close = find_matching(text, call_open, "(", ")")
    if close == -1:
        return ""
    inner = text[call_open + 1:close]
    brace = inner.find("{")
    if brace == -1:
        return ""
    end = find_matching(inner, brace, "{", "}")
    return inner[brace + 1:end] if end != -1 else ""


def parse_schema_object(content: str, note: str, depth: int, parent: str | None,
                        name_dict: dict, out: list[dict], kind: str) -> None:
    """Extract keys from a Joi.object({...}) / z.object({...}) body."""
    if depth > MAX_DEPTH:
        return
    for entry in split_top_level(content, ","):
        e = entry.strip()
        if not e or e.startswith("..."):
            continue
        km = KEY_RE.match(e)
        if not km:
            continue
        key = km.group(1) or km.group(2)
        val = km.group(3)
        if key.lower() in AUDIT or key.startswith("_"):
            continue
        chain = top_chain(val)
        if kind == "joi":
            required = "Y" if ".required(" in chain.replace(" ", "") else "N"
            tm = JOI_TYPE_RE.search(chain)
            dtype = tm.group(1) if tm else "any"
        else:
            required = "N" if ".optional(" in chain.replace(" ", "") else "Y"
            tm = ZOD_TYPE_RE.search(chain)
            dtype = tm.group(1) if tm else "any"
        dtype = {"integer": "number", "bool": "boolean", "literal": "string"}.get(dtype, dtype)
        path = f"{parent}.{key}" if parent else key
        out.append(_field(key, name_dict, dtype, required,
                          note if depth == 0 else "", path, parent, depth))
        nm = (JOI_OBJECT_RE if kind == "joi" else ZOD_OBJECT_RE).search(val)
        if nm:
            call_open = val.find("(", nm.start())
            nested = _object_braces_content(val, call_open)
            if nested:
                parse_schema_object(nested, note, depth + 1, path, name_dict, out, kind)


CELEBRATE_RE = re.compile(r"\bcelebrate\s*\(")
SEGMENT_NOTES = [("body", "body"), ("query", "query"), ("params", "path")]
USAGE_RE = re.compile(r"\breq\s*\??\.\s*(body|query|params)\s*\??\.\s*([A-Za-z_$][\w$]*)")
DESTR_RE = re.compile(r"\{([^{}]*)\}\s*=\s*req\s*\??\.\s*(body|query|params)\b")
RES_JSON_RE = re.compile(r"\bres\s*(?:\.\s*status\s*\(\s*(\d+)\s*\)\s*)?\.\s*json\s*\(")


def extract_schema_fields(analysis: str, method: str, name_dict: dict) -> list[dict]:
    fields: list[dict] = []
    cm = CELEBRATE_RE.search(analysis)
    if cm:
        call_open = analysis.find("(", cm.start())
        close = find_matching(analysis, call_open, "(", ")")
        if close != -1:
            obj = analysis[call_open + 1:close]
            brace = obj.find("{")
            end = find_matching(obj, brace, "{", "}") if brace != -1 else -1
            if end != -1:
                for entry in split_top_level(obj[brace + 1:end], ","):
                    e = entry.strip()
                    colon = _first_top_colon(e)
                    if colon == -1:
                        continue
                    key_txt, val = e[:colon].lower(), e[colon + 1:]
                    note = next((n for seg, n in SEGMENT_NOTES if seg in key_txt), None)
                    if note is None:
                        continue  # headers / cookies are not interface fields
                    jm = JOI_OBJECT_RE.search(val)
                    if jm:
                        content = _object_braces_content(val, val.find("(", jm.start()))
                        parse_schema_object(content, note, 0, None, name_dict, fields, "joi")
        if fields:
            return fields
    zm = ZOD_OBJECT_RE.search(analysis)
    if zm:
        note = "body" if method in ("POST", "PUT", "PATCH") else "query"
        content = _object_braces_content(analysis, analysis.find("(", zm.start()))
        if content:
            parse_schema_object(content, note, 0, None, name_dict, fields, "zod")
    return fields


def _first_top_colon(text: str) -> int:
    for i, ch, at_top in _depth_scan(text):
        if at_top and ch == ":":
            return i
    return -1


def extract_usage_fields(analysis: str, name_dict: dict) -> list[dict]:
    note_map = {"body": "body", "query": "query", "params": "path"}
    found: list[tuple[str, str]] = []
    for m in USAGE_RE.finditer(analysis):
        found.append((m.group(1), m.group(2)))
    for m in DESTR_RE.finditer(analysis):
        seg = m.group(2)
        for raw in m.group(1).split(","):
            name = raw.strip()
            if not name or name.startswith("..."):
                continue
            name = re.split(r"[:=]", name, maxsplit=1)[0].strip()
            if IDENT_ONLY_RE.match(name):
                found.append((seg, name))
    fields: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for seg, name in found:
        note = note_map[seg]
        if (note, name) in seen or name.lower() in AUDIT:
            continue
        seen.add((note, name))
        required = "Y" if seg == "params" else "N"
        dtype = "any" if seg == "body" else "string"
        fields.append(_field(name, name_dict, dtype, required, note, name, None, 0))
    return fields


def infer_js_type(val: str) -> str:
    v = val.strip()
    if not v:
        return "any"
    if v[0] in "'\"`":
        return "string"
    if re.match(r"^-?\d", v):
        return "number"
    if re.match(r"^(true|false)\b", v):
        return "boolean"
    if v[0] == "[":
        return "array"
    if v[0] == "{":
        return "object"
    return "any"


def extract_response_fields(analysis: str, name_dict: dict) -> list[dict]:
    candidates: list[tuple[int | None, str]] = []
    for m in RES_JSON_RE.finditer(analysis):
        status = int(m.group(1)) if m.group(1) else None
        open_paren = analysis.rfind("(", m.start(), m.end())
        close = find_matching(analysis, open_paren, "(", ")")
        if close == -1:
            continue
        arg = analysis[open_paren + 1:close].strip()
        if arg.startswith("{"):
            end = find_matching(arg, 0, "{", "}")
            if end != -1:
                candidates.append((status, arg[1:end]))
    chosen = next((c for c in candidates if c[0] is None or 200 <= c[0] < 300),
                  candidates[0] if candidates else None)
    if chosen is None:
        return []
    fields: list[dict] = []
    for entry in split_top_level(chosen[1], ","):
        e = entry.strip()
        if not e or e.startswith("..."):
            continue
        m = re.match(r"^(?:['\"]([^'\"]+)['\"]|([A-Za-z_$][\w$]*))\s*(:)?", e)
        if not m:
            continue
        key = m.group(1) or m.group(2)
        if key.lower() in AUDIT or key.startswith("_"):
            continue
        if m.group(3):
            dtype = infer_js_type(e[m.end():])
        else:
            if not IDENT_ONLY_RE.match(e):
                continue  # method shorthand / computed keys
            dtype = "any"
        # A literal key is deterministically present in that response.
        fields.append(_field(key, name_dict, dtype, "Y", "", key, None, 0))
    return fields


def build_request_fields(route: dict, analysis: str, full_path: str, name_dict: dict) -> list[dict]:
    fields: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for token in re.findall(r":([A-Za-z_$][\w$]*)", full_path):
        fields.append(_field(token, name_dict, "string", "Y", "path", token, None, 0))
        seen.add(("path", token))
    schema_fields = extract_schema_fields(analysis, route["method"], name_dict)
    extra = schema_fields if schema_fields else extract_usage_fields(analysis, name_dict)
    for f in extra:
        key = (f["note"] or "", f["path"])
        if key in seen:
            continue
        seen.add(key)
        fields.append(f)
    return fields


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------

def iter_js_files(root: Path):
    for pattern in ("*.js", "*.mjs", "*.cjs"):
        for p in root.rglob(pattern):
            rel_parts = p.relative_to(root).parts
            if any(part.lower() in EXCLUDED_DIRS for part in rel_parts[:-1]):
                continue
            if p.name.lower().endswith(EXCLUDED_SUFFIXES):
                continue
            yield p


def meaningful_segments(path: str) -> list[str]:
    parts = [p for p in path.strip("/").split("/") if p and not p.startswith(":")]
    if parts and parts[0].lower() == "api":
        parts = parts[1:]
        if parts and re.fullmatch(r"v\d+", parts[0].lower()):
            parts = parts[1:]
    return parts


def module_of(path: str, source_file: str) -> str:
    """First meaningful path segment (skipping the api/vN prefix, mirroring
    scan_spring.py); falls back to the router file stem like scan_fastapi.py."""
    parts = meaningful_segments(path)
    if parts:
        return parts[0]
    return Path(source_file).stem


def korean_iface_name(handler: str, method: str, path: str, name_dict: dict) -> str:
    base = handler or " ".join(meaningful_segments(path) + [method.lower()])
    if base in name_dict:
        return name_dict[base]
    k = koreanize_identifier(base)
    return k if _HANGUL.search(k or "") else ""


def handler_name(args: str, functions: dict[str, str]) -> str:
    idents = [p.strip() for p in split_top_level(args, ",") if IDENT_ONLY_RE.match(p.strip())]
    return idents[-1] if idents else ""


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

    files: list[JsFileRec] = []
    for p in sorted(set(iter_js_files(root))):
        try:
            files.append(parse_js_file(p, root))
        except OSError:
            continue

    prefixes = compute_prefixes(files)

    raw_endpoints: list[dict] = []
    for f in files:
        for route in f.routes:
            node = (str(f.path), route["owner"])
            route_prefixes = sorted(prefixes.get(node, {""}))
            for prefix in route_prefixes:
                raw_endpoints.append({
                    **route,
                    "fullPath": join_path(prefix, route["path"]),
                    "file": f,
                })

    # de-dupe endpoints by method+path (keep first)
    seen_keys: set[str] = set()
    endpoints = []
    for ep in raw_endpoints:
        key = f"{ep['method']} {ep['fullPath']}"
        if key in seen_keys:
            continue
        seen_keys.add(key)
        endpoints.append(ep)

    wanted = {m.strip() for m in args.modules.split(",") if m.strip()}
    if wanted:
        endpoints = [ep for ep in endpoints if module_of(ep["fullPath"], ep["file"].rel) in wanted]

    if args.inventory_only:
        counts = Counter(module_of(ep["fullPath"], ep["file"].rel) for ep in endpoints)
        json.dump(
            {
                "endpointCount": len(endpoints),
                "modules": dict(counts.most_common()),
                "endpoints": [
                    {"method": ep["method"], "path": ep["fullPath"],
                     "module": module_of(ep["fullPath"], ep["file"].rel),
                     "handler": handler_name(ep["args"], ep["file"].functions),
                     "sourceFile": ep["file"].rel}
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
    for ep in sorted(endpoints, key=lambda e: (module_of(e["fullPath"], e["file"].rel), e["fullPath"], e["method"])):
        f: JsFileRec = ep["file"]
        analysis = ep["args"]
        for part in split_top_level(ep["args"], ","):
            ident = part.strip()
            if IDENT_ONLY_RE.match(ident) and ident in f.functions:
                analysis += "\n" + f.functions[ident]
        hname = handler_name(ep["args"], f.functions)
        out_endpoints.append({
            "method": ep["method"],
            "path": ep["fullPath"],
            "interfaceId": "",
            "interfaceName": korean_iface_name(hname, ep["method"], ep["fullPath"], name_dict),
            "businessCode": "", "channel": "", "owner": "", "note": "",
            "moduleName": module_of(ep["fullPath"], f.rel),
            "serviceName": "",
            "handlerName": hname,
            "sourceFile": f.rel,
            "sourceLine": ep["line"],
            "authRequired": False,
            "requestBodyType": "",
            "queryDtoType": "",
            "responseType": "",
            "requestFields": build_request_fields(ep, analysis, ep["fullPath"], name_dict),
            "responseFields": extract_response_fields(analysis, name_dict),
        })

    doc = {
        "schemaVersion": 1,
        "kind": "interface-spec",
        "cover": {"brand": "", "docName": "", "version": "", "department": ""},
        "source": {
            "codebaseName": args.codebase_name or root.name,
            "codebasePath": str(root),
            "language": "javascript",
            "framework": "express",
            "collector": "static-express",
        },
        "endpoints": out_endpoints,
    }
    add_static_examples(out_endpoints, load_sample_context(args.sample_context, args.codebase_path))

    Path(args.out).write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    counts = Counter(module_of(ep["fullPath"], ep["file"].rel) for ep in endpoints)
    print(json.dumps({"out": str(Path(args.out).resolve()), "endpointCount": len(out_endpoints),
                      "filesScanned": len(files), "modules": dict(counts.most_common())},
                     ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
