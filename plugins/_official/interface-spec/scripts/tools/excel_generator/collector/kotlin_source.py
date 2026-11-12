"""Spring MVC controllers and DTOs written in Kotlin.

Kotlin sources are read into the same shapes as Java ones: DTOs become `JavaClass` entries (so expansion, enum values,
defaults and evidence work unchanged) and handlers become `ApiSeed`s. What differs is the syntax: `name: Type`
parameters, `?` for values that may be absent, `[...]` array literals in annotations, data classes whose primary
constructor is the field list, expression bodies (`fun f() = ...`) and `mapOf("k" to v)` responses.

Stdlib only, like every interface-spec scanner. Not read: WebFlux functional routers (`coRouter`), Ktor, and types
that are only known after Kotlin's type inference across files.
"""

from __future__ import annotations

import re
from pathlib import Path

from tools.excel_generator.collector.controller_scanner import (
    ANY_METHOD,
    ANY_METHOD_NOTE,
    FRAMEWORK_PARAM_TYPES,
    NON_FORM_PARAM_ANNOS,
    QUERY_DTO_SUFFIXES,
    SIMPLE_PARAM_TYPES,
    ApiSeed,
    _annotation_args,
    _controller_display_path,
    _extract_mapping_paths,
    _javadoc_summary,
    _join_mapping_path,
    mapping_condition,
)
from tools.excel_generator.collector.dto_expander import (
    JavaClass,
    JavaField,
    _enum_json_values,
    _explicit_json_name,
    _strip_comments,
    _wire_name,
)
from tools.excel_generator.collector.spring_security import (
    NON_PRODUCTION_DIRS,
    SpringSecurityModel,
    security_annotation,
)
from tools.excel_generator.models import FieldSpec
from tools.excel_generator.rules.naming import koreanize_identifier

_KOTLIN_TYPES = {
    "Int": "Integer", "Long": "Long", "Short": "Short", "Byte": "Byte", "Double": "Double", "Float": "Float",
    "Boolean": "Boolean", "Char": "Character", "String": "String", "Any": "Object", "Unit": "void", "Nothing": "void",
    "List": "List", "MutableList": "List", "ArrayList": "List", "Collection": "List", "Iterable": "List",
    "Set": "Set", "MutableSet": "Set", "HashSet": "Set", "Map": "Map", "MutableMap": "Map", "HashMap": "Map",
    "LinkedHashMap": "Map", "Array": "List", "IntArray": "List<Integer>", "LongArray": "List<Long>",
}
_MODIFIERS = {
    "public", "private", "internal", "protected", "open", "final", "abstract", "override", "suspend", "inline",
    "operator", "infix", "tailrec", "external", "data", "enum", "sealed", "inner", "value", "annotation", "lateinit",
    "const", "vararg", "noinline", "crossinline", "actual", "expect",
}
_CONTROLLER_RE = re.compile(r"^\s*@(?:[\w.]+\.)?(?:Rest)?Controller\b(?!Advice)", re.M)
_CLASS_DECL_RE = re.compile(r"\b((?:(?:" + "|".join(sorted(_MODIFIERS)) + r")\s+)*)(class|object|interface)\s+([A-Za-z_]\w*)")
_FUN_RE = re.compile(r"\bfun\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?([A-Za-z_]\w*)\s*\(")
_CONST_VAL_RE = re.compile(r"\bconst\s+val\s+([A-Za-z_]\w*)\s*(?::\s*String)?\s*=\s*(\"(?:[^\"\\]|\\.)*\")")
_PROPERTY_RE = re.compile(r"^((?:@[^\n]*?\s+)*)((?:(?:" + "|".join(sorted(_MODIFIERS)) + r")\s+)*)(val|var)\s+([A-Za-z_]\w*)"
                          r"\s*(?::\s*([^=\n]+?))?\s*(?:=\s*(.+))?$")


# --- lexical helpers ---------------------------------------------------------------------------------------------


def _skip_string(text: str, i: int) -> int:
    """Index just after the string or char literal starting at `i` (raw `\"\"\"` strings included)."""
    if text.startswith('"""', i):
        end = text.find('"""', i + 3)
        return len(text) if end < 0 else end + 3
    quote = text[i]
    j = i + 1
    while j < len(text) and text[j] != quote:
        j += 2 if text[j] == "\\" else 1
    return j + 1


