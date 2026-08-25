"""Infer database table candidates from source references without opening a database.

This is deliberately a conservative evidence collector. It never executes code or
SQL and never attempts to resolve credentials. The interface-spec workflow uses
the output to ask the user which candidates may receive a masked, read-only
sample query.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


TEXT_EXTENSIONS = {
    ".cs",
    ".go",
    ".java",
    ".js",
    ".jsx",
    ".kt",
    ".php",
    ".py",
    ".rb",
    ".sql",
    ".ts",
    ".tsx",
    ".xml",
    ".yaml",
    ".yml",
}
SKIP_PARTS = {".git", ".next", "build", "coverage", "dist", "node_modules", "target", "vendor"}
RESERVED_IDENTIFIERS = {
    "DELETE",
    "FROM",
    "GET",
    "INTO",
    "PATCH",
    "POST",
    "PUT",
    "SELECT",
    "UPDATE",
}

# Ordered from explicit ORM declarations to generic SQL references. The generic
# patterns intentionally require a quoted or identifier-like table token so that
# prose and URL paths do not become candidates.
PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "JPA @Table",
        re.compile(
            r"@Table\s*\((?:(?:[^)]*?\bname\s*=\s*)?[\"'](?P<table>[A-Za-z_][\w$-]*)[\"']|[^)]*?\bname\s*=\s*[\"'](?P<table_named>[A-Za-z_][\w$-]*)[\"'])[^)]*\)",
            re.IGNORECASE,
        ),
    ),
    (
        "JPA @JoinTable",
        re.compile(r"@JoinTable\s*\([^)]*?\bname\s*=\s*[\"'](?P<table>[A-Za-z_][\w$-]*)[\"']", re.IGNORECASE),
    ),
    (
        "TypeORM @Entity",
        re.compile(
            r"@Entity\s*\(\s*(?:\{[^}]*?\bname\s*:\s*)?[\"'](?P<table>[A-Za-z_][\w$-]*)[\"']",
            re.IGNORECASE,
        ),
    ),
    (
        "Django db_table",
        re.compile(r"\bdb_table\s*=\s*[\"'](?P<table>[A-Za-z_][\w$-]*)[\"']", re.IGNORECASE),
    ),
    (
        "Sequelize tableName",
        re.compile(r"\btableName\s*:\s*[\"'](?P<table>[A-Za-z_][\w$-]*)[\"']", re.IGNORECASE),
    ),
    (
        "GORM TableName",
        re.compile(r"\bTableName\s*\(\s*\)\s*[^\{]*\{[^}]*?return\s+[\"'](?P<table>[A-Za-z_][\w$-]*)[\"']", re.IGNORECASE | re.DOTALL),
    ),
    (
        "SQL reference",
        re.compile(
            r"\b(?:FROM|JOIN|INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO)\s+(?:(?P<schema>[A-Za-z_][\w$-]*)\s*[.])?(?P<table>[A-Za-z_][\w$-]*)",
            re.IGNORECASE,
        ),
    ),
)


def iter_source_files(root: Path):
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in TEXT_EXTENSIONS:
            continue
        if any(part in SKIP_PARTS for part in path.parts):
            continue
        yield path


def add_match(
    candidates: dict[tuple[str | None, str], dict[str, Any]],
    table: str,
    schema: str | None,
    path: Path,
    line: int,
    reason: str,
    root: Path,
):
    table = table.strip('`"\'[]')
    if not re.fullmatch(r"[A-Za-z_][\w$-]*", table):
        return
    if table.upper() in RESERVED_IDENTIFIERS or table.startswith("__"):
        return
    key = (schema, table)
    candidate = candidates.setdefault(key, {"schema": schema, "table": table, "evidence": []})
    evidence = {"path": path.relative_to(root).as_posix(), "line": line, "reason": reason}
    if evidence not in candidate["evidence"]:
        candidate["evidence"].append(evidence)


def is_sql_context(reason: str, path: Path, line_text: str) -> bool:
    if reason != "SQL reference" or path.suffix.lower() == ".sql":
        return True
    stripped = line_text.strip().lower()
    if stripped.startswith(("#", "//", "*", "\"\"\"", "'''")):
        return False
    return any(marker in stripped for marker in ("select", "insert", "update", "delete", "join", "query", "sql", "execute", "raw("))


def infer(root: Path, schemas: list[str]) -> list[dict[str, Any]]:
    candidates: dict[tuple[str | None, str], dict[str, Any]] = {}
    default_schema = schemas[0] if len(schemas) == 1 else None
    for path in iter_source_files(root):
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        lines = text.splitlines()
        for reason, pattern in PATTERNS:
            for match in pattern.finditer(text):
                table = match.groupdict().get("table") or match.groupdict().get("table_named")
                if not table:
                    continue
                schema = match.groupdict().get("schema") or default_schema
                line = text.count("\n", 0, match.start()) + 1
                line_text = lines[line - 1] if lines else ""
                if not is_sql_context(reason, path, line_text):
                    continue
                add_match(candidates, table, schema, path, line, reason, root)
    return sorted(candidates.values(), key=lambda item: ((item["schema"] or ""), item["table"]))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--codebase-path", required=True, type=Path)
    parser.add_argument("--schemas", default="", help="Comma-separated selected schemas, if known")
    parser.add_argument("--out", default="db-candidates.json", type=Path)
    args = parser.parse_args()
    root = args.codebase_path.resolve()
    if not root.is_dir():
        raise SystemExit(f"codebase path is not a directory: {root}")
    schemas = [part.strip() for part in args.schemas.split(",") if part.strip()]
    payload = {
        "kind": "database-candidates",
        "source": "static-analysis",
        "candidates": infer(root, schemas),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"candidates": len(payload["candidates"]), "out": str(args.out)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
