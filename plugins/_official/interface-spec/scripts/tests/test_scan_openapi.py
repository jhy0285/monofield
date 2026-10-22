"""OpenAPI / Swagger contract collector regressions."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
FIXTURES_DIR = SCRIPTS_DIR.parent / "fixtures"


def _scan(*args: str) -> dict:
    with tempfile.TemporaryDirectory() as temp_dir:
        out = Path(temp_dir) / "interface-spec.json"
        subprocess.run([sys.executable, str(SCRIPTS_DIR / "scan_openapi.py"), *args, "--out", str(out)],
                       check=True, capture_output=True, text=True)
        return json.loads(out.read_text(encoding="utf-8"))


def _by_route(document: dict) -> dict:
    return {(endpoint["method"], endpoint["path"]): endpoint for endpoint in document["endpoints"]}


def _fields(endpoint: dict, kind: str) -> dict:
    return {field["path"]: field for field in endpoint[kind]}


class OpenApiCollectorTest(unittest.TestCase):
    def test_openapi3_contract_found_in_a_folder(self) -> None:
        document = _scan("--codebase-path", str(FIXTURES_DIR / "openapi"))
        self.assertEqual(document["source"]["collector"], "static-openapi")
        self.assertEqual(document["source"]["framework"], "openapi-3.0.1")
        self.assertEqual(document["cover"], {"brand": "", "docName": "주문 서비스 API", "version": "2.3.0", "department": ""})
        self.assertEqual(document["auth"]["type"], "bearer")
        routes = _by_route(document)
        self.assertEqual(set(routes), {
            ("GET", "/api/v1/orders"), ("POST", "/api/v1/orders"),
            ("GET", "/api/v1/orders/{orderId}"), ("GET", "/api/v1/health"),
        })

        create = routes[("POST", "/api/v1/orders")]
        self.assertEqual((create["interfaceId"], create["interfaceName"], create["handlerName"]), ("IF-ORD-001", "주문 등록", "createOrder"))
        self.assertTrue(create["authRequired"])
        request = _fields(create, "requestFields")
        self.assertEqual(list(request), ["memberId", "items", "items.productId", "items.quantity", "deliveryMemo"])
        self.assertEqual(request["items"]["dataType"], "List<OrderItemRequest>")
        self.assertEqual((request["items.productId"]["parentPath"], request["items.productId"]["depth"]), ("items", 1))
        self.assertEqual(request["deliveryMemo"]["nameKo"], "배송 요청 사항")
        self.assertEqual(request["deliveryMemo"]["note"], "택배 기사에게 전달됩니다.")
        self.assertEqual((request["deliveryMemo"]["required"], request["deliveryMemo"]["maxSize"]), ("N", "200"))
        self.assertEqual(request["memberId"]["required"], "Y")

        response = _fields(create, "responseFields")
        # allOf merges the audit base with the order schema and its required list.
        self.assertEqual(list(response), ["createdAt", "orderId", "status", "totalAmount"])
        self.assertEqual((response["orderId"]["required"], response["createdAt"]["required"]), ("Y", "N"))
        self.assertEqual(response["status"]["note"], "PAID, PENDING, CANCELLED")

    def test_parameters_security_and_deprecation(self) -> None:
        routes = _by_route(_scan("--spec", str(FIXTURES_DIR / "openapi" / "openapi.json")))
        search = _fields(routes[("GET", "/api/v1/orders")], "requestFields")
        self.assertEqual(search["status"]["note"], "request param; PAID, PENDING, CANCELLED")
        self.assertEqual(search["status"]["nameKo"], "주문 상태")
        self.assertEqual(search["X-Trace-Id"]["note"], "request header")
        detail = _fields(routes[("GET", "/api/v1/orders/{orderId}")], "requestFields")
        self.assertEqual((detail["orderId"]["required"], detail["orderId"]["dataType"]), ("Y", "Long"))
        self.assertEqual(detail["orderId"]["note"], "path variable")
        self.assertTrue(routes[("GET", "/api/v1/orders/{orderId}")]["responseFields"])

        health = routes[("GET", "/api/v1/health")]
        self.assertFalse(health["authRequired"])  # operation-level `security: []` overrides the global scheme
        self.assertEqual(health["note"], "deprecated")

    def test_swagger2_body_parameters_base_path_and_unknown_response_presence(self) -> None:
        document = _scan("--spec", str(FIXTURES_DIR / "swagger2" / "api-docs.json"))
        self.assertEqual(document["source"]["framework"], "swagger-2.0")
        self.assertEqual(document["auth"], {"type": "api-key", "location": "header", "name": "X-API-KEY",
                                            "valueFormat": "{apiKey}", "description": "API 키"})
        routes = _by_route(document)
        join = routes[("POST", "/member-api/members")]
        self.assertTrue(join["authRequired"])
        self.assertEqual(join["requestBodyType"], "MemberJoinRequest")
        request = _fields(join, "requestFields")
        self.assertEqual((request["loginId"]["required"], request["loginId"]["minSize"], request["loginId"]["maxSize"]), ("Y", "4", "20"))
        # Without a `required` list the contract says nothing about response presence.
        self.assertEqual({field["required"] for field in join["responseFields"]}, {"TBD"})

        member = routes[("GET", "/member-api/members/{memberId}")]
        self.assertFalse(member["authRequired"])
        self.assertEqual(_fields(member, "requestFields")["memberId"]["dataType"], "Long")

    def test_dictionary_overrides_descriptions_and_inventory_lists_modules(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            dictionary = Path(temp_dir) / "terms.csv"
            dictionary.write_text("memberId,회원번호\n", encoding="utf-8")
            document = _scan("--spec", str(FIXTURES_DIR / "openapi" / "openapi.json"), "--name-dict", str(dictionary))
        create = _by_route(document)[("POST", "/api/v1/orders")]
        self.assertEqual(_fields(create, "requestFields")["memberId"]["nameKo"], "회원번호")

        inventory = subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / "scan_openapi.py"), "--spec", str(FIXTURES_DIR / "openapi" / "openapi.json"),
             "--inventory-only"],
            check=True, capture_output=True, text=True,
        )
        summary = json.loads(inventory.stdout)
        self.assertEqual(summary["endpointCount"], 4)
        self.assertEqual(summary["modules"], {"orders": 3, "system": 1})


if __name__ == "__main__":
    unittest.main()
