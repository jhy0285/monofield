"""Fixture regressions for canonical interface-spec field paths."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
FIXTURES_DIR = SCRIPTS_DIR.parent / "fixtures"


def _scan_fixture(scanner: str, fixture: str) -> dict:
    with tempfile.TemporaryDirectory() as temp_dir:
        output_path = Path(temp_dir) / "interface-spec.json"
        subprocess.run(
            [
                sys.executable,
                str(SCRIPTS_DIR / scanner),
                "--codebase-path",
                str(FIXTURES_DIR / fixture),
                "--out",
                str(output_path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        return json.loads(output_path.read_text(encoding="utf-8"))


def _canonical_field_path(field: dict) -> str:
    return str(field.get("path") or field["nameEn"]).strip().lower()


class ScannerFieldPathsTest(unittest.TestCase):
    def assert_unique_field_paths(self, document: dict) -> None:
        for endpoint in document["endpoints"]:
            for field_kind in ("requestFields", "responseFields"):
                fields = endpoint[field_kind]
                paths = [_canonical_field_path(field) for field in fields]
                with self.subTest(
                    method=endpoint["method"],
                    path=endpoint["path"],
                    field_kind=field_kind,
                ):
                    self.assertEqual(len(paths), len(set(paths)))

    def test_django_fixture_has_unique_paths_and_preserves_nested_ids(self) -> None:
        document = _scan_fixture("scan_django.py", "django")
        self.assert_unique_field_paths(document)

        endpoint = next(
            endpoint for endpoint in document["endpoints"]
            if endpoint["method"] == "GET" and endpoint["path"] == "/api/orders/"
        )
        id_fields = [field for field in endpoint["responseFields"] if field["nameEn"] == "id"]
        self.assertEqual({field["path"] for field in id_fields}, {"id", "items.id"})
        nested_id = next(field for field in id_fields if field["path"] == "items.id")
        self.assertEqual(nested_id["parentPath"], "items")
        self.assertEqual(nested_id["depth"], 1)
        self.assertEqual(endpoint["sourceFile"], "orders/views.py")
        self.assertGreater(endpoint["sourceLine"], 0)

    def test_go_fixture_has_unique_paths_and_preserves_nested_items(self) -> None:
        document = _scan_fixture("scan_go.py", "go")
        self.assert_unique_field_paths(document)

        endpoint = next(
            endpoint for endpoint in document["endpoints"]
            if endpoint["method"] == "GET" and endpoint["path"] == "/api/v1/orders"
        )
        item_fields = [field for field in endpoint["responseFields"] if field["nameEn"] == "items"]
        self.assertEqual({field["path"] for field in item_fields}, {"items", "items.items"})
        nested_items = next(field for field in item_fields if field["path"] == "items.items")
        self.assertEqual(nested_items["parentPath"], "items")
        self.assertEqual(nested_items["depth"], 1)
        self.assertTrue(any(
            field["path"] == "items.items.productCode" and field["depth"] == 2
            for field in endpoint["responseFields"]
        ))
        self.assertEqual(endpoint["sourceFile"], "main.go")
        self.assertGreater(endpoint["sourceLine"], 0)


if __name__ == "__main__":
    unittest.main()
