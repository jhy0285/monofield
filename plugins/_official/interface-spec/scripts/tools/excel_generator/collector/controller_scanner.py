from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from tools.excel_generator.collector.dto_expander import _split_top_level
from tools.excel_generator.collector.spring_security import SpringSecurityModel, security_annotation
from tools.excel_generator.models import ApiEndpoint, FieldSpec
from tools.excel_generator.rules.naming import koreanize_identifier

MAPPING_ANNOS = (
    "@GetMapping",
    "@PostMapping",
    "@PutMapping",
    "@DeleteMapping",
    "@PatchMapping",
    "@RequestMapping",
)
PACKAGE_RE = re.compile(r"^\s*package\s+([^;]+);", re.M)
# A method-level @RequestMapping without `method` serves every HTTP method.
ANY_METHOD = "GET/POST"
ANY_METHOD_NOTE = "@RequestMapping에 method가 없어 모든 HTTP 메서드를 허용"
# Spring binds these handler arguments itself; they never carry client input.
FRAMEWORK_PARAM_TYPES = {
    "HttpServletRequest", "HttpServletResponse", "ServletRequest", "ServletResponse", "HttpSession",
    "WebRequest", "NativeWebRequest", "MultipartHttpServletRequest", "Model", "ModelMap", "ModelAndView",
    "BindingResult", "Errors", "SessionStatus", "RedirectAttributes", "Principal", "Authentication",
    "Locale", "TimeZone", "ZoneId", "InputStream", "OutputStream", "Reader", "Writer", "HttpMethod",
    "UriComponentsBuilder", "HttpEntity", "RequestEntity", "Pageable", "Sort",
}
SIMPLE_PARAM_TYPES = {
    "String", "Integer", "int", "Long", "long", "Short", "short", "Byte", "byte", "Double", "double",
    "Float", "float", "Boolean", "boolean", "Character", "char", "BigDecimal", "BigInteger",
    "LocalDate", "LocalDateTime", "LocalTime", "Date", "UUID",
}
# Argument annotations that bind something other than a form/query object.
NON_FORM_PARAM_ANNOS = (
    "@RequestHeader", "@CookieValue", "@SessionAttribute", "@RequestAttribute",
    "@AuthenticationPrincipal", "@RequestPart", "@MatrixVariable", "@Value",
)
QUERY_DTO_SUFFIXES = (
    "Dto", "DTO", "Form", "VO", "Vo", "Condition", "Criteria", "Cond", "Param", "Params", "Search", "Command",
)
CONST_RE = re.compile(r"public\s+static\s+final\s+String\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?);")
CLASS_RE = re.compile(r"\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b")
SERVICE_FIELD_RE = re.compile(
    r"\bprivate\s+final\s+([A-Za-z_][A-Za-z0-9_<>,\.\s\[\]]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*;"
)


@dataclass
class ApiSeed:
    method: str
    path: str
    controller_file: str
    package_name: str
    service_name: str
    controller_line: int
    method_name: str
    request_body_type: str | None
    query_dto_type: str | None
    response_type: str | None
    # None when the security configuration gives no static evidence either way.
    auth_required: bool | None
    request_fields: list[FieldSpec]
    summary: str = ""
    note: str = ""
    auth_evidence: list[dict] = field(default_factory=list)
    # Response fields read from the handler itself (the keys put into a returned Map).
    response_fields: list[FieldSpec] = field(default_factory=list)


def _controller_display_path(path: Path, repo_root: Path, codebase_path: Path) -> str:
    for base in (repo_root, codebase_path):
        try:
            return str(path.relative_to(base))
        except ValueError:
            continue
    return str(path)


def _join_mapping_path(class_base: str, method_path: str) -> str:
    """Join a class @RequestMapping and a method mapping the way Spring resolves
    them: an empty method mapping targets the class path itself (never a
    trailing-slash twin), and duplicate separators collapse to one."""
    segments = [
        segment
        for part in (class_base, method_path)
        for segment in part.split("/")
        if segment
    ]
    return "/" + "/".join(segments)


def _javadoc_summary(block: list[str]) -> str:
    """First descriptive line of a Javadoc/block comment, without tags or the closing period."""
    for raw in block:
        text = raw.strip().lstrip("/").lstrip("*").strip()
        if text.endswith("*/"):
            text = text[:-2].strip()
        if not text or text.startswith("@"):
            continue
        return text.rstrip(".").strip()
    return ""


def _project_class_names(java_root: Path) -> set[str]:
    names: set[str] = set()
    for path in java_root.rglob("*.java"):
        m = CLASS_RE.search(path.read_text(encoding="utf-8", errors="ignore"))
        if m:
            names.add(m.group(1))
    return names