def _close(text: str, i: int) -> int:
    """Index of the bracket closing the one at `i`, skipping literals; -1 when unbalanced."""
    pairs = {"(": ")", "[": "]", "{": "}", "<": ">"}
    stack: list[str] = []
    j = i
    while j < len(text):
        ch = text[j]
        if ch in "\"'":
            j = _skip_string(text, j)
            continue
        if ch in "([{" or (ch == "<" and text[i] == "<"):
            stack.append(pairs[ch])
        elif stack and ch == stack[-1]:
            stack.pop()
            if not stack:
                return j
        j += 1
    return -1


def _split_top(text: str, sep: str = ",") -> list[str]:
    parts: list[str] = []
    depth = 0
    start = j = 0
    while j < len(text):
        ch = text[j]
        if ch in "\"'":
            j = _skip_string(text, j)
            continue
        if ch in "([{<":
            depth += 1
        elif ch in ")]}>" and depth:
            depth -= 1
        elif ch == sep and depth == 0:
            parts.append(text[start:j].strip())
            start = j + 1
        j += 1
    tail = text[start:].strip()
    if tail:
        parts.append(tail)
    return parts


def _leading_annotations(text: str) -> tuple[list[str], str]:
    """`@A @B("x") val y: T` -> (["@A", '@B("x")'], "val y: T"), with use-site targets (`@field:`, `@get:`) dropped."""
    out: list[str] = []
    rest = text.lstrip()
    while rest.startswith("@"):
        m = re.match(r"@(?:(?:field|get|set|param|property|setparam|delegate|file|receiver):)?([A-Za-z_][\w.]*)", rest)
        if not m:
            break
        end = m.end()
        after = rest[end:]
        stripped = after.lstrip()
        if stripped.startswith("("):
            open_at = end + (len(after) - len(stripped))
            close = _close(rest, open_at)
            if close < 0:
                break
            end = close + 1
        out.append(_javaish_annotation("@" + m.group(1) + rest[m.end():end]))
        rest = rest[end:].lstrip()
    return out, rest


def _javaish_annotation(anno: str) -> str:
    """Kotlin annotation arguments in Java spelling, so the Java helpers read them: `[a, b]` and `arrayOf(a, b)`
    become `{a, b}`."""
    out: list[str] = []
    j = 0
    while j < len(anno):
        ch = anno[j]
        if ch in "\"'":
            end = _skip_string(anno, j)
            out.append(anno[j:end])
            j = end
            continue
        if anno.startswith("arrayOf(", j):
            close = _close(anno, j + len("arrayOf"))
            out.append("{" + anno[j + len("arrayOf("):close] + "}")
            j = close + 1
            continue
        out.append({"[": "{", "]": "}"}.get(ch, ch))
        j += 1
    return "".join(out)


def _annotations_before(code: str, pos: int) -> list[str]:
    """Annotations written directly before the declaration at `pos` (modifiers in between are skipped)."""
    found: list[str] = []
    j = pos
    while True:
        k = j
        while k > 0 and code[k - 1].isspace():
            k -= 1
        word = re.search(r"([A-Za-z_]\w*)$", code[:k])
        if word and word.group(1) in _MODIFIERS and (word.start() == 0 or code[word.start() - 1] != "@"):
            j = word.start()
            continue
        end = k
        if k > 0 and code[k - 1] == ")":
            # walk back to the matching "(" (annotation arguments), skipping string contents
            depth = 0
            i = k - 1
            in_str = False
            while i >= 0:
                ch = code[i]
                if ch == '"' and (i == 0 or code[i - 1] != "\\"):
                    in_str = not in_str
                elif not in_str:
                    if ch == ")":
                        depth += 1
                    elif ch == "(":
                        depth -= 1
                        if depth == 0:
                            break
                i -= 1
            if i < 0:
                break
            k = i
            while k > 0 and code[k - 1].isspace():
                k -= 1
        name = re.search(r"@(?:(?:field|get|set|param|property):)?[A-Za-z_][\w.]*$", code[:k])
        if not name:
            break
        found.insert(0, _javaish_annotation(code[name.start():end]))
        j = name.start()
    return found


