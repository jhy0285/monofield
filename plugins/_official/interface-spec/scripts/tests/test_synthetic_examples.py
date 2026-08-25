"""Regression coverage for non-executed interface-spec examples."""

from __future__ import annotations

import sys
import json
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

from tools.excel_generator.synthetic_examples import add_static_examples, build_payload, load_sample_context
from tools.excel_generator.dictionary_loader import load_dictionary_file
from infer_db_candidates import infer
from apply_fill_mode import apply_fill_mode


class SyntheticExamplesTest(unittest.TestCase):
    def test_applies_global_and_domain_fill_modes_without_guessing(self) -> None:
        document = {
            "endpoints": [
                {"path": "/orders", "moduleName": "orders", "businessCode": "old", "owner": "old", "note": "old"},
                {"path": "/unknown", "moduleName": "unknown"},
            ],
        }
        global_result, _ = apply_fill_mode(document, "global", "ALL-001", "API team", "shared")
        self.assertEqual(global_result["endpoints"][0]["businessCode"], "ALL-001")
        domain_result, unmatched = apply_fill_mode(
            global_result,
            "domain-mapping",
            domain_map={"orders": {"businessCode": "ORD-001", "owner": "Order team", "note": ""}},
        )
        self.assertEqual(domain_result["endpoints"][0]["owner"], "Order team")
        self.assertEqual(domain_result["endpoints"][1]["businessCode"], "")
        self.assertEqual(unmatched, ["unknown"])

    def test_discovers_project_context_and_uses_typed_values_when_names_differ(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            context_path = root / ".open-docs" / "database-context" / "approved-db-context.json"
            context_path.parent.mkdir(parents=True)
            context_path.write_text(
                json.dumps({"tables": [{"sampleRows": [{"customer_name": "Ada", "amount": 125}]}]}),
                encoding="utf-8",
            )

            context = load_sample_context(None, root)
            self.assertEqual(
                build_payload(
                    [
                        {"nameEn": "displayName", "dataType": "String"},
                        {"nameEn": "totalAmount", "dataType": "Integer"},
                    ],
                    context,
                ),
                {"displayName": "Ada", "totalAmount": 125},
            )

    def test_infers_evidence_backed_candidates_without_database_access(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "User.java").write_text(
                '@Entity\n@Table(name = "users")\nclass User {}\n'
                'String sql = "select * from audit_log";\n',
                encoding="utf-8",
            )

            candidates = infer(root, ["abtdb"])
            self.assertEqual([candidate["table"] for candidate in candidates], ["audit_log", "users"])
            self.assertEqual(candidates[0]["schema"], "abtdb")
            self.assertEqual(candidates[0]["evidence"][0]["line"], 4)

    def test_uses_matching_redacted_database_sample_without_executing_anything(self) -> None:
        context = {
            "tables": [
                {
                    "sampleRows": [
                        {"user_id": 42, "name": "Ada", "access_token": "[redacted]"},
                    ],
                },
            ],
        }
        fields = [
            {"nameEn": "userId", "dataType": "Long"},
            {"nameEn": "name", "dataType": "String"},
            {"nameEn": "accessToken", "dataType": "String"},
        ]

        self.assertEqual(
            build_payload(fields, context),
            {"userId": 42, "name": "Ada", "accessToken": "sample"},
        )

    def test_marks_examples_as_static_analysis(self) -> None:
        endpoints = [{"requestFields": [{"nameEn": "id", "dataType": "Long"}], "responseFields": []}]
        add_static_examples(endpoints, {"tables": []})

        self.assertEqual(endpoints[0]["exampleSource"], "static-analysis")
        self.assertEqual(endpoints[0]["requestExample"], {"body": {"id": 0}})
        self.assertEqual(
            endpoints[0]["responseExample"],
            {"resultCode": 0, "resultMsg": "SUCCESS", "result": {}},
        )

    def test_fastapi_scanner_uses_approved_sample_context(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "app.py").write_text(
                "from fastapi import FastAPI\n"
                "from pydantic import BaseModel\n\n"
                "app = FastAPI()\n\n"
                "class User(BaseModel):\n"
                "    user_id: int\n"
                "    name: str\n\n"
                "@app.post('/users', response_model=User)\n"
                "def create_user(user: User) -> User:\n"
                "    return user\n",
                encoding="utf-8",
            )
            context_path = root / ".open-docs" / "database-context" / "approved-db-context.json"
            context_path.parent.mkdir(parents=True)
            context_path.write_text(
                json.dumps({"tables": [{"sampleRows": [{"user_id": 42, "name": "Ada"}]}]}),
                encoding="utf-8",
            )
            output_path = root / "interface-spec.json"
            subprocess.run(
                [
                    sys.executable,
                    str(SCRIPTS_DIR / "scan_fastapi.py"),
                    "--codebase-path", str(root),
                    "--out", str(output_path),
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            endpoint = json.loads(output_path.read_text(encoding="utf-8"))["endpoints"][0]
            self.assertEqual(endpoint["exampleSource"], "static-analysis")
            self.assertIn("42", json.dumps(endpoint["requestExample"]))
            self.assertIn("Ada", json.dumps(endpoint["responseExample"]))

    def test_reads_xlsm_dictionary_without_loading_macros(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workbook = Path(temp_dir) / "dictionary.xlsm"
            with zipfile.ZipFile(workbook, "w") as archive:
                archive.writestr(
                    "xl/worksheets/sheet1.xml",
                    """<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>
                    <row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>nameEn</t></is></c><c r=\"B1\" t=\"inlineStr\"><is><t>nameKo</t></is></c></row>
                    <row r=\"2\"><c r=\"A2\" t=\"inlineStr\"><is><t>userId</t></is></c><c r=\"B2\" t=\"inlineStr\"><is><t>사용자 ID</t></is></c></row>
                    </sheetData></worksheet>""",
                )
                archive.writestr("xl/vbaProject.bin", b"not executed")
            self.assertEqual(load_dictionary_file(workbook), {"userId": "사용자 ID"})


if __name__ == "__main__":
    unittest.main()