def _form_object_type(param: str, p_type: str, project_classes: set[str]) -> bool:
    """Whether Spring binds this handler argument from request parameters as a form object.

    `@ModelAttribute` always does; an un-annotated argument does when it is a
    non-simple type (Spring's implicit @ModelAttribute) that belongs to the
    project or follows a DTO/VO naming convention.
    """
    base = re.sub(r"<.*", "", p_type).replace("[]", "").strip()
    if base in FRAMEWORK_PARAM_TYPES or base in SIMPLE_PARAM_TYPES:
        return False
    if "@ModelAttribute" in param:
        return True
    if any(anno in param for anno in NON_FORM_PARAM_ANNOS):
        return False
    return base in project_classes or base.endswith(QUERY_DTO_SUFFIXES)


def _normalize_type(type_raw: str) -> str:
    t = type_raw.strip()
    t = re.sub(r"\s+", " ", t)
    t = t.replace("java.lang.", "")
    return t


def _short_type(type_raw: str) -> str:
    t = _normalize_type(type_raw)
    parts = re.split(r"([<>,\[\]\s])", t)
    out: list[str] = []
    for p in parts:
        if not p or re.fullmatch(r"[<>,\[\]\s]", p):
            out.append(p)
        else:
            out.append(p.split(".")[-1])
    return "".join(out).strip()


def _parse_annotation_block(lines: list[str], idx: int) -> tuple[str, int]:
    s = lines[idx].strip()
    out = s
    j = idx + 1
    depth = s.count("(") - s.count(")")
    while j < len(lines) and depth > 0:
        p = lines[j].strip()
        out += " " + p
        depth += p.count("(") - p.count(")")
        j += 1
    return out, j


def _split_java_concat(expr: str) -> list[str]:
    parts: list[str] = []
    cur: list[str] = []
    in_string = False
    escaped = False

    for ch in expr:
        if in_string:
            cur.append(ch)
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
            cur.append(ch)
            continue

        if ch == "+":
            part = "".join(cur).strip()
            if part:
                parts.append(part)
            cur = []
            continue

        cur.append(ch)

    tail = "".join(cur).strip()
    if tail:
        parts.append(tail)
    return parts


def _resolve_constant_expr(expr: str, consts: dict[str, str]) -> str:
    expr = expr.strip()
    expr = re.sub(r"^(value|path)\s*=\s*", "", expr).strip()
    parts = _split_java_concat(expr)
    out = ""
    for p in parts:
        if p.startswith('"') and p.endswith('"'):
            out += bytes(p[1:-1], "utf-8").decode("unicode_escape")
        elif p.startswith("Constant."):
            out += consts.get(p.split(".", 1)[1], "")
        elif p in consts:
            out += consts[p]
        elif "." in p and ".".join(p.split(".")[-2:]) in consts:
            out += consts[".".join(p.split(".")[-2:])]
        else:
            out += p.strip("'")
    return out


def _mapping_paths(expr: str, consts: dict[str, str]) -> list[str]:
    """Paths named by a mapping argument: one expression, or an array `{"/a", "/b"}`."""
    expr = re.sub(r"^\s*(?:value|path)\s*=\s*", "", expr.strip()).strip()
    if expr.startswith("{") and expr.endswith("}"):
        parts = [part.strip() for part in _split_top_level(expr[1:-1]) if part.strip()]
        return [_resolve_constant_expr(part, consts) for part in parts] or [""]
    return [_resolve_constant_expr(expr, consts)]


def _extract_mapping_paths(anno: str, consts: dict[str, str]) -> tuple[str | None, list[str]]:
    method = None
    paths: list[str] = [""]
    if anno.startswith("@GetMapping"):
        method = "GET"
    elif anno.startswith("@PostMapping"):
        method = "POST"
    elif anno.startswith("@PutMapping"):
        method = "PUT"
    elif anno.startswith("@DeleteMapping"):
        method = "DELETE"
    elif anno.startswith("@PatchMapping"):
        method = "PATCH"

    inside = ""
    if "(" in anno and ")" in anno:
        inside = anno[anno.find("(") + 1 : anno.rfind(")")].strip()

    def first_argument(text: str) -> str:
        return _split_top_level(text)[0] if text else ""

    def named_path(text: str) -> str | None:
        m = re.search(r"\b(?:value|path)\s*=\s*", text)
        if not m:
            return None
        rest = text[m.end():]
        if rest.startswith("{"):
            close = _balanced_braces(rest)
            return rest[: close + 1] if close >= 0 else rest
        return _split_top_level(rest)[0]

    if anno.startswith("@RequestMapping"):
        methods = re.findall(r"RequestMethod\.([A-Z]+)", inside)
        method = "/".join(dict.fromkeys(methods)) if methods else ANY_METHOD
    expr = named_path(inside)
    if expr is None and inside and "=" not in first_argument(inside).split('"')[0]:
        expr = first_argument(inside)
    if expr is not None:
        paths = _mapping_paths(expr, consts)
    return method, paths


