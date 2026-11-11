from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from tools.excel_generator.models import FieldSpec
from tools.excel_generator.rules.audit_fields import is_audit_field
from tools.excel_generator.rules.naming import resolve_name
from tools.excel_generator.rules.page_object import is_page_object_field

FIELD_RE = re.compile(
    r"\b(?:private|protected|public)\s+([^;=]+?)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:=\s*[^;]*)?;\s*$"
)
# A field with no access modifier (Lombok `@Value`, package-private DTOs); only read directly inside the class body.
FIELD_NO_MODIFIER_RE = re.compile(
    r"^((?:final\s+)?[A-Za-z_][A-Za-z0-9_.]*(?:<[^;=()]*>)?(?:\[\])*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:=\s*[^;]*)?;\s*$"
)
CLASS_RE = re.compile(
    r"\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b(?:\s*<[^{]*?>)?(?:\s+extends\s+([A-Za-z_][A-Za-z0-9_\.]*)(?=[\s{<,]))?"
)
RECORD_RE = re.compile(r"\brecord\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^()]*?>)?\s*\(")
ENUM_RE = re.compile(r"\benum\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:implements\s+[^{]+)?\{")
PACKAGE_RE = re.compile(r"^\s*package\s+([^;]+);", re.M)
_HANGUL = re.compile(r"[가-힣]")

_CONTAINER_TYPES = {"List", "Set", "Map", "Optional", "Collection", "Iterable", "ArrayList", "HashMap"}
_LEAF_TYPES = {
    "String",
    "Integer",
    "Long",
    "Short",
    "Byte",
    "Double",
    "Float",
    "Boolean",
    "BigDecimal",
    "BigInteger",
    "LocalDate",
    "LocalDateTime",
    "LocalTime",
    "Date",
    "Object",
}


_MODIFIER_WORDS = {"static", "final", "transient", "volatile"}
_STATEMENT_WORDS = {"return", "throw", "package", "import", "new", "else", "case"}
_JSON_IGNORE_RE = re.compile(r"^@(?:[\w.]*\.)?JsonIgnore(?:\s*\(\s*(?:value\s*=\s*)?true\s*\))?$")
_JSON_PROPERTY_RE = re.compile(r'^@(?:[\w.]*\.)?JsonProperty\s*\(\s*(?:(?:value|name)\s*=\s*)?"([^"]*)"')
_SIZE_RE = re.compile(r"^@(?:[\w.]*\.)?(?:Size|Length)\s*\((.*)\)\s*$")
_JSON_ROOT_RE = re.compile(r'@(?:[\w.]*\.)?JsonRootName\s*\(\s*(?:value\s*=\s*)?"([^"]+)"')
_SNAKE_NAMING_RE = re.compile(r"@(?:[\w.]*\.)?JsonNaming\s*\(\s*(?:[\w.]*\.)?(?:SnakeCaseStrategy|SNAKE_CASE)\b")


@dataclass
class JavaField:
    name: str
    type_raw: str
    annotations: list[str]
    # Javadoc, block or line comment written for the field (first descriptive line).
    comment: str = ""
    # Name on the wire: an explicit `@JsonProperty`, else the class's snake_case naming strategy, else the Java name.
    json_name: str = ""
    # The expression after `=` in the declaration, when it fits on the declaring line.
    initializer: str = ""

    @property
    def wire_name(self) -> str:
        return self.json_name or self.name

    @property
    def json_ignored(self) -> bool:
        return any(_JSON_IGNORE_RE.match(a.strip()) for a in self.annotations)

    @property
    def max_size(self) -> str:
        for a in self.annotations:
            m = _SIZE_RE.match(a.strip())
            if m:
                mx = re.search(r"\bmax\s*=\s*(\d+)", m.group(1))
                if mx:
                    return mx.group(1)
        return ""


def _explicit_json_name(annotations: list[str]) -> str:
    for a in annotations:
        m = _JSON_PROPERTY_RE.match(a.strip())
        if m and m.group(1):
            return m.group(1)
    return ""


def _snake_case(name: str) -> str:
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])", "_", name).lower()