def _kdoc_before(raw: str, pos: int) -> str:
    """The first line of the KDoc (`/** ... */`) that ends right before `pos`, or ""."""
    head = raw[:pos].rstrip()
    if not head.endswith("*/"):
        return ""
    start = head.rfind("/**")
    if start < 0 or "*/" in head[start:-2]:
        return ""
    return _javadoc_summary(head[start:].splitlines())


def _strip_use_site(anno: str) -> str:
    return re.sub(r"^@(?:field|get|set|param|property|setparam|delegate):", "@", anno)


def java_type(kotlin_type: str) -> str:
    """A Kotlin type written the way the interface spec writes Java types: `Int` -> `Integer`, `List<Foo>?` ->
    `List<Foo>`."""
    t = re.sub(r"\s+", " ", (kotlin_type or "").strip()).rstrip("?").strip()
    if not t:
        return "Object"

    def one(token: str) -> str:
        token = token.strip().rstrip("?").strip()
        m = re.match(r"([\w.]+)\s*(?:<(.*)>)?$", token)
        if not m:
            return token
        name = m.group(1).split(".")[-1]
        args = _split_top(m.group(2)) if m.group(2) else []
        mapped = _KOTLIN_TYPES.get(name, name)
        args = [one(re.sub(r"^(?:out|in)\s+", "", a)) for a in args if a.strip() != "*"]
        if name == "Array" and args:
            return f"List<{args[0]}>"
        if "<" in mapped:
            return mapped
        return f"{mapped}<{', '.join(args)}>" if args else mapped

    return one(t)


def is_nullable(kotlin_type: str) -> bool:
    return (kotlin_type or "").strip().endswith("?")


def production_kotlin_files(root: Path) -> list[Path]:
    return sorted(
        path for path in root.rglob("*.kt")
        if not NON_PRODUCTION_DIRS.intersection(path.relative_to(root).parts[:-1])
        and not any(part == "src" and nxt == "test" for part, nxt in zip(path.parts, path.parts[1:]))
    )


# --- classes ------------------------------------------------------------------------------------------------------


def _declaration_parts(code: str, m: re.Match[str]) -> tuple[str, str, str, int]:
    """(constructor parameters, supertypes, body, end) of the class declared at `m`."""
    ctor, supertypes, body, end, _ctor_at, _body_at = _declaration_spans(code, m)
    return ctor, supertypes, body, end


def _declaration_spans(code: str, m: re.Match[str]) -> tuple[str, str, str, int, int, int]:
    """`_declaration_parts` plus where the constructor parameters and the body start in `code`."""
    ctor_at = body_at = -1
    j = m.end()
    while j < len(code) and code[j].isspace():
        j += 1
    if j < len(code) and code[j] == "<":
        close = _close(code, j)
        j = close + 1 if close > 0 else j
    k = j
    ctor = ""
    rest = code[k:]
    pm = re.match(r"\s*(?:(?:private|internal|protected|public)\s+)?(?:@\w+\s+)*(?:constructor\s*)?\(", rest)
    if pm:
        open_at = k + pm.end() - 1
        close = _close(code, open_at)
        if close > 0:
            ctor = code[open_at + 1:close]
            ctor_at = open_at + 1
            k = close + 1
    supertypes = ""
    sm = re.match(r"\s*:\s*", code[k:])
    if sm:
        start = k + sm.end()
        i = start
        while i < len(code) and code[i] not in "{\n":
            if code[i] in "(<":
                close = _close(code, i)
                i = close + 1 if close > 0 else i + 1
                continue
            i += 1
        supertypes = code[start:i].strip()
        k = i
    bm = re.match(r"\s*\{", code[k:])
    body = ""
    end = k
    if bm:
        open_at = k + bm.end() - 1
        close = _close(code, open_at)
        if close > 0:
            body = code[open_at + 1:close]
            body_at = open_at + 1
            end = close + 1
    return ctor, supertypes, body, end, ctor_at, body_at


def _depth0(body: str) -> str:
    """The class body with nested blocks blanked out, so only its own members remain (line breaks kept)."""
    out: list[str] = []
    depth = 0
    j = 0
    while j < len(body):
        ch = body[j]
        if ch in "\"'":
            end = _skip_string(body, j)
            out.append(body[j:end] if depth == 0 else re.sub(r"[^\n]", " ", body[j:end]))
            j = end
            continue
        if ch == "{":
            depth += 1
            out.append(" ")
        elif ch == "}":
            depth = max(0, depth - 1)
            out.append(" ")
        else:
            out.append(ch if depth == 0 or ch == "\n" else " ")
        j += 1
    return "".join(out)


