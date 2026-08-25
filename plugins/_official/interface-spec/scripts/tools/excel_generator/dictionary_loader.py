"""Read user-supplied naming dictionaries without executing workbook macros."""

from __future__ import annotations

import csv
import json
import zipfile
from pathlib import Path
from xml.etree import ElementTree


_SHEET_NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def load_dictionary_file(path: Path) -> dict[str, str]:
    suffix = path.suffix.lower()
    if suffix == ".json":
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise SystemExit(f"--name-dict {path}: JSON must be an object of nameEn -> nameKo")
        return {str(key): str(value) for key, value in raw.items()}
    if suffix == ".csv":
        with path.open(encoding="utf-8-sig", newline="") as stream:
            return _rows_to_dictionary(csv.reader(stream))
    if suffix in {".xlsx", ".xlsm"}:
        return _read_ooxml_dictionary(path)
    raise SystemExit(f"--name-dict {path}: use .json, .csv, .xlsx, or .xlsm")


def _read_ooxml_dictionary(path: Path) -> dict[str, str]:
    """Read visible cell values only; VBA streams are neither opened nor run."""
    try:
        with zipfile.ZipFile(path) as workbook:
            shared = _shared_strings(workbook)
            sheets = sorted(
                name for name in workbook.namelist()
                if name.startswith("xl/worksheets/") and name.endswith(".xml")
            )
            if not sheets:
                raise ValueError("workbook has no worksheets")
            rows = _worksheet_rows(workbook.read(sheets[0]), shared)
    except (OSError, ValueError, zipfile.BadZipFile, ElementTree.ParseError) as error:
        raise SystemExit(f"--name-dict {path}: could not read workbook ({error})") from error
    return _rows_to_dictionary(rows)


def _shared_strings(workbook: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in workbook.namelist():
        return []
    root = ElementTree.fromstring(workbook.read("xl/sharedStrings.xml"))
    return ["".join(item.itertext()) for item in root.findall("x:si", _SHEET_NS)]


def _worksheet_rows(xml: bytes, shared: list[str]) -> list[list[str]]:
    root = ElementTree.fromstring(xml)
    rows: list[list[str]] = []
    for row in root.findall(".//x:sheetData/x:row", _SHEET_NS):
        cells: list[str] = []
        for cell in row.findall("x:c", _SHEET_NS):
            value = cell.findtext("x:v", default="", namespaces=_SHEET_NS)
            if cell.get("t") == "s" and value.isdigit() and int(value) < len(shared):
                cells.append(shared[int(value)])
            elif cell.get("t") == "inlineStr":
                inline = cell.find("x:is", _SHEET_NS)
                cells.append("" if inline is None else "".join(inline.itertext()))
            else:
                cells.append(value)
        rows.append(cells)
    return rows


def _rows_to_dictionary(rows: object) -> dict[str, str]:
    output: dict[str, str] = {}
    for row in rows:  # type: ignore[union-attr]
        if len(row) < 2:
            continue
        key, value = str(row[0]).strip(), str(row[1]).strip()
        if not key or not value or key.startswith("#"):
            continue
        if key.lower() in {"nameen", "english", "field", "key"} and value.lower() in {"nameko", "korean", "value", "label"}:
            continue
        output[key] = value
    return output