def _wire_name(name: str, annotations: list[str], snake: bool) -> str:
    return _explicit_json_name(annotations) or (_snake_case(name) if snake else "")


def _strip_comments(text: str) -> str:
    """Source without comments, keeping string literals and line breaks (so positions stay meaningful)."""
    def repl(m: re.Match[str]) -> str:
        if m.group(1) is not None:
            return m.group(1)
        return re.sub(r"[^\n]", " ", m.group(0))
    return re.sub(r'("(?:\\.|[^"\\\n])*")|/\*.*?\*/|//[^\n]*', repl, text, flags=re.S)


def _balanced(text: str, start: int, open_ch: str = "(", close_ch: str = ")") -> int:
    """Index of the bracket that closes the one at `start`, or -1. String literals are skipped."""
    depth = 0
    i = start
    while i < len(text):
        ch = text[i]
        if ch == '"':
            i += 1
            while i < len(text) and text[i] != '"':
                i += 2 if text[i] == "\\" else 1
        elif ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def _split_leading_annotations(line: str) -> tuple[list[str], str]:
    """`@NotBlank @Size(max = 5) private String a;` -> (["@NotBlank", "@Size(max = 5)"], "private String a;")."""
    out: list[str] = []
    rest = line.strip()
    while rest.startswith("@") and not rest.startswith("@interface"):
        m = re.match(r"@[A-Za-z_][\w.]*", rest)
        if not m:
            break
        end = m.end()
        after = rest[end:]
        if after.lstrip().startswith("("):
            open_at = end + (len(after) - len(after.lstrip()))
            close = _balanced(rest, open_at)
            if close < 0:
                return out, rest if not out else rest
            end = close + 1
        out.append(rest[:end].strip())
        rest = rest[end:].lstrip()
    return out, rest


def _split_top_level(text: str) -> list[str]:
    parts: list[str] = []
    depth = 0
    cur: list[str] = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == '"':
            j = i + 1
            while j < len(text) and text[j] != '"':
                j += 2 if text[j] == "\\" else 1
            cur.append(text[i : j + 1])
            i = j + 1
            continue
        if ch in "(<[{":
            depth += 1
        elif ch in ")>]}":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
        i += 1
    tail = "".join(cur)
    if tail.strip():
        parts.append(tail)
    return parts


def _brace_delta(line: str) -> int:
    no_strings = re.sub(r'"(?:\\.|[^"\\])*"', '""', line)
    no_chars = re.sub(r"'(?:\\.|[^'\\])'", "''", no_strings)
    return no_chars.count("{") - no_chars.count("}")


def _comment_text(raw: str) -> str:
    text = raw.strip().lstrip("/").lstrip("*").strip()
    if text.endswith("*/"):
        text = text[:-2].strip()
    return "" if text.startswith("@") else text


def comment_label(comment: str) -> str:
    """Korean field label from a source comment: `/** 작성자명 (실명) */` → `작성자명`.

    Only Korean comments qualify, so English remarks never replace a name.
    """
    text = re.split(r"\s*[(\[]", comment.strip(), maxsplit=1)[0].strip().rstrip(".").strip()
    return text if _HANGUL.search(text) and len(text) <= 40 else ""


def resolve_field_name(
    f: JavaField,
    name_dict: dict[str, str],
    template_ko: str | None,
) -> tuple[str, bool]:
    """Dictionary and reused template names win; then the field's Korean comment; then rules."""
    if f.name not in name_dict and not template_ko:
        label = comment_label(f.comment)
        if label:
            return label, True
    return resolve_name(f.name, name_dict, template_ko, prefer_korean=True)


@dataclass
class JavaClass:
    name: str
    path: Path
    package: str
    extends: str | None
    fields: list[JavaField] = field(default_factory=list)
    snake_case: bool = False
    # `@JsonRootName("user")`: the wire object is wrapped as {"user": {...}} when Jackson's (UN)WRAP_ROOT_VALUE is on.
    json_root: str = ""
    # For an enum: constant name -> JSON value (`@JsonProperty` on the constant, the `@JsonValue` code, else the name).
    # None for classes and records.
    enum_constants: dict[str, str] | None = None