def _comment_words(raw: str) -> str:
    """The first descriptive line of a KDoc, block or line comment (`/** 회원 ID */` -> `회원 ID`)."""
    for line in raw.splitlines():
        text = re.sub(r"^\s*(?:/\*+|\*+(?!/)|//+)\s*", "", line)
        text = re.sub(r"\s*\*+/\s*$", "", text).strip()
        if text and not text.startswith("@"):
            return text
    return ""


def _split_spans(text: str) -> list[tuple[int, int]]:
    """Where `_split_top` would cut `text` at top-level commas, as (start, end) spans."""
    spans: list[tuple[int, int]] = []
    depth = 0
    start = j = 0
    while j < len(text):
        ch = text[j]
        if ch in "\"'":
            j = _skip_string(text, j)
            continue
        if ch in "([{<":
            depth += 1
        elif ch in ")]}>" and depth:
            depth -= 1
        elif ch == "," and depth == 0:
            spans.append((start, j))
            start = j + 1
        j += 1
    if text[start:].strip():
        spans.append((start, len(text)))
    return spans


def _ctor_comments(code_ctor: str, raw_ctor: str) -> list[str]:
    """The comment written before each constructor parameter, in order (comments are blanked in `code_ctor`)."""
    out = []
    for start, end in _split_spans(code_ctor):
        part = code_ctor[start:end]
        lead = len(part) - len(part.lstrip())
        out.append(_comment_words(raw_ctor[start:start + lead]))
    return out


def _ctor_properties(ctor: str) -> list[tuple[list[str], str, str, str | None, bool]]:
    """(annotations, name, type, default, is_property) for each primary-constructor parameter."""
    out = []
    for part in _split_top(ctor):
        anns, rest = _leading_annotations(part)
        words = rest.split()
        is_property = False
        while words and (words[0] in _MODIFIERS or words[0] in ("val", "var")):
            is_property = is_property or words[0] in ("val", "var")
            words.pop(0)
        decl = " ".join(words)
        m = re.match(r"([A-Za-z_]\w*)\s*:\s*(.+?)(?:\s*=\s*(.+))?$", decl, re.S)
        if not m:
            continue
        out.append(([_strip_use_site(a) for a in anns], m.group(1), m.group(2).strip(), m.group(3), is_property))
    return out


def _literal_type(expr: str) -> str:
    e = (expr or "").strip()
    if e.startswith('"'):
        return "String"
    if e in ("true", "false"):
        return "Boolean"
    if re.fullmatch(r"-?\d+[lL]", e):
        return "Long"
    if re.fullmatch(r"-?\d+", e):
        return "Integer"
    if re.fullmatch(r"-?\d+\.\d+[fF]?", e):
        return "Double"
    return "Object"