def _balanced_braces(text: str) -> int:
    depth = 0
    for i, ch in enumerate(text):
        if ch == '"':
            continue
        depth += ch == "{"
        depth -= ch == "}"
        if depth == 0:
            return i
    return -1


def _extract_mapping(anno: str, consts: dict[str, str]) -> tuple[str | None, str]:
    method, paths = _extract_mapping_paths(anno, consts)
    return method, paths[0] if paths else ""


def _split_params(text: str) -> list[str]:
    params: list[str] = []
    cur: list[str] = []
    a = b = c = 0
    for ch in text:
        if ch == "<":
            a += 1
        elif ch == ">":
            a = max(0, a - 1)
        elif ch == "(":
            b += 1
        elif ch == ")":
            b = max(0, b - 1)
        elif ch == "[":
            c += 1
        elif ch == "]":
            c = max(0, c - 1)

        if ch == "," and a == 0 and b == 0 and c == 0:
            p = "".join(cur).strip()
            if p:
                params.append(p)
            cur = []
            continue
        cur.append(ch)
    tail = "".join(cur).strip()
    if tail:
        params.append(tail)
    return params


def _extract_param_type(param: str) -> str | None:
    p = param.strip()
    p = re.sub(r"@\w+(\([^)]*\))?\s*", "", p)
    p = re.sub(r"\bfinal\b\s*", "", p).strip().replace("...", "[]")
    tokens = p.split()
    if len(tokens) < 2:
        return None
    return _short_type(" ".join(tokens[:-1]))


def _extract_method_name(signature: str) -> str:
    m = re.search(r"\b([A-Za-z_][A-Za-z0-9_]*)\s*\(", signature)
    return m.group(1) if m else "unknownMethod"


def _extract_return_type(signature: str) -> str | None:
    sig = re.sub(r"\s+", " ", signature).strip()
    m = re.search(
        r"\bpublic\s+(?:static\s+|final\s+|synchronized\s+|default\s+|abstract\s+)*(.+?)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(",
        sig,
    )
    if not m:
        return None
    type_raw = m.group(1).strip()
    if type_raw.startswith("<"):
        depth = 0
        i = 0
        while i < len(type_raw):
            ch = type_raw[i]
            if ch == "<":
                depth += 1
            elif ch == ">":
                depth -= 1
                if depth == 0:
                    i += 1
                    break
            i += 1
        type_raw = type_raw[i:].strip()
    if not type_raw:
        return None
    return _short_type(type_raw)


def _extract_outer_generic(type_raw: str, outer_name: str) -> str | None:
    t = _short_type(type_raw)
    prefix = f"{outer_name}<"
    if not t.startswith(prefix):
        return None
    i = len(prefix)
    depth = 1
    out: list[str] = []
    while i < len(t):
        ch = t[i]
        if ch == "<":
            depth += 1
            out.append(ch)
        elif ch == ">":
            depth -= 1
            if depth == 0:
                return "".join(out).strip()
            out.append(ch)
        else:
            out.append(ch)
        i += 1
    return None


def _extract_response_type(signature: str) -> str | None:
    return_type = _extract_return_type(signature)
    if not return_type:
        return None

    cur = return_type
    while True:
        inner = _extract_outer_generic(cur, "ResponseEntity")
        if inner is None:
            break
        cur = _short_type(inner)

    inner_api = _extract_outer_generic(cur, "ApiResponse")
    if inner_api is not None:
        return _short_type(inner_api)
    return _short_type(cur)


def _collect_method_body(lines: list[str], start_idx: int) -> tuple[str, int]:
    depth = 0
    started = False
    buf: list[str] = []
    i = start_idx
    while i < len(lines):
        line = lines[i]
        if "{" in line:
            started = True
        if started:
            buf.append(line)
            depth += line.count("{")
            depth -= line.count("}")
            if depth <= 0:
                return ("\n".join(buf), i + 1)
        i += 1
    return ("", i)


def _extract_builder_generic_type(method_body: str) -> str | None:
    if not method_body:
        return None

    pos = 0
    while True:
        m = re.search(r"ApiResponse\s*\.\s*<", method_body[pos:])
        if not m:
            return None
        start = pos + m.end()
        depth = 1
        i = start
        out: list[str] = []
        while i < len(method_body):
            ch = method_body[i]
            if ch == "<":
                depth += 1
                out.append(ch)
            elif ch == ">":
                depth -= 1
                if depth == 0:
                    tail = method_body[i + 1 : i + 64]
                    if "builder" in tail:
                        candidate = "".join(out).strip()
                        return _short_type(candidate) if candidate else None
                    break
                out.append(ch)
            else:
                out.append(ch)
            i += 1
        pos = start