def _short_type(type_raw: str) -> str:
    t = type_raw.strip()
    t = re.sub(r"\s+", " ", t)
    t = t.replace("java.lang.", "")
    parts = re.split(r"([<>,\[\]\s])", t)
    out: list[str] = []
    for p in parts:
        if not p or re.fullmatch(r"[<>,\[\]\s]", p):
            out.append(p)
        else:
            out.append(p.split(".")[-1])
    return "".join(out).strip()


def _candidate_nested_classes(type_raw: str, classes: dict[str, JavaClass], include_enums: bool = False) -> list[str]:
    # Find project class names referenced in the field type, including generic arguments. Enums are values, not
    # objects to expand, so they are left out unless asked for (a changed enum file still changes the API).
    tokens = re.findall(r"[A-Za-z_][A-Za-z0-9_]*", type_raw or "")
    out: list[str] = []
    seen: set[str] = set()
    for tok in tokens:
        if tok in _CONTAINER_TYPES or tok in _LEAF_TYPES:
            continue
        if tok in classes and not include_enums and classes[tok].enum_constants is not None:
            continue
        if tok in classes and tok not in seen:
            out.append(tok)
            seen.add(tok)
    return out


_JSON_VALUE_GETTER_RE = re.compile(
    r"@(?:[\w.]*\.)?JsonValue\s+(?:public\s+)?(?:final\s+)?[\w<>\[\]]+\s+\w+\s*\(\s*\)\s*\{\s*return\s+(?:this\.)?(\w+)\s*;"
)
_JSON_VALUE_FIELD_RE = re.compile(r"@(?:[\w.]*\.)?JsonValue\s+(?:(?:private|protected|public|final)\s+)*[\w<>\[\]]+\s+(\w+)\s*[;=]")
_STRING_LITERAL_RE = re.compile(r'^"((?:\\.|[^"\\])*)"$')


def _enum_json_values(name: str, body: str, constants: list[tuple[str, list[str], list[str]]]) -> dict[str, str]:
    """Constant name -> JSON value. `@JsonProperty("x")` on a constant wins; a `@JsonValue` getter or field that
    returns a constructor-assigned field maps each constant to the string literal it passes there; otherwise Jackson
    writes the constant name."""
    field_name = ""
    if (m := _JSON_VALUE_GETTER_RE.search(body)) or (m := _JSON_VALUE_FIELD_RE.search(body)):
        field_name = m.group(1)
    index = -1
    if field_name:
        ctor = re.search(rf"\b{re.escape(name)}\s*\(([^)]*)\)\s*\{{(.*?)\}}", body, re.S)
        if ctor:
            params = [re.sub(r".*\s", "", p.strip()) for p in ctor.group(1).split(",") if p.strip()]
            assigned = re.search(rf"(?:this\.)?{re.escape(field_name)}\s*=\s*(\w+)\s*;", ctor.group(2))
            if assigned and assigned.group(1) in params:
                index = params.index(assigned.group(1))
    out: dict[str, str] = {}
    for const, anns, args in constants:
        explicit = _explicit_json_name(anns)
        literal = _STRING_LITERAL_RE.match(args[index].strip()) if 0 <= index < len(args) else None
        if explicit:
            out[const] = explicit
        elif field_name and literal:
            out[const] = literal.group(1)
        else:
            out[const] = const
    return out