def _parse_kotlin_class(code: str, m: re.Match[str], path: Path, package: str, raw: str = "") -> JavaClass | None:
    modifiers = set(m.group(1).split())
    kind, name = m.group(2), m.group(3)
    if kind == "interface":
        return None
    ctor, supertypes, body, _end, ctor_at, body_at = _declaration_spans(code, m)
    raw = raw or code
    params = _ctor_properties(ctor)
    comments = _ctor_comments(ctor, raw[ctor_at:ctor_at + len(ctor)]) if ctor_at >= 0 else []
    if "enum" in modifiers:
        return _parse_enum_class(name, params, body, path, package)
    fields: list[JavaField] = []
    param_comments = dict(zip((p[1] for p in _ctor_properties(ctor)), comments)) if len(comments) == len(params) else {}
    for anns, pname, ptype, default, is_property in params:
        if not is_property:
            continue
        annotations = list(anns)
        # jackson-module-kotlin rejects a body that omits a non-null constructor value without a default.
        if not is_nullable(ptype) and default is None and not any(a.startswith(("@NotNull", "@NotBlank", "@NotEmpty")) for a in annotations):
            annotations.append("@NotNull")
        fields.append(JavaField(name=pname, type_raw=java_type(ptype), annotations=annotations, comment=param_comments.get(pname, ""),
                                json_name=_wire_name(pname, annotations, False), initializer=default or ""))
    own = _depth0(body)
    raw_lines = raw[body_at:body_at + len(body)].splitlines() if body_at >= 0 else []
    own_lines = own.splitlines()
    for index, line in enumerate(own_lines):
        anns, rest = _leading_annotations(line.strip())
        pm = re.match(r"((?:(?:" + "|".join(sorted(_MODIFIERS)) + r")\s+)*)(val|var)\s+([A-Za-z_]\w*)\s*(?::\s*([^=]+?))?\s*(?:=\s*(.+))?$",
                      rest.strip())
        if not pm or {"private", "protected", "const"} & set(pm.group(1).split()):
            continue
        if pm.group(5) is None and pm.group(4) is None:
            continue
        ptype = pm.group(4) or _literal_type(pm.group(5) or "")
        annotations = [_strip_use_site(a) for a in anns]
        # the comment lines right above (blank in `own`, written in the raw source)
        above: list[str] = []
        k = index - 1
        while k >= 0 and k < len(raw_lines) and not own_lines[k].strip() and raw_lines[k].strip():
            above.insert(0, raw_lines[k])
            k -= 1
        fields.append(JavaField(name=pm.group(3), type_raw=java_type(ptype), annotations=annotations, comment=_comment_words("\n".join(above)),
                                json_name=_wire_name(pm.group(3), annotations, False), initializer=(pm.group(5) or "").strip()))
    extends = None
    for sup in _split_top(supertypes):
        sm = re.match(r"([\w.]+)\s*(?:<[^(]*>)?\s*\(", sup)
        if sm:
            extends = sm.group(1).split(".")[-1]
            break
    snake = bool(re.search(r"@(?:[\w.]*\.)?JsonNaming\s*\(\s*(?:[\w.]*\.)?(?:SnakeCaseStrategy|SNAKE_CASE)", " ".join(_annotations_before(code, m.start()))))
    if snake:
        for f in fields:
            f.json_name = _wire_name(f.name, f.annotations, True)
    root = next((r.group(1) for a in _annotations_before(code, m.start())
                 if (r := re.search(r'@(?:[\w.]*\.)?JsonRootName\s*\(\s*(?:value\s*=\s*)?"([^"]+)"', a))), "")
    return JavaClass(name=name, path=path, package=package, extends=extends, fields=fields, snake_case=snake, json_root=root)


def _parse_enum_class(name: str, params: list, body: str, path: Path, package: str) -> JavaClass:
    # constants run up to the first ';' outside brackets, or the whole body
    depth = 0
    end = len(body)
    j = 0
    while j < len(body):
        ch = body[j]
        if ch in "\"'":
            j = _skip_string(body, j)
            continue
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif ch == ";" and depth == 0:
            end = j
            break
        j += 1
    constants: list[tuple[str, list[str], list[str]]] = []
    for part in _split_top(body[:end]):
        anns, rest = _leading_annotations(part)
        cm = re.match(r"([A-Za-z_]\w*)\s*(\(.*?\))?\s*(?:\{.*\})?\s*$", rest, re.S)
        if cm:
            constants.append((cm.group(1), anns, _split_top(cm.group(2)[1:-1]) if cm.group(2) else []))
    value_index = next((i for i, (anns, *_rest) in enumerate(params) if any(a.startswith("@JsonValue") for a in anns)), -1)
    if value_index < 0:
        getter = re.search(r"@JsonValue\s+(?:\w+\s+)*fun\s+\w+\s*\(\s*\)\s*(?::\s*\w+\??\s*)?(?:=\s*|\{\s*return\s+)(?:this\.)?(\w+)", body)
        if getter:
            value_index = next((i for i, p in enumerate(params) if p[1] == getter.group(1)), -1)
    mapping: dict[str, str] = {}
    for const, anns, args in constants:
        explicit = _explicit_json_name(anns)
        literal = re.match(r'^"((?:\\.|[^"\\])*)"$', args[value_index].strip()) if 0 <= value_index < len(args) else None
        mapping[const] = explicit or (literal.group(1) if literal else const)
    return JavaClass(name=name, path=path, package=package, extends=None, enum_constants=mapping)


