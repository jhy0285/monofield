from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

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
    auth_required: bool
    request_fields: list[FieldSpec]


def _controller_display_path(path: Path, repo_root: Path, codebase_path: Path) -> str:
    for base in (repo_root, codebase_path):
        try:
            return str(path.relative_to(base))
        except ValueError:
            continue
    return str(path)


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
        else:
            out += p.strip("'")
    return out


def _extract_mapping(anno: str, consts: dict[str, str]) -> tuple[str | None, str]:
    method = None
    path = ""
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

    if anno.startswith("@RequestMapping"):
        mm = re.search(r"method\s*=\s*RequestMethod\.([A-Z]+)", inside)
        if mm:
            method = mm.group(1)
        mv = re.search(r"(?:value|path)\s*=\s*([^,]+)", inside)
        if mv:
            path = _resolve_constant_expr(mv.group(1), consts)
        elif inside and "=" not in inside.split(",", 1)[0]:
            path = _resolve_constant_expr(inside.split(",", 1)[0], consts)
    else:
        if inside:
            mv = re.search(r"(?:value|path)\s*=\s*([^,]+)", inside)
            if mv:
                path = _resolve_constant_expr(mv.group(1), consts)
            elif "=" not in inside:
                path = _resolve_constant_expr(inside, consts)

    return method, path


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


def _load_constants(java_root: Path) -> dict[str, str]:
    constant_files = sorted(java_root.rglob('Constant.java'))
    if not constant_files:
        return {}

    raw: dict[str, str] = {}
    for const_path in constant_files:
        text = const_path.read_text(encoding="utf-8", errors="ignore")
        for m in CONST_RE.finditer(text):
            raw[m.group(1)] = m.group(2).strip()

    resolved: dict[str, str] = {}

    def resolve(name: str, stack: set[str]) -> str:
        if name in resolved:
            return resolved[name]
        if name in stack:
            return ""
        stack.add(name)
        expr = raw.get(name, "")
        if not expr:
            resolved[name] = ""
            return ""

        def repl(match: re.Match[str]) -> str:
            k = match.group(1)
            return f'"{resolve(k, stack)}"'

        expr2 = re.sub(r"Constant\.([A-Za-z_][A-Za-z0-9_]*)", repl, expr)
        for k in sorted(raw.keys(), key=len, reverse=True):
            replacement = f'"{resolve(k, stack)}"'
            expr2 = re.sub(rf"\b{k}\b", lambda _m, value=replacement: value, expr2)

        parts = _split_java_concat(expr2)
        out = ""
        for p in parts:
            if p.startswith('"') and p.endswith('"'):
                out += bytes(p[1:-1], "utf-8").decode("unicode_escape")
            else:
                out += p
        resolved[name] = out
        return out

    for k in raw:
        resolve(k, set())
    return resolved


def scan_controllers(codebase_path: Path, repo_root: Path) -> list[ApiSeed]:
    java_root = codebase_path / "main/java"
    if not java_root.exists():
        java_root = codebase_path

    consts = _load_constants(java_root)
    service_method_returns = _load_service_method_returns(java_root)
    out: list[ApiSeed] = []

    for path in java_root.rglob("*Controller.java"):
        text = path.read_text(encoding="utf-8", errors="ignore")
        lines = text.splitlines()
        class_base = ""
        service_fields = _service_fields_from_controller(text)
        package_name = _extract_package_name(text)

        for i, line in enumerate(lines):
            if " class " in f" {line} " and "class " in line:
                j = i - 1
                while j >= 0 and lines[j].strip().startswith("@"):
                    j -= 1
                for k in range(j + 1, i):
                    s = lines[k].strip()
                    if s.startswith("@RequestMapping"):
                        anno, _ = _parse_annotation_block(lines, k)
                        _, p = _extract_mapping(anno, consts)
                        class_base = p or ""
                        break
                break

        idx = 0
        pending: list[str] = []
        while idx < len(lines):
            s = lines[idx].strip()
            if not s:
                idx += 1
                continue

            if s.startswith("@"):
                anno, nxt = _parse_annotation_block(lines, idx)
                pending.append(anno)
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
                mpath = ""
                for a in pending:
                    if a.startswith(MAPPING_ANNOS):
                        method, mpath = _extract_mapping(a, consts)
                        if method:
                            break
                pending = []
                if not method:
                    continue

                full_path = (class_base.rstrip("/") + "/" + mpath.lstrip("/")).replace("//", "/")
                if not full_path.startswith("/"):
                    full_path = "/" + full_path

                p_start = sig.find("(")
                p_end = sig.rfind(")")
                params_text = sig[p_start + 1 : p_end] if p_start != -1 and p_end > p_start else ""
                params = _split_params(params_text)

                request_body_type = None
                query_dto_type = None
                request_fields: list[FieldSpec] = []

                for p in params:
                    p_clean = p.strip()
                    p_type = _extract_param_type(p_clean)
                    if not p_type:
                        continue

                    if "@RequestBody" in p_clean:
                        request_body_type = p_type
                    elif "@PathVariable" in p_clean:
                        nm = re.search(r"([A-Za-z_][A-Za-z0-9_]*)\s*$", re.sub(r"@\w+(\([^)]*\))?", "", p_clean).strip())
                        name = nm.group(1) if nm else "pathVar"
                        request_fields.append(
                            FieldSpec(
                                section="REQUEST",
                                name_en=name,
                                name_ko=koreanize_identifier(name),
                                data_type="String",
                                required="Y",
                                note="path variable",
                            )
                        )
                    elif "@RequestParam" in p_clean:
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
                    else:
                        if p_type.endswith(("Dto", "Form", "SearchDto", "FormDto")) and query_dto_type is None:
                            query_dto_type = p_type

                method_name = _extract_method_name(sig)
                response_type = _extract_response_type(sig)
                if response_type in {None, "Object"}:
                    builder_type = _extract_builder_generic_type(method_body)
                    if builder_type:
                        response_type = builder_type
                if response_type in {None, "Object"}:
                    inferred = _infer_response_type_from_service_call(method_body, service_fields, service_method_returns)
                    if inferred:
                        response_type = inferred
                auth_required = any(x in full_path for x in ["/api/v1/"])
                service_name = _infer_service_name_from_method_body(method_body, service_fields)

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
                        auth_required=auth_required,
                        request_fields=request_fields,
                    )
                )
                continue

            if pending and not s.startswith("@"):
                pending = []
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
                request_fields=list(s.request_fields),
                response_fields=[],
            )
        )
    return endpoints