def _parse_enum(code: str, m: re.Match[str], path: Path, package: str) -> JavaClass:
    """An enum's constants, in declaration order, with the value each one has on the wire."""
    open_at = m.end() - 1
    close = _balanced(code, open_at, "{", "}")
    body = code[open_at + 1 : close] if close > open_at else code[open_at + 1 :]
    # The constant list ends at the first `;` outside brackets, or at the end of the body.
    depth = 0
    end = len(body)
    i = 0
    while i < len(body):
        ch = body[i]
        if ch == '"':
            i += 1
            while i < len(body) and body[i] != '"':
                i += 2 if body[i] == "\\" else 1
        elif ch in "({[":
            depth += 1
        elif ch in ")}]":
            depth -= 1
        elif ch == ";" and depth == 0:
            end = i
            break
        i += 1
    constants: list[tuple[str, list[str], list[str]]] = []
    for part in _split_top_level(body[:end]):
        anns, rest = _split_leading_annotations(part.strip())
        cm = re.match(r"([A-Za-z_][A-Za-z0-9_]*)\s*(\(.*?\))?\s*(?:\{.*\})?\s*$", rest, re.S)
        if not cm:
            continue
        args = _split_top_level(cm.group(2)[1:-1]) if cm.group(2) else []
        constants.append((cm.group(1), anns, args))
    return JavaClass(name=m.group(1), path=path, package=package, extends=None,
                     enum_constants=_enum_json_values(m.group(1), body, constants))


def enum_values_for(type_raw: str, classes: dict[str, JavaClass], json_body: bool = True) -> list[str] | None:
    """Values an enum-typed field (or a collection of one) takes. A JSON body carries the JSON values; a query
    parameter or form field is bound by constant name, whatever `@JsonValue` says."""
    for tok in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", type_raw or ""):
        cls = classes.get(tok)
        if cls is not None and cls.enum_constants is not None:
            return list(cls.enum_constants.values()) if json_body else list(cls.enum_constants)
    return None


def default_literal(expr: str, type_raw: str, classes: dict[str, JavaClass], json_body: bool = True) -> str | None:
    """A field initializer written as a request default when it is a literal: a string, number or boolean, or a
    constant of the field's enum. Anything computed (`new ArrayList<>()`, a method call) is not a default we can state."""
    e = (expr or "").strip()
    if not e or e == "null":
        return None
    if m := _STRING_LITERAL_RE.match(e):
        return re.sub(r"\\(.)", r"\1", m.group(1))
    if re.fullmatch(r"[-+]?\d+(?:\.\d+)?[lLfFdD]?", e):
        return e.rstrip("lLfFdD") if not re.fullmatch(r"[-+]?\d+", e) else e
    if e in ("true", "false"):
        return e
    if m := re.fullmatch(r"(?:([A-Za-z_]\w*)\.)?([A-Za-z_]\w*)", e):
        for tok in ([m.group(1)] if m.group(1) else []) + re.findall(r"[A-Za-z_]\w*", type_raw or ""):
            cls = classes.get(tok)
            if cls is not None and cls.enum_constants is not None and m.group(2) in cls.enum_constants:
                return cls.enum_constants[m.group(2)] if json_body else m.group(2)
    return None


def _parse_record(code: str, m: re.Match[str], path: Path, package: str) -> JavaClass:
    """A Java record: every component is a field, written with its annotations (`@Size`, `@JsonProperty`, ...)."""
    open_at = m.end() - 1
    close = _balanced(code, open_at)
    header = code[open_at + 1 : close] if close > open_at else ""
    snake = bool(_SNAKE_NAMING_RE.search(code[max(0, m.start() - 400) : m.start()]))
    root_match = _JSON_ROOT_RE.search(code[max(0, m.start() - 400) : m.start()])
    fields: list[JavaField] = []
    for part in _split_top_level(header):
        anns, rest = _split_leading_annotations(part.strip())
        rest = re.sub(r"\bfinal\s+", "", rest).strip()
        tm = re.match(r"(.+?)\s+([A-Za-z_][A-Za-z0-9_]*)\s*$", rest, re.S)
        if not tm:
            continue
        type_raw = re.sub(r"\s+", " ", tm.group(1)).strip()
        fields.append(JavaField(name=tm.group(2), type_raw=type_raw, annotations=anns,
                                json_name=_wire_name(tm.group(2), anns, snake)))
    return JavaClass(name=m.group(1), path=path, package=package, extends=None, fields=fields, snake_case=snake,
                     json_root=root_match.group(1) if root_match else "")


