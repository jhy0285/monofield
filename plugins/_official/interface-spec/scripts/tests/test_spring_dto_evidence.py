"""A Spring endpoint names the DTO source files its fields came from, so a change to a DTO alone is seen by the change analysis."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
FIXTURES_DIR = SCRIPTS_DIR.parent / "fixtures"
DTO_DIR = "src/main/java/kr/example/legacy"


def _scan(codebase: Path) -> dict:
    with tempfile.TemporaryDirectory() as temp_dir:
        output_path = Path(temp_dir) / "interface-spec.json"
        subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / "scan_spring.py"), "--codebase-path", str(codebase), "--out", str(output_path)],
            check=True, capture_output=True, text=True,
        )
        return json.loads(output_path.read_text(encoding="utf-8"))


def _scan_sources(sources: dict[str, str]) -> dict:
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir) / "app"
        for relative, body in sources.items():
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(textwrap.dedent(body), encoding="utf-8")
        return _scan(root)


def _endpoint(document: dict, method: str, path: str) -> dict:
    return next(e for e in document["endpoints"] if (e["method"], e["path"]) == (method, path))


def _dto_refs(endpoint: dict) -> list[tuple[str, str, str]]:
    """(file, symbol, summary) of the code references that are not security rules."""
    return [(ref["ref"], ref["symbol"], ref["summary"]) for ref in endpoint.get("evidenceRefs", [])
            if ref["kind"] == "code" and "line" not in ref]


class SpringDtoEvidenceTest(unittest.TestCase):
    def test_request_and_response_dtos_are_recorded_with_their_files(self) -> None:
        join = _endpoint(_scan(FIXTURES_DIR / "spring"), "POST", "/api/v1/members/join")
        self.assertEqual(_dto_refs(join), [
            (f"{DTO_DIR}/member/dto/MemberJoinRequest.java", "MemberJoinRequest", "요청 DTO: MemberJoinRequest"),
            (f"{DTO_DIR}/member/dto/MemberResponse.java", "MemberResponse", "응답 DTO: MemberResponse"),
        ])

    def test_query_dto_nested_dto_and_list_response_are_followed(self) -> None:
        document = _scan(FIXTURES_DIR / "spring")
        create = _endpoint(document, "POST", "/api/v1/orders")
        self.assertEqual([(file, summary) for file, _, summary in _dto_refs(create)], [
            (f"{DTO_DIR}/order/dto/OrderCreateRequest.java", "요청 DTO: OrderCreateRequest"),
            (f"{DTO_DIR}/order/dto/OrderItemRequest.java", "요청 DTO: OrderItemRequest"),
            (f"{DTO_DIR}/order/dto/OrderResponse.java", "응답 DTO: OrderResponse"),
        ])
        search = _endpoint(document, "GET", "/api/v1/orders")
        self.assertEqual([(file, summary) for file, _, summary in _dto_refs(search)], [
            (f"{DTO_DIR}/order/dto/OrderSearchDto.java", "요청 DTO: OrderSearchDto"),
            (f"{DTO_DIR}/order/dto/OrderResponse.java", "응답 DTO: OrderResponse"),
        ])

    def test_security_evidence_is_kept_and_listed_first(self) -> None:
        join = _endpoint(_scan(FIXTURES_DIR / "spring"), "POST", "/api/v1/members/join")
        self.assertEqual(join["evidenceRefs"][0]["symbol"], "SecurityConfig.filterChain")
        self.assertEqual(join["evidenceRefs"][0]["line"], 15)

    def test_a_parent_class_of_a_dto_counts_too(self) -> None:
        document = _scan_sources({
            "src/main/java/demo/BaseRequest.java": """
                package demo;
                public class BaseRequest { private String traceId; }
            """,
            "src/main/java/demo/PingRequest.java": """
                package demo;
                public class PingRequest extends BaseRequest { private String message; }
            """,
            "src/main/java/demo/PingController.java": """
                package demo;
                import org.springframework.web.bind.annotation.*;
                @RestController
                @RequestMapping("/ping")
                public class PingController {
                    @PostMapping
                    public String ping(@RequestBody PingRequest request) { return "ok"; }
                }
            """,
        })
        ping = _endpoint(document, "POST", "/ping")
        self.assertEqual([file for file, _, _ in _dto_refs(ping)],
                         ["src/main/java/demo/PingRequest.java", "src/main/java/demo/BaseRequest.java"])

    def test_primitive_and_unknown_types_add_nothing(self) -> None:
        document = _scan_sources({
            "src/main/java/demo/PingController.java": """
                package demo;
                import org.springframework.web.bind.annotation.*;
                @RestController
                public class PingController {
                    @GetMapping("/ping")
                    public String ping(@RequestParam String name) { return "ok"; }
                }
            """,
        })
        self.assertEqual(_dto_refs(_endpoint(document, "GET", "/ping")), [])


if __name__ == "__main__":
    unittest.main()