def _extract_result_service_call(method_body: str) -> tuple[str, str, int] | None:
    if not method_body:
        return None

    marker = ".result("
    idx = method_body.find(marker)
    if idx == -1:
        return None

    start = idx + len(marker)
    depth = 1
    i = start
    inner: list[str] = []
    while i < len(method_body):
        ch = method_body[i]
        if ch == "(":
            depth += 1
            inner.append(ch)
        elif ch == ")":
            depth -= 1
            if depth == 0:
                break
            inner.append(ch)
        else:
            inner.append(ch)
        i += 1
    if depth != 0:
        return None

    expr = "".join(inner).strip()
    m = re.match(r"^\s*(?:this\.)?([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)\s*$", expr, re.S)
    if not m:
        return None

    var_name = m.group(1)
    call_name = m.group(2)
    arg_text = m.group(3).strip()
    argc = len(_split_params(arg_text)) if arg_text else 0
    return (var_name, call_name, argc)


def _extract_direct_service_call(method_body: str) -> tuple[str, str, int] | None:
    if not method_body:
        return None

    patterns = [
        r"return\s+ResponseEntity\.[A-Za-z_][A-Za-z0-9_]*\s*\(\s*(?:this\.)?([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*\((.*?)\)\s*\)",
        r"return\s+(?:this\.)?([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*\((.*?)\)\s*;",
    ]
    for pat in patterns:
        m = re.search(pat, method_body, re.S)
        if not m:
            continue
        var_name = m.group(1)
        call_name = m.group(2)
        arg_text = (m.group(3) or "").strip()
        argc = len(_split_params(arg_text)) if arg_text else 0
        return (var_name, call_name, argc)
    return None


