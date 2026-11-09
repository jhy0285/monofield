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


def _candidate_nested_classes(type_raw: str, classes: dict[str, JavaClass]) -> list[str]:
    # Find project class names referenced in the field type, including generic arguments.
    tokens = re.findall(r"[A-Za-z_][A-Za-z0-9_]*", type_raw or "")
    out: list[str] = []
    seen: set[str] = set()
    for tok in tokens:
        if tok in _CONTAINER_TYPES or tok in _LEAF_TYPES:
            continue
        if tok in classes and tok not in seen:
            out.append(tok)
            seen.add(tok)
    return out


def _parse_record(code: str, m: re.Match[str], path: Path, package: str) -> JavaClass:
    """A Java record: every component is a field, written with its annotations (`@Size`, `@JsonProperty`, ...)."""
    open_at = m.end() - 1
    close = _balanced(code, open_at)
    header = code[open_at + 1 : close] if close > open_at else ""
    snake = bool(_SNAKE_NAMING_RE.search(code[max(0, m.start() - 400) : m.start()]))
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
    return JavaClass(name=m.group(1), path=path, package=package, extends=None, fields=fields, snake_case=snake)


def _parse_class(text: str, cm: re.Match[str], path: Path, package: str) -> JavaClass:
    cls_name = cm.group(1)
    extends = cm.group(2).split(".")[-1] if cm.group(2) else None
    anns: list[str] = []
    fields: list[JavaField] = []
    comment = ""
    in_block = False
    depth = 0
    snake = False
    declared = False
    for line in text.splitlines():
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
            anns = []
            comment = ""
            depth += _brace_delta(rest or s_no_comment)
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
                fields.append(JavaField(name=name, type_raw=type_raw, annotations=field_anns[:], comment=field_comment,
                                        json_name=_wire_name(name, field_anns, snake)))
            anns = []
            comment = ""
            depth += _brace_delta(body)
            continue
        if not s.startswith("@"):
            anns = []
            comment = ""
        depth += _brace_delta(body)
    return JavaClass(name=cls_name, path=path, package=package, extends=extends, fields=fields, snake_case=snake)


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
        if not cm and not rm:
            continue

        pkg = ""
        pm = PACKAGE_RE.search(text)
        if pm:
            pkg = pm.group(1).strip()

        if rm and (not cm or rm.start() < cm.start()):
            parsed = _parse_record(code, rm, path, pkg)
        else:
            parsed = _parse_class(text, cm, path, pkg)
        classes[parsed.name] = parsed

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
            for nested in _candidate_nested_classes(f.type_raw, classes):
                visit(nested)

    for name in _candidate_nested_classes(type_raw, classes):
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
            )
        )

    return out, conflicts


def expand_dto_to_spec_fields(
    classes: dict[str, JavaClass],
    root_cls_name: str,
    section: str,
    name_dict: dict[str, str],
    template_name_reuse: dict[str, str] | None = None,
) -> tuple[list[FieldSpec], list[str]]:
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
                )
            )

            nested_candidates = _candidate_nested_classes(f.type_raw, classes)
            for nested in nested_candidates:
                if nested in next_ancestry:
                    continue
                add_class_fields(nested, path, depth + 1, next_ancestry)

    add_class_fields(root_cls_name, None, 0, set())
    return out, conflicts


def expand_type_to_spec_fields(
    classes: dict[str, JavaClass],
    root_type: str,
    section: str,
    name_dict: dict[str, str],
    template_name_reuse: dict[str, str] | None = None,
) -> tuple[list[FieldSpec], list[str]]:
    if not root_type:
        return ([], [])

    short = _short_type(root_type)
    if short in classes:
        return expand_dto_to_spec_fields(classes, short, section, name_dict, template_name_reuse)

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
