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

    def test_spring_fixture_resolves_bare_mappings_to_the_class_path(self) -> None:
        document = _scan_fixture("scan_spring.py", "spring")
        self.assert_unique_field_paths(document)

        routes = {(endpoint["method"], endpoint["path"]) for endpoint in document["endpoints"]}
        # A bare @PostMapping / @GetMapping targets the class @RequestMapping
        # path itself; Spring never serves it as a trailing-slash twin.
        self.assertIn(("POST", "/api/v1/orders"), routes)
        self.assertIn(("GET", "/api/v1/orders"), routes)
        self.assertIn(("GET", "/api/v1/orders/{orderId}"), routes)
        self.assertIn(("POST", "/api/v1/members/join"), routes)
        self.assertFalse(any(path != "/" and path.endswith("/") for _, path in routes))

        create = next(
            endpoint for endpoint in document["endpoints"]
            if endpoint["method"] == "POST" and endpoint["path"] == "/api/v1/orders"
        )
        request_paths = {field["path"] for field in create["requestFields"]}
        self.assertTrue({"memberId", "items", "items.productId", "deliveryAddress"} <= request_paths)

    def test_egov_fixture_keeps_method_less_do_mappings(self) -> None:
        document = _scan_fixture("scan_spring.py", "spring-egov")
        self.assert_unique_field_paths(document)
        endpoints = {(endpoint["method"], endpoint["path"]): endpoint for endpoint in document["endpoints"]}
        # @RequestMapping without `method` serves every HTTP method; it must not be dropped.
        self.assertEqual(set(endpoints), {
            ("GET/POST", "/board/selectBoardList.do"),
            ("POST", "/board/insertBoard.do"),
            ("GET/POST", "/board/selectBoard.do"),
        })
        self.assertIn("method", endpoints[("GET/POST", "/board/selectBoardList.do")]["note"])
        self.assertEqual(endpoints[("POST", "/board/insertBoard.do")]["note"], "")

    def test_egov_fixture_binds_model_attribute_and_vo_parameters(self) -> None:
        document = _scan_fixture("scan_spring.py", "spring-egov")
        endpoints = {(endpoint["method"], endpoint["path"]): endpoint for endpoint in document["endpoints"]}

        search = endpoints[("GET/POST", "/board/selectBoardList.do")]
        self.assertEqual({field["path"] for field in search["requestFields"]}, {"searchCondition", "searchKeyword", "useYn"})
        self.assertEqual(search["queryDtoType"], "BoardDefaultVO")

        insert = endpoints[("POST", "/board/insertBoard.do")]
        insert_paths = [field["path"] for field in insert["requestFields"]]
        self.assertEqual(sorted(insert_paths), sorted(["searchCondition", "searchKeyword", "useYn", "nttId", "nttSj", "nttCn", "ntcrNm"]))
        self.assertEqual(insert["queryDtoType"], "BoardDefaultVO, BoardVO")
        # Framework parameters (ModelMap, BindingResult, SessionStatus, HttpServletRequest) are not request fields.
        self.assertFalse({"model", "bindingResult", "status", "request"} & set(insert_paths))

    def test_egov_fixture_uses_korean_javadoc_for_names(self) -> None:
        document = _scan_fixture("scan_spring.py", "spring-egov")
        endpoints = {(endpoint["method"], endpoint["path"]): endpoint for endpoint in document["endpoints"]}
        self.assertEqual(endpoints[("GET/POST", "/board/selectBoardList.do")]["interfaceName"], "게시글 목록을 조회한다")
        self.assertEqual(endpoints[("POST", "/board/insertBoard.do")]["interfaceName"], "게시글을 등록한다")

        detail = endpoints[("GET/POST", "/board/selectBoard.do")]
        names = {field["path"]: field["nameKo"] for field in detail["responseFields"]}
        self.assertEqual(names["nttId"], "게시글 아이디")
        self.assertEqual(names["nttSj"], "게시글 제목")
        self.assertEqual(names["nttCn"], "게시글 내용")
        self.assertEqual(names["ntcrNm"], "작성자명")
        self.assertEqual(names["useYn"], "사용여부")

    def test_name_dictionary_still_wins_over_javadoc(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            dictionary = Path(temp_dir) / "terms.csv"
            dictionary.write_text("nttSj,게시물 제목\n", encoding="utf-8")
            output_path = Path(temp_dir) / "interface-spec.json"
            subprocess.run(
                [sys.executable, str(SCRIPTS_DIR / "scan_spring.py"), "--codebase-path", str(FIXTURES_DIR / "spring-egov"),
                 "--name-dict", str(dictionary), "--out", str(output_path)],
                check=True, capture_output=True, text=True,
            )
            document = json.loads(output_path.read_text(encoding="utf-8"))
        detail = next(endpoint for endpoint in document["endpoints"] if endpoint["path"] == "/board/selectBoard.do")
        names = {field["path"]: field["nameKo"] for field in detail["responseFields"]}
        self.assertEqual(names["nttSj"], "게시물 제목")
        self.assertEqual(names["nttId"], "게시글 아이디")


if __name__ == "__main__":
    unittest.main()