def _service_fields_from_controller(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for m in SERVICE_FIELD_RE.finditer(text):
        type_raw = m.group(1).strip()
        name = m.group(2).strip()
        out[name] = _short_type(type_raw)
    return out


def _extract_package_name(text: str) -> str:
    m = PACKAGE_RE.search(text)
    if not m:
        return ""
    return m.group(1).strip()


def _infer_service_name_from_method_body(method_body: str, service_fields: dict[str, str]) -> str:
    call = _extract_result_service_call(method_body) or _extract_direct_service_call(method_body)
    if call is not None:
        var_name, _, _ = call
        service_cls = service_fields.get(var_name, "").strip()
        if service_cls:
            return service_cls

    unique_services = sorted({value.strip() for value in service_fields.values() if value.strip()})
    if len(unique_services) == 1:
        return unique_services[0]
    return ""


def _load_service_method_returns(java_root: Path) -> dict[tuple[str, str, int], str]:
    out: dict[tuple[str, str, int], str] = {}
    for path in java_root.rglob("*Service.java"):
        text = path.read_text(encoding="utf-8", errors="ignore")
        cm = CLASS_RE.search(text)
        if not cm:
            continue
        cls_name = cm.group(1)
        lines = text.splitlines()

        idx = 0
        while idx < len(lines):
            s = lines[idx].strip()
            if not s or s.startswith("@"):
                idx += 1
                continue
            if "public " in s and "(" in s and " class " not in s:
                method_start_idx = idx
                sig = s
                j = idx + 1
                while j < len(lines) and "{" not in sig and ";" not in sig:
                    sig += " " + lines[j].strip()
                    j += 1
                method_body, next_idx = _collect_method_body(lines, method_start_idx)
                idx = next_idx if next_idx > method_start_idx else j

                method_name = _extract_method_name(sig)
                return_type = _extract_return_type(sig)
                if not return_type:
                    continue

                p_start = sig.find("(")
                p_end = sig.rfind(")")
                params_text = sig[p_start + 1 : p_end] if p_start != -1 and p_end > p_start else ""
                argc = len(_split_params(params_text)) if params_text.strip() else 0

                normalized_return_type = _short_type(return_type)
                if normalized_return_type == "Object":
                    inferred = _infer_template_call_return_type(method_body)
                    if inferred:
                        normalized_return_type = inferred

                out[(cls_name, method_name, argc)] = normalized_return_type
                continue
            idx += 1

    return out


def _infer_response_type_from_service_call(
    method_body: str,
    service_fields: dict[str, str],
    service_method_returns: dict[tuple[str, str, int], str],
) -> str | None:
    call = _extract_result_service_call(method_body) or _extract_direct_service_call(method_body)
    if call is None:
        return None

    var_name, call_name, argc = call
    service_cls = service_fields.get(var_name)
    if not service_cls:
        return None

    exact = service_method_returns.get((service_cls, call_name, argc))
    if exact:
        return _short_type(exact)

    candidates = [
        ret
        for (cls_name, method_name, _), ret in service_method_returns.items()
        if cls_name == service_cls and method_name == call_name
    ]
    if len(candidates) == 1:
        return _short_type(candidates[0])
    return None


def _infer_template_call_return_type(method_body: str) -> str | None:
    if not method_body:
        return None

    m = re.search(r"new\s+ParameterizedTypeReference\s*<", method_body)
    if m:
        start = m.end()
        depth = 1
        i = start
        out: list[str] = []
        while i < len(method_body):
            ch = method_body[i]
            if ch == "<":
                depth += 1
                out.append(ch)
            elif ch == ">":
                depth -= 1
                if depth == 0:
                    candidate = "".join(out).strip()
                    return _short_type(candidate) if candidate else None
                out.append(ch)
            else:
                out.append(ch)
            i += 1

    class_refs = re.findall(r"([A-Za-z_][A-Za-z0-9_\.]*)\s*\.class\b", method_body)
    if class_refs:
        return _short_type(class_refs[-1])
    return None


_STRING_CONST_RE = re.compile(
    r"(?:(?:public|protected|private)\s+)?static\s+final\s+String\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?);", re.S
)


def _is_test_source(path: Path) -> bool:
    parts = path.parts
    return any(parts[i] == "src" and i + 1 < len(parts) and parts[i + 1] == "test" for i in range(len(parts)))


def _resolve_const_table(raw: dict[tuple[str, str], str]) -> dict[tuple[str, str], str]:
    """Values of `static final String` constants. An expression may name other constants (`V1 + "/accounts"`,
    `ApiPaths.V1 + "/x"`), resolved within the class first, then by `Class.NAME`, then by a name used only once."""
    by_name: dict[str, list[tuple[str, str]]] = {}
    for key in raw:
        by_name.setdefault(key[1], []).append(key)
    resolved: dict[tuple[str, str], str] = {}

    def lookup(owner: str, token: str) -> tuple[str, str] | None:
        segments = token.split(".")
        if len(segments) >= 2 and (segments[-2], segments[-1]) in raw:
            return (segments[-2], segments[-1])
        if len(segments) == 1:
            if (owner, token) in raw:
                return (owner, token)
            if len(by_name.get(token, [])) == 1:
                return by_name[token][0]
        return None

    def resolve(key: tuple[str, str], stack: frozenset) -> str | None:
        if key in resolved:
            return resolved[key]
        if key in stack:
            return None
        out = ""
        for part in _split_java_concat(raw[key]):
            part = part.strip().strip("()").strip()
            if part.startswith('"') and part.endswith('"'):
                out += bytes(part[1:-1], "utf-8").decode("unicode_escape")
                continue
            target = lookup(key[0], part)
            value = resolve(target, stack | {key}) if target else None
            if value is None:
                return None
            out += value
        resolved[key] = out
        return out

    for key in raw:
        resolve(key, frozenset())
    return resolved


def _load_constants(java_root: Path) -> dict[str, str]:
    """`static final String` constants of the project, keyed `Class.NAME` and, where unambiguous, `NAME`.

    `Constant.java` keeps the older behaviour (`Constant.X` and bare `X` both work); any other class is read the
    same way, so `@RequestMapping(ApiPaths.ACCOUNTS)` resolves wherever `ApiPaths` is declared.
    """
    raw: dict[tuple[str, str], str] = {}
    for path in sorted(java_root.rglob("*.java")):
        if _is_test_source(path):
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if "static final String" not in text:
            continue
        for m in _STRING_CONST_RE.finditer(text):
            raw[(path.stem, m.group(1))] = m.group(2).strip()
    values = _resolve_const_table(raw)

    out: dict[str, str] = {}
    counts: dict[str, int] = {}
    for owner, name in values:
        counts[name] = counts.get(name, 0) + 1
    for (owner, name), value in values.items():
        out[f"{owner}.{name}"] = value
        if owner == "Constant" or counts[name] == 1:
            out.setdefault(name, value)
    return out


def _class_constants(text: str, consts: dict[str, str], class_name: str) -> dict[str, str]:
    """Constants declared in the controller itself, usable by bare name in its own mappings."""
    raw = {(class_name, m.group(1)): m.group(2).strip() for m in _STRING_CONST_RE.finditer(text)}
    if not raw:
        return consts
    local = _resolve_const_table(raw)
    merged = dict(consts)
    for (owner, name), value in local.items():
        merged[name] = value
        merged[f"{owner}.{name}"] = value
    return merged


def _annotation_args(param: str, name: str) -> dict | None:
    """What `@Name(...)` says on a handler parameter: its wire name, whether it is required, whether it has a default."""
    m = re.search(rf"@{name}\b", param)
    if not m:
        return None
    rest = param[m.end():].lstrip()
    args = ""
    if rest.startswith("("):
        depth = 0
        for i, ch in enumerate(rest):
            depth += ch == "("
            depth -= ch == ")"
            if depth == 0:
                args = rest[1:i]
                break
    named = re.search(r'\b(?:value|name)\s*=\s*"([^"]*)"', args) or re.match(r'\s*"([^"]*)"', args)
    required = re.search(r"\brequired\s*=\s*(true|false)\b", args)
    return {
        "name": named.group(1) if named else None,
        "required": None if not required else required.group(1) == "true",
        "default": "defaultValue" in args,
    }


def _param_variable(param: str) -> str | None:
    nm = re.search(r"([A-Za-z_][A-Za-z0-9_]*)\s*$", re.sub(r"@\w+(\([^)]*\))?", "", param).strip())
    return nm.group(1) if nm else None


def _is_map_type(type_raw: str | None) -> bool:
    return bool(type_raw) and bool(re.match(r"(?:java\.util\.)?(?:Map|HashMap|LinkedHashMap|ModelMap)\b", type_raw.strip()))


def _guess_value_type(expr: str) -> str:
    e = expr.strip()
    if e.startswith('"'):
        return "String"
    if e in ("true", "false"):
        return "Boolean"
    if re.fullmatch(r"-?\d+[lL]", e):
        return "Long"
    if re.fullmatch(r"-?\d+", e):
        return "Integer"
    if re.fullmatch(r"-?\d+\.\d+[dDfF]?", e):
        return "Double"
    if "BigDecimal" in e:
        return "BigDecimal"
    if re.search(r"\b(LocalDateTime|LocalDate|OffsetDateTime|Instant)\b", e):
        return "String"
    return "Object"


def _map_response_fields(method_body: str) -> list[FieldSpec]:
    """Keys put into the Map a handler returns (`result.put("jobId", ...); return result;`), the usual eGovFrame shape."""
    returned = re.findall(r"\breturn\s+([A-Za-z_][A-Za-z0-9_]*)\s*;", method_body)
    if not returned:
        return []
    var = re.escape(returned[-1])
    out: list[FieldSpec] = []
    seen: set[str] = set()
    for m in re.finditer(rf'\b{var}\.put\(\s*"([^"]+)"\s*,\s*(.+?)\)\s*;', method_body):
        key = m.group(1)
        if key in seen:
            continue
        seen.add(key)
        out.append(FieldSpec(section="RESPONSE", name_en=key, name_ko=koreanize_identifier(key),
                             data_type=_guess_value_type(m.group(2)), required="Y", note="", path=key, depth=0))
    return out


_EXTENDS_RE = re.compile(r"\bclass\s+[A-Za-z_][A-Za-z0-9_]*(?:\s*<[^{]*?>)?\s+extends\s+([A-Za-z_][A-Za-z0-9_.]*)")


def _class_level(lines: list[str], path: Path, class_name: str, consts: dict[str, str]) -> tuple[str, list]:
    """The class-level `@RequestMapping` base path and security annotations above the class declaration."""
    class_base = ""
    class_security: list = []
    for i, line in enumerate(lines):
        if " class " in f" {line} " and "class " in line:
            j = i - 1
            while j >= 0 and lines[j].strip().startswith("@"):
                j -= 1
            for k in range(j + 1, i):
                anno, _ = _parse_annotation_block(lines, k)
                if anno.startswith("@RequestMapping") and not class_base:
                    _, p = _extract_mapping(anno, consts)
                    class_base = p or ""
                found = security_annotation(anno, path, k + 1, class_name)
                if found:
                    class_security.append(found)
            break
    return class_base, class_security


def _load_service_map_keys(java_root: Path) -> dict[tuple[str, int], list[FieldSpec]]:
    """Keys put into the Map a project method returns, keyed by (method name, argument count).

    A handler that only forwards to a service (`return settleService.run(date);`) has its response keys there.
    A (name, count) used by more than one different implementation is left out rather than guessed.
    """
    found: dict[tuple[str, int], list[list[FieldSpec]]] = {}
    for path in sorted(java_root.rglob("*.java")):
        if _is_test_source(path):
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if "Map<" not in text:
            continue
        lines = text.splitlines()
        for idx, line in enumerate(lines):
            m = re.search(r"\bMap<[^>]*>\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:throws [\w., ]+)?\{?\s*$", line)
            if not m or line.rstrip().endswith(";"):
                continue
            body, _ = _collect_method_body(lines, idx)
            fields = _map_response_fields(body)
            if fields:
                argc = len(_split_params(m.group(2))) if m.group(2).strip() else 0
                found.setdefault((m.group(1), argc), []).append(fields)
    out: dict[tuple[str, int], list[FieldSpec]] = {}
    for key, variants in found.items():
        names = {tuple(f.name_en for f in v) for v in variants}
        if len(names) == 1:
            out[key] = variants[0]
    return out


def _map_fields_from_service(method_body: str, service_map_keys: dict[tuple[str, int], list[FieldSpec]]) -> list[FieldSpec]:
    call = _extract_direct_service_call(method_body)
    if not call:
        return []
    _, name, argc = call
    return [FieldSpec(section=f.section, name_en=f.name_en, name_ko=f.name_ko, data_type=f.data_type, required=f.required,
                      note=f.note, path=f.path, depth=f.depth) for f in service_map_keys.get((name, argc), [])]


def scan_controllers(codebase_path: Path, repo_root: Path) -> list[ApiSeed]:
    java_root = codebase_path / "main/java"
    if not java_root.exists():
        java_root = codebase_path

    consts = _load_constants(java_root)
    service_method_returns = _load_service_method_returns(java_root)
    project_classes = _project_class_names(java_root)
    service_map_keys = _load_service_map_keys(java_root)
    security = SpringSecurityModel.load(
        java_root, lambda source: _controller_display_path(source, repo_root, codebase_path)
    )
    out: list[ApiSeed] = []

    controller_files = [p for p in sorted(java_root.rglob("*Controller.java")) if not _is_test_source(p)]
    texts = {p: p.read_text(encoding="utf-8", errors="ignore") for p in controller_files}
    abstract_paths: dict[str, Path] = {}
    for p, t in texts.items():
        if re.search(r"\babstract\s+class\b", t):
            m = CLASS_RE.search(t)
            abstract_paths[m.group(1) if m else p.stem] = p
    # An abstract base controller has no route of its own: its handlers are served under each subclass's mapping.
    jobs: list[tuple[Path, str, str | None]] = []
    for p in controller_files:
        if p in abstract_paths.values():
            continue
        t = texts[p]
        jobs.append((p, t, None))
        em = _EXTENDS_RE.search(t)
        if em and em.group(1).split(".")[-1] in abstract_paths:
            parent = abstract_paths[em.group(1).split(".")[-1]]
            sub_name = (CLASS_RE.search(t).group(1) if CLASS_RE.search(t) else p.stem)
            sub_base, _ = _class_level(t.splitlines(), p, sub_name, _class_constants(t, consts, sub_name))
            jobs.append((parent, texts[parent], sub_base or ""))

    for path, text, inherited_base in jobs:
        lines = text.splitlines()
        class_match = CLASS_RE.search(text)
        class_name = class_match.group(1) if class_match else path.stem
        local_consts = _class_constants(text, consts, class_name)
        service_fields = _service_fields_from_controller(text)
        package_name = _extract_package_name(text)
        class_base, class_security = _class_level(lines, path, class_name, local_consts)
        if inherited_base:
            class_base = inherited_base

        idx = 0
        pending: list[str] = []
        pending_lines: list[int] = []
        doc_block: list[str] = []
        while idx < len(lines):
            s = lines[idx].strip()
            if not s:
                idx += 1
                continue

            if s.startswith("/*"):
                block = [lines[idx]]
                while "*/" not in lines[idx] and idx + 1 < len(lines):
                    idx += 1
                    block.append(lines[idx])
                doc_block = block
                idx += 1
                continue

            if s.startswith("@"):
                anno, nxt = _parse_annotation_block(lines, idx)
                pending.append(anno)
                pending_lines.append(idx + 1)
                idx = nxt
                continue

            if "public " in s and "(" in s:
                sig = s
                j = idx + 1
                while j < len(lines) and "{" not in sig:
                    sig += " " + lines[j].strip()
                    j += 1
                method_body, next_idx = _collect_method_body(lines, idx)
                idx = next_idx if next_idx > idx else j

                method = None
                mpaths = [""]
                for a in pending:
                    if a.startswith(MAPPING_ANNOS):
                        method, mpaths = _extract_mapping_paths(a, local_consts)
                        if method:
                            break
                method_name = _extract_method_name(sig)
                method_security = [
                    found
                    for found in (
                        security_annotation(a, path, line_no, f"{class_name}.{method_name}")
                        for a, line_no in zip(pending, pending_lines)
                    )
                    if found
                ]
                pending = []
                pending_lines = []
                summary = _javadoc_summary(doc_block)
                doc_block = []
                if not method:
                    continue

                full_paths = list(dict.fromkeys(_join_mapping_path(class_base, mp) for mp in mpaths))

                p_start = sig.find("(")
                p_end = sig.rfind(")")
                params_text = sig[p_start + 1 : p_end] if p_start != -1 and p_end > p_start else ""
                params = _split_params(params_text)

                request_body_type = None
                form_types: list[str] = []
                request_fields: list[FieldSpec] = []

                for p in params:
                    p_clean = p.strip()
                    p_type = _extract_param_type(p_clean)
                    if not p_type:
                        continue

                    if "@RequestBody" in p_clean:
                        request_body_type = p_type
                    elif "@PathVariable" in p_clean:
                        info = _annotation_args(p_clean, "PathVariable") or {}
                        name = info.get("name") or _param_variable(p_clean) or "pathVar"
                        request_fields.append(
                            FieldSpec(
                                section="REQUEST",
                                name_en=name,
                                name_ko=koreanize_identifier(name),
                                data_type=_short_type(p_type),
                                required="N" if info.get("required") is False else "Y",
                                note="path variable",
                            )
                        )
                    elif "@RequestHeader" in p_clean and not _is_map_type(p_type):
                        info = _annotation_args(p_clean, "RequestHeader") or {}
                        name = info.get("name") or _param_variable(p_clean) or "header"
                        request_fields.append(
                            FieldSpec(
                                section="REQUEST",
                                name_en=name,
                                name_ko=koreanize_identifier(name),
                                data_type=_short_type(p_type),
                                required="N" if info.get("required") is False or info.get("default") else "Y",
                                note="request header",
                            )
                        )
                    elif "@RequestParam" in p_clean and not _is_map_type(p_type):
                        info = _annotation_args(p_clean, "RequestParam") or {}
                        name = info.get("name") or _param_variable(p_clean) or "queryParam"
                        request_fields.append(
                            FieldSpec(
                                section="REQUEST",
                                name_en=name,
                                name_ko=koreanize_identifier(name),
                                data_type=_short_type(p_type),
                                required="N" if info.get("required") is False or info.get("default") else "Y",
                                note="request param",
                            )
                        )
                    elif _form_object_type(p_clean, p_type, project_classes):
                        form_type = re.sub(r"<.*", "", p_type).strip()
                        if form_type not in form_types:
                            form_types.append(form_type)
                    elif re.sub(r"<.*", "", p_type).strip() in SIMPLE_PARAM_TYPES and not any(
                        anno in p_clean for anno in NON_FORM_PARAM_ANNOS
                    ):
                        # Spring binds an un-annotated simple argument as an optional request parameter.
                        nm = re.search(r"([A-Za-z_][A-Za-z0-9_]*)\s*$", re.sub(r"@\w+(\([^)]*\))?", "", p_clean).strip())
                        name = nm.group(1) if nm else "queryParam"
                        request_fields.append(
                            FieldSpec(
                                section="REQUEST",
                                name_en=name,
                                name_ko=koreanize_identifier(name),
                                data_type=_short_type(p_type),
                                required="N",
                                note="request param",
                            )
                        )
                query_dto_type = ", ".join(form_types) or None

                response_type = _extract_response_type(sig)
                if response_type in {None, "Object"}:
                    builder_type = _extract_builder_generic_type(method_body)
                    if builder_type:
                        response_type = builder_type
                if response_type in {None, "Object"}:
                    inferred = _infer_response_type_from_service_call(method_body, service_fields, service_method_returns)
                    if inferred:
                        response_type = inferred
                map_fields = _map_response_fields(method_body) if _is_map_type(response_type) else []
                if _is_map_type(response_type) and not map_fields:
                    map_fields = _map_fields_from_service(method_body, service_map_keys)
                service_name = _infer_service_name_from_method_body(method_body, service_fields)

                for full_path in full_paths:
                    auth = security.decide(method, full_path, method_security, class_security)
                    note = "; ".join(n for n in (ANY_METHOD_NOTE if method == ANY_METHOD else "", auth.note) if n)
                    out.append(
                        ApiSeed(
                            method=method.upper(),
                            path=full_path,
                            controller_file=_controller_display_path(path, repo_root, codebase_path),
                            package_name=package_name,
                            service_name=service_name,
                            controller_line=idx,
                            method_name=method_name,
                            request_body_type=request_body_type,
                            query_dto_type=query_dto_type,
                            response_type=response_type,
                            auth_required=auth.auth_required,
                            request_fields=list(request_fields),
                            summary=summary,
                            note=note,
                            auth_evidence=auth.evidence,
                            response_fields=list(map_fields),
                        )
                    )
                continue

            if pending and not s.startswith("@"):
                pending = []
                pending_lines = []
            if not s.startswith("//"):
                doc_block = []
            idx += 1

    return out


def to_api_endpoints(seeds: list[ApiSeed]) -> list[ApiEndpoint]:
    endpoints: list[ApiEndpoint] = []
    for s in seeds:
        key = f"{s.method} {s.path}"
        endpoints.append(
            ApiEndpoint(
                method=s.method,
                path=s.path,
                api_key=key,
                controller_file=s.controller_file,
                package_name=s.package_name,
                service_name=s.service_name,
                controller_line=s.controller_line,
                method_name=s.method_name,
                request_body_type=s.request_body_type,
                query_dto_type=s.query_dto_type,
                response_type=s.response_type,
                auth_required=s.auth_required,
                auth_evidence=list(s.auth_evidence),
                interface_name=s.summary or None,
                note=s.note,
                request_fields=list(s.request_fields),
                response_fields=list(s.response_fields),
            )
        )
    return endpoints