def _parse_class(text: str, cm: re.Match[str], path: Path, package: str) -> JavaClass:
    cls_name = cm.group(1)
    extends = cm.group(2).split(".")[-1] if cm.group(2) else None
    anns: list[str] = []
    fields: list[JavaField] = []
    comment = ""
    in_block = False
    depth = 0
    snake = False
    json_root = ""
    declared = False
    opened = False
    for line in text.splitlines():
        # Only this class's own body is read: a file can hold several top-level classes (a controller and its
        # package-private request class), and the fields of one must not land in another.
        if declared:
            if depth > 0:
                opened = True
            elif opened:
                break
        s = line.strip()
        if in_block or s.startswith("/*"):
            if not comment:
                comment = _comment_text(s)
            in_block = "*/" not in s
            continue
        if not s:
            continue
        if s.startswith("//"):
            comment = _comment_text(s) or comment
            continue
        trailing = re.search(r"//(.*)$", s)
        s_no_comment = re.sub(r"//.*$", "", s).strip()
        if not s_no_comment:
            continue
        line_anns, rest = _split_leading_annotations(s_no_comment)
        if not declared and re.search(rf"\bclass\s+{re.escape(cls_name)}\b", rest or s_no_comment):
            declared = True
            snake = any(_SNAKE_NAMING_RE.search(a) for a in anns + line_anns)
            json_root = next((m.group(1) for a in anns + line_anns if (m := _JSON_ROOT_RE.search(a))), "")
            anns = []
            comment = ""
            depth += _brace_delta(rest or s_no_comment)
            continue
        if not declared:
            # Before the declaration only annotations matter: they belong to the class when it follows.
            anns = anns + line_anns if line_anns and not rest else []
            comment = ""
            continue
        if line_anns and not rest:
            anns.extend(line_anns)
            depth += _brace_delta(s_no_comment)
            continue
        field_anns = anns + line_anns
        body = rest or s_no_comment
        fm = FIELD_RE.search(body)
        if not fm and declared and depth == 1:
            fm = FIELD_NO_MODIFIER_RE.match(body)
        if fm:
            type_raw = fm.group(1).strip()
            name = fm.group(2)
            words = type_raw.split()
            skip = False
            while words and words[0] in _MODIFIER_WORDS:
                skip = skip or words[0] in ("static", "transient")
                words.pop(0)
            skip = skip or not words or words[0] in _STATEMENT_WORDS
            if not skip:
                type_raw = " ".join(words)
                field_comment = trailing.group(1).strip() if trailing else comment
                init = re.search(r"=\s*(.+?)\s*;\s*$", body)
                fields.append(JavaField(name=name, type_raw=type_raw, annotations=field_anns[:], comment=field_comment,
                                        json_name=_wire_name(name, field_anns, snake),
                                        initializer=init.group(1) if init else ""))
            anns = []
            comment = ""
            depth += _brace_delta(body)
            continue
        if not s.startswith("@"):
            anns = []
            comment = ""
        depth += _brace_delta(body)
    return JavaClass(name=cls_name, path=path, package=package, extends=extends, fields=fields, snake_case=snake,
                     json_root=json_root)


def parse_java_classes(codebase_path: Path) -> dict[str, JavaClass]:
    java_root = codebase_path / "main/java"
    if not java_root.exists():
        java_root = codebase_path

    classes: dict[str, JavaClass] = {}
    for path in java_root.rglob("*.java"):
        text = path.read_text(encoding="utf-8", errors="ignore")
        code = _strip_comments(text)
        cm = CLASS_RE.search(code)
        rm = RECORD_RE.search(code)
        em = ENUM_RE.search(code)
        if not cm and not rm and not em:
            continue

        pkg = ""
        pm = PACKAGE_RE.search(text)
        if pm:
            pkg = pm.group(1).strip()

        # Enums anywhere in the file, top-level ones first so a nested enum never shadows one of the same name.
        for decl in sorted(ENUM_RE.finditer(code), key=lambda d: code[:d.start()].count("{") - code[:d.start()].count("}")):
            parsed = _parse_enum(code, decl, path, pkg)
            classes.setdefault(parsed.name, parsed)
        if not cm and not rm:
            continue

        if rm and (not cm or rm.start() < cm.start()):
            parsed = _parse_record(code, rm, path, pkg)
            classes[parsed.name] = parsed
            continue
        # Every top-level class of the file (brace depth 0), not only the first one.
        for decl in CLASS_RE.finditer(code):
            before = code[:decl.start()]
            if before.count("{") - before.count("}") != 0:
                continue
            parsed = _parse_class(text, decl, path, pkg)
            if decl is cm:
                classes[parsed.name] = parsed  # the file's main class replaces a same-named one, as before
            else:
                classes.setdefault(parsed.name, parsed)

    return classes