def parse_kotlin_classes(root: Path) -> dict[str, JavaClass]:
    classes: dict[str, JavaClass] = {}
    for path in production_kotlin_files(root):
        raw = path.read_text(encoding="utf-8", errors="ignore")
        code = _strip_comments(raw)
        pm = re.search(r"^\s*package\s+([\w.]+)", code, re.M)
        package = pm.group(1) if pm else ""
        for m in _CLASS_DECL_RE.finditer(code):
            parsed = _parse_kotlin_class(code, m, path, package, raw)
            if parsed is not None:
                classes.setdefault(parsed.name, parsed)
    return classes


# --- controllers --------------------------------------------------------------------------------------------------


def _service_returns(root: Path) -> dict[str, dict[str, str]]:
    """Declared return types of functions, by class (`"ArticleService" -> {"getArticles": "List<ArticleDto>"}`) and,
    under "", by name alone for receivers whose type is unknown. Controllers are left out of the by-name table so a
    handler never stands in for the service method of the same name."""
    out: dict[str, dict[str, str]] = {"": {}}
    for path in production_kotlin_files(root):
        code = _strip_comments(path.read_text(encoding="utf-8", errors="ignore"))
        is_controller = bool(_CONTROLLER_RE.search(code))
        decls = [(m.start(), m.group(3)) for m in _CLASS_DECL_RE.finditer(code)]
        for m in _FUN_RE.finditer(code):
            close = _close(code, m.end() - 1)
            if close < 0:
                continue
            rm = re.match(r"\s*:\s*([\w.<>, ?*]+?)\s*(?:=|\{|$)", code[close + 1:close + 200], re.M)
            if not rm:
                continue
            owner = next((name for pos, name in reversed(decls) if pos < m.start()), "")
            out.setdefault(owner, {}).setdefault(m.group(1), java_type(rm.group(1)))
            if not is_controller:
                out[""].setdefault(m.group(1), java_type(rm.group(1)))
    return out


def _unwrap_response(type_text: str | None) -> str | None:
    if not type_text:
        return None
    t = java_type(type_text)
    m = re.fullmatch(r"(?:ResponseEntity|HttpEntity|Optional|Mono|CompletableFuture|Callable)<(.+)>", t)
    if m:
        t = m.group(1).strip()
    if t in ("void", "Void", "Object", "?") or t.startswith("ResponseEntity"):
        return None
    return t


def _expr_type(expr: str, locals_: dict[str, str], returns: dict[str, dict[str, str]],
               receivers: dict[str, str] | None = None) -> str | None:
    e = expr.strip()
    lit = _literal_type(e)
    if lit != "Object":
        return lit
    if re.search(r"\.(?:size|count\(\)|length)$", e):
        return "Integer"
    if e in locals_:
        return locals_[e]
    call = re.search(r"(?:([A-Za-z_]\w*)\s*\.\s*)?([A-Za-z_]\w*)\s*\([^()]*\)\s*$", e)
    if call:
        owner = (receivers or {}).get(call.group(1) or "")
        found = returns.get(owner or "", {}).get(call.group(2)) if owner else None
        if found or call.group(2) in returns.get("", {}):
            return found or returns[""][call.group(2)]
    ctor = re.match(r"([A-Z]\w*)\s*\(", e)
    if ctor:
        return ctor.group(1)
    return None


def _map_fields(body: str, value_type: str | None, locals_: dict[str, str], returns: dict[str, dict[str, str]],
                receivers: dict[str, str]) -> list[FieldSpec]:
    """Keys of a `mapOf("k" to v, ...)` the handler returns, typed from the value expression or the map's type."""
    fields: list[FieldSpec] = []
    seen: set[str] = set()
    for m in re.finditer(r"\b(?:mapOf|hashMapOf|mutableMapOf|linkedMapOf)\s*\(", body):
        close = _close(body, m.end() - 1)
        if close < 0:
            continue
        for pair in _split_top(body[m.end():close]):
            pm = re.match(r'"((?:\\.|[^"\\])*)"\s+to\s+(.+)$', pair, re.S)
            if not pm or pm.group(1) in seen:
                continue
            seen.add(pm.group(1))
            guessed = _expr_type(pm.group(2), locals_, returns, receivers)
            data_type = guessed or (value_type if value_type not in (None, "Object") else "Object")
            fields.append(FieldSpec(section="RESPONSE", name_en=pm.group(1), name_ko=koreanize_identifier(pm.group(1)),
                                    data_type=data_type, required="Y", note="", path=pm.group(1), parent_path=None, depth=0))
    return fields


