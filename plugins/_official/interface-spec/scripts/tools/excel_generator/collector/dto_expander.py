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
CLASS_RE = re.compile(r"\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b(?:\s+extends\s+([A-Za-z_][A-Za-z0-9_\.]*) )?")
PACKAGE_RE = re.compile(r"^\s*package\s+([^;]+);", re.M)

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


@dataclass
class JavaField:
    name: str
    type_raw: str
    annotations: list[str]


@dataclass
class JavaClass:
    name: str
    path: Path
    package: str
    extends: str | None
    fields: list[JavaField] = field(default_factory=list)


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


def parse_java_classes(codebase_path: Path) -> dict[str, JavaClass]:
    java_root = codebase_path / "main/java"
    if not java_root.exists():
        java_root = codebase_path

    classes: dict[str, JavaClass] = {}
    for path in java_root.rglob("*.java"):
        text = path.read_text(encoding="utf-8", errors="ignore")
        cm = CLASS_RE.search(text)
        if not cm:
            continue

        pkg = ""
        pm = PACKAGE_RE.search(text)
        if pm:
            pkg = pm.group(1).strip()

        cls_name = cm.group(1)
        extends = cm.group(2).split(".")[-1] if cm.group(2) else None

        anns: list[str] = []
        fields: list[JavaField] = []
        for line in text.splitlines():
            s = line.strip()
            if not s or s.startswith("//"):
                continue
            s_no_comment = re.sub(r"//.*$", "", s).strip()
            if not s_no_comment:
                continue
            if s.startswith("@"):
                anns.append(s)
                continue
            fm = FIELD_RE.search(s_no_comment)
            if fm:
                type_raw = fm.group(1).strip()
                name = fm.group(2)
                fields.append(JavaField(name=name, type_raw=type_raw, annotations=anns[:]))
                anns = []
                continue
            if not s.startswith("@"):
                anns = []

        classes[cls_name] = JavaClass(
            name=cls_name,
            path=path,
            package=pkg,
            extends=extends,
            fields=fields,
        )

    return classes


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
        if f.name in {"serialVersionUID"}:
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

        ko, resolved = resolve_name(f.name, name_dict, template_ko, prefer_korean=True)
        if not resolved:
            conflicts.append(f"naming unresolved: {section}:{f.name}")

        out.append(
            FieldSpec(
                section=section,
                name_en=f.name,
                name_ko=ko,
                data_type=_short_type(f.type_raw),
                required=required,
                note="",
                path=f.name,
                parent_path=None,
                depth=0,
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
            if f.name in {"serialVersionUID"}:
                continue
            if is_audit_field(f.name):
                continue
            if is_page_object_field(f.name):
                # include only if explicit field exists in DTO; this function is called only on existing fields
                pass

            path = f.name if parent_path is None else f"{parent_path}.{f.name}"
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

            ko, resolved = resolve_name(f.name, name_dict, template_ko, prefer_korean=True)
            if not resolved:
                conflicts.append(f"naming unresolved: {section}:{path}")

            out.append(
                FieldSpec(
                    section=section,
                    name_en=f.name,
                    name_ko=ko,
                    data_type=_short_type(f.type_raw),
                    required=required,
                    note="",
                    path=path,
                    parent_path=parent_path,
                    depth=depth,
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