def referenced_classes(classes: dict[str, JavaClass], type_raw: str) -> list[JavaClass]:
    """The project classes a type expression stands for, in reading order.

    Each class is followed by its parent and then by the classes its fields use, so the list is every source file
    whose edit can change the expanded field list of that type. Containers and leaf types add nothing.
    """
    found: list[JavaClass] = []
    seen: set[str] = set()

    def visit(name: str) -> None:
        cls = classes.get(name)
        if cls is None or name in seen:
            return
        seen.add(name)
        found.append(cls)
        if cls.extends:
            visit(cls.extends)
        for f in cls.fields:
            for nested in _candidate_nested_classes(f.type_raw, classes, include_enums=True):
                visit(nested)

    for name in _candidate_nested_classes(type_raw, classes, include_enums=True):
        visit(name)
    return found


def resolve_dto_fields(classes: dict[str, JavaClass], cls_name: str, visited: set[str] | None = None) -> list[JavaField]:
    if visited is None:
        visited = set()
    if cls_name in visited:
        return []
    visited.add(cls_name)

    cls = classes.get(cls_name)
    if not cls:
        return []

    out: list[JavaField] = []
    if cls.extends and cls.extends not in {"Object", "ReqCoreDto", "ReqCoreDtoExt", "Audit"}:
        out.extend(resolve_dto_fields(classes, cls.extends, visited))
    out.extend(cls.fields)
    return out


def java_fields_to_spec_fields(
    fields: list[JavaField],
    section: str,
    name_dict: dict[str, str],
    template_name_reuse: dict[str, str] | None = None,
) -> tuple[list[FieldSpec], list[str]]:
    out: list[FieldSpec] = []
    conflicts: list[str] = []

    for f in fields:
        if f.name in {"serialVersionUID"} or f.json_ignored:
            continue
        if is_audit_field(f.name):
            continue
        if is_page_object_field(f.name):
            # include only if explicit field exists in DTO; this function is called only on existing fields
            pass

        if section == "RESPONSE":
            required = "Y"
        else:
            required = "Y" if any(x in " ".join(f.annotations) for x in ["@NotNull", "@NotEmpty", "@NotBlank"]) else "N"
        template_ko = None
        if template_name_reuse:
            template_ko = template_name_reuse.get(f"{section}:{f.name}")

        ko, resolved = resolve_field_name(f, name_dict, template_ko)
        if not resolved:
            conflicts.append(f"naming unresolved: {section}:{f.name}")

        out.append(
            FieldSpec(
                section=section,
                name_en=f.wire_name,
                name_ko=ko,
                data_type=_short_type(f.type_raw),
                required=required,
                note="",
                path=f.wire_name,
                parent_path=None,
                depth=0,
                max_size=f.max_size,
                enum_values=None,
                default_value=None,
            )
        )

    return out, conflicts