def _local_types(body: str, returns: dict[str, dict[str, str]], receivers: dict[str, str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for m in re.finditer(r"\b(?:val|var)\s+([A-Za-z_]\w*)\s*(?::\s*([\w.<>, ?]+?))?\s*=\s*([^\n]+)", body):
        if m.group(2):
            out[m.group(1)] = java_type(m.group(2))
        else:
            guessed = _expr_type(m.group(3), out, returns, receivers)
            if guessed:
                out[m.group(1)] = guessed
    return out


def _param_fields(params_text: str, classes: dict[str, JavaClass]) -> tuple[str | None, list[str], list[FieldSpec]]:
    body_type: str | None = None
    forms: list[str] = []
    fields: list[FieldSpec] = []
    for part in _split_top(params_text):
        anns, rest = _leading_annotations(part)
        dm = re.match(r"(?:vararg\s+)?([A-Za-z_]\w*)\s*:\s*(.+?)(?:\s*=\s*(.+))?$", rest.strip(), re.S)
        if not dm:
            continue
        var, ktype, kdefault = dm.group(1), dm.group(2).strip(), dm.group(3)
        jtype = java_type(ktype)
        base = re.sub(r"<.*", "", jtype)
        text = " ".join(anns) + " " + rest
        optional = is_nullable(ktype) or kdefault is not None
        if any(a.startswith("@RequestBody") for a in anns):
            body_type = jtype
            continue
        if any(a.startswith(n) for a in anns for n in NON_FORM_PARAM_ANNOS if n != "@RequestHeader") or base in FRAMEWORK_PARAM_TYPES:
            continue
        for anno_name, note in (("PathVariable", "path variable"), ("RequestHeader", "request header"), ("RequestParam", "request param")):
            if any(re.match(rf"@(?:[\w.]+\.)?{anno_name}\b", a) for a in anns):
                if base in ("Map", "MultiValueMap"):
                    break
                info = _annotation_args(text, anno_name) or {}
                name = info.get("name") or var
                required = not (optional or info.get("required") is False or info.get("default"))
                fields.append(FieldSpec(section="REQUEST", name_en=name, name_ko=koreanize_identifier(name), data_type=jtype,
                                        required="Y" if required else "N", note=note,
                                        default_value=info.get("default_value")))
                break
        else:
            if any(a.startswith("@ModelAttribute") for a in anns) or (
                base in classes and classes[base].enum_constants is None and base not in SIMPLE_PARAM_TYPES
            ) or base.endswith(QUERY_DTO_SUFFIXES):
                if base not in forms:
                    forms.append(base)
            elif base in SIMPLE_PARAM_TYPES or (base in classes and classes[base].enum_constants is not None):
                fields.append(FieldSpec(section="REQUEST", name_en=var, name_ko=koreanize_identifier(var), data_type=jtype,
                                        required="N", note="request param"))
    return body_type, forms, fields


def kotlin_controller_files(root: Path) -> dict[Path, str]:
    out: dict[Path, str] = {}
    for path in production_kotlin_files(root):
        raw = path.read_text(encoding="utf-8", errors="ignore")
        if _CONTROLLER_RE.search(_strip_comments(raw)):
            out[path] = raw
    return out


def scan_kotlin_controllers(codebase_path: Path, repo_root: Path, classes: dict[str, JavaClass]) -> list[ApiSeed]:
    sources = kotlin_controller_files(codebase_path)
    if not sources:
        return []
    security = SpringSecurityModel.load(codebase_path, lambda source: _controller_display_path(source, repo_root, codebase_path))
    returns = _service_returns(codebase_path)
    out: list[ApiSeed] = []
    for path, raw in sources.items():
        code = _strip_comments(raw)
        consts = {m.group(1): m.group(2)[1:-1] for m in _CONST_VAL_RE.finditer(code)}
        pm = re.search(r"^\s*package\s+([\w.]+)", code, re.M)
        package = pm.group(1) if pm else ""
        for cm in _CLASS_DECL_RE.finditer(code):
            if cm.group(2) != "class":
                continue
            class_annos = _annotations_before(code, cm.start())
            if not any(re.match(r"@(?:[\w.]+\.)?(?:Rest)?Controller\b(?!Advice)", a) for a in class_annos):
                continue
            class_name = cm.group(3)
            class_line = code.count("\n", 0, cm.start()) + 1
            class_base = ""
            class_security = []
            for anno in class_annos:
                if anno.startswith("@RequestMapping") and not class_base:
                    _, paths = _extract_mapping_paths(anno, consts)
                    class_base = paths[0] if paths else ""
                found = security_annotation(anno, path, class_line, class_name)
                if found:
                    class_security.append(found)
            ctor, _sup, body, _end = _declaration_parts(code, cm)
            receivers = {name: re.sub(r"<.*", "", java_type(ptype)) for _a, name, ptype, _d, _p in _ctor_properties(ctor)}
            receivers.update({m.group(1): re.sub(r"<.*", "", java_type(m.group(2)))
                              for m in re.finditer(r"\b(?:val|var)\s+([A-Za-z_]\w*)\s*:\s*([\w.<>]+)", _depth0(body))})
            body_offset = code.find(body, cm.end()) if body else -1
            if body_offset < 0:
                continue
            own = _depth0(body)
            for fm in _FUN_RE.finditer(own):
                fun_pos = body_offset + fm.start()
                annos = _annotations_before(code, fun_pos)
                mapping = next((a for a in annos if re.match(r"@(?:Get|Post|Put|Delete|Patch|Request)Mapping\b", a)), None)
                if mapping is None:
                    continue
                method, mpaths = _extract_mapping_paths(mapping, consts)
                open_at = body_offset + fm.end() - 1
                close = _close(code, open_at)
                if close < 0:
                    continue
                params_text = code[open_at + 1:close]
                after = code[close + 1:]
                rm = re.match(r"\s*(?::\s*([\w.<>, ?*]+?))?\s*(=|\{)", after)
                return_type = rm.group(1) if rm else None
                if rm and rm.group(2) == "{":
                    b_open = close + 1 + rm.end() - 1
                    b_close = _close(code, b_open)
                    fun_body = code[b_open + 1:b_close] if b_close > 0 else ""
                else:
                    fun_body = after[rm.end():].split("\n\n", 1)[0] if rm else ""
                line_no = code.count("\n", 0, fun_pos) + 1
                annos_start = fun_pos
                for a in annos:
                    idx = code.rfind(a.split("(")[0].split("{")[0], 0, fun_pos)
                    annos_start = min(annos_start, idx) if idx >= 0 else annos_start
                summary = _kdoc_before(raw, annos_start)
                method_security = [found for anno in annos
                                   if (found := security_annotation(anno, path, line_no, f"{class_name}.{fm.group(1)}"))]
                body_type, forms, req_fields = _param_fields(params_text, classes)
                response_type = _unwrap_response(return_type)
                if response_type is None and rm and rm.group(2) == "=" and not return_type:
                    response_type = _expr_type(fun_body.strip(), {}, returns, receivers)
                map_fields: list[FieldSpec] = []
                if response_type and re.match(r"Map\b", response_type):
                    value = re.match(r"Map<\s*[^,]+,\s*(.+)>$", response_type)
                    map_fields = _map_fields(fun_body, value.group(1).strip() if value else None,
                                             _local_types(fun_body, returns, receivers), returns, receivers)
                for mp in dict.fromkeys(_join_mapping_path(class_base, p) for p in mpaths):
                    auth = security.decide(method, mp, method_security, class_security)
                    note = "; ".join(n for n in (ANY_METHOD_NOTE if method == ANY_METHOD else "", auth.note) if n)
                    out.append(ApiSeed(
                        method=method.upper(), path=mp + mapping_condition(mapping),
                        controller_file=_controller_display_path(path, repo_root, codebase_path),
                        package_name=package, service_name="", controller_line=line_no, method_name=fm.group(1),
                        request_body_type=body_type, query_dto_type=", ".join(forms) or None,
                        response_type=None if map_fields else response_type, auth_required=auth.auth_required,
                        request_fields=list(req_fields), summary=summary, note=note, auth_evidence=auth.evidence,
                        response_fields=list(map_fields), authorities=auth.authorities, access_rule=auth.access_rule,
                    ))
    return out