def expand_dto_to_spec_fields(
    classes: dict[str, JavaClass],
    root_cls_name: str,
    section: str,
    name_dict: dict[str, str],
    template_name_reuse: dict[str, str] | None = None,
    wrap_root: bool = False,
    under: str | None = None,
    json_body: bool = True,
) -> tuple[list[FieldSpec], list[str]]:
    """Fields of a DTO as they appear on the wire; with `under`, nested below that already listed field. With `wrap_root` (Jackson's UNWRAP_ROOT_VALUE for requests or
    WRAP_ROOT_VALUE for responses), a class annotated `@JsonRootName("user")` is nested under a `user` object.
    `json_body` is False for a query or form object, which Spring binds by constant name rather than Jackson's value."""
    out: list[FieldSpec] = []
    conflicts: list[str] = []
    seen_paths: set[str] = set()

    def add_class_fields(
        cls_name: str,
        parent_path: str | None,
        depth: int,
        ancestry: set[str],
    ) -> None:
        if cls_name in ancestry:
            return
        if cls_name not in classes:
            return

        next_ancestry = set(ancestry)
        next_ancestry.add(cls_name)

        fields = resolve_dto_fields(classes, cls_name)
        for f in fields:
            if f.name in {"serialVersionUID"} or f.json_ignored:
                continue
            if is_audit_field(f.name):
                continue
            if is_page_object_field(f.name):
                # include only if explicit field exists in DTO; this function is called only on existing fields
                pass

            path = f.wire_name if parent_path is None else f"{parent_path}.{f.wire_name}"
            if path in seen_paths:
                continue
            seen_paths.add(path)

            if section == "RESPONSE":
                required = "Y"
            else:
                required = "Y" if any(x in " ".join(f.annotations) for x in ["@NotNull", "@NotEmpty", "@NotBlank"]) else "N"
            template_ko = None
            if template_name_reuse:
                # Try full path first, then terminal token fallback.
                template_ko = template_name_reuse.get(f"{section}:{path}") or template_name_reuse.get(f"{section}:{f.name}")

            ko, resolved = resolve_field_name(f, name_dict, template_ko)
            if not resolved:
                conflicts.append(f"naming unresolved: {section}:{path}")

            out.append(
                FieldSpec(
                    section=section,
                    name_en=f.wire_name,
                    name_ko=ko,
                    data_type=_short_type(f.type_raw),
                    required=required,
                    note="",
                    path=path,
                    parent_path=parent_path,
                    depth=depth,
                    max_size=f.max_size,
                    enum_values=enum_values_for(f.type_raw, classes, json_body),
                    default_value=default_literal(f.initializer, f.type_raw, classes, json_body) if section == "REQUEST" else None,
                )
            )

            nested_candidates = _candidate_nested_classes(f.type_raw, classes)
            for nested in nested_candidates:
                if nested in next_ancestry:
                    continue
                add_class_fields(nested, path, depth + 1, next_ancestry)

    if under:
        add_class_fields(root_cls_name, under, under.count(".") + 1, set())
        return out, conflicts
    root = classes.get(root_cls_name)
    if wrap_root and root is not None and root.json_root:
        out.append(FieldSpec(section=section, name_en=root.json_root, name_ko=name_dict.get(root.json_root, root.json_root),
                             data_type=root_cls_name, required="Y", note="", path=root.json_root, parent_path=None, depth=0))
        seen_paths.add(root.json_root)
        add_class_fields(root_cls_name, root.json_root, 1, set())
        return out, conflicts
    add_class_fields(root_cls_name, None, 0, set())
    return out, conflicts


def expand_type_to_spec_fields(
    classes: dict[str, JavaClass],
    root_type: str,
    section: str,
    name_dict: dict[str, str],
    template_name_reuse: dict[str, str] | None = None,
    wrap_root: bool = False,
) -> tuple[list[FieldSpec], list[str]]:
    if not root_type:
        return ([], [])

    short = _short_type(root_type)
    if short in classes:
        return expand_dto_to_spec_fields(classes, short, section, name_dict, template_name_reuse, wrap_root)

    candidates = _candidate_nested_classes(short, classes)
    out: list[FieldSpec] = []
    conflicts: list[str] = []
    seen_paths: set[str] = set()
    seen_conflicts: set[str] = set()
    seen_roots: set[str] = set()

    for cand in candidates:
        if cand in seen_roots:
            continue
        seen_roots.add(cand)

        spec_fields, inner_conflicts = expand_dto_to_spec_fields(
            classes,
            cand,
            section,
            name_dict,
            template_name_reuse,
        )
        for f in spec_fields:
            path_key = f.path or f.name_en
            if path_key in seen_paths:
                continue
            seen_paths.add(path_key)
            out.append(f)
        for c in inner_conflicts:
            if c in seen_conflicts:
                continue
            seen_conflicts.add(c)
            conflicts.append(c)

    return out, conflicts
