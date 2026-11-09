"""Modern Spring/Java shapes the scanner must read: records, constant paths, Jackson names, header and named
request parameters, Map responses and the audit-field rule.

Found by comparing the scanner with plain Claude Code on a large synthetic platform
(docs/testing/abt-scanner-vs-claude-code-2026-11-09.md); each case here is one gap that comparison measured.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
BASE = "src/main/java/x"


def scan(sources: dict[str, str], *extra: str) -> dict:
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir) / "app"
        for relative, body in sources.items():
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(textwrap.dedent(body), encoding="utf-8")
        out = Path(temp_dir) / "spec.json"
        subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / "scan_spring.py"), "--codebase-path", str(root), "--out", str(out), *extra],
            check=True, capture_output=True, text=True,
        )
        return json.loads(out.read_text(encoding="utf-8"))


def endpoint(doc: dict, method: str, path: str) -> dict:
    found = [(e["method"], e["path"]) for e in doc["endpoints"]]
    return next(e for e in doc["endpoints"] if (e["method"], e["path"]) == (method, path)) if (method, path) in found else (_ for _ in ()).throw(
        AssertionError(f"{method} {path} not in {found}"))


def fields(ep: dict, key: str) -> dict[str, dict]:
    return {(f.get("path") or f["nameEn"]): f for f in ep[key]}


class RecordDtoTest(unittest.TestCase):
    SOURCES = {
        f"{BASE}/TapController.java": """
            package x;
            @RestController
            @RequestMapping("/api/v1/taps")
            public class TapController {
                @PostMapping("/entry")
                public ApiResponse<TapResult> entry(@Valid @RequestBody TapRequest request) { return null; }
            }
        """,
        f"{BASE}/TapRequest.java": """
            package x;
            public record TapRequest(
                    @NotBlank @Size(max = 128) String mediaToken,
                    @NotNull Long routeId,
                    List<Leg> legs,
                    Map<String, Object> extra,
                    String note) {
            }
        """,
        f"{BASE}/Leg.java": """
            package x;
            public record Leg(Integer legNo, String name) implements java.io.Serializable {
            }
        """,
        f"{BASE}/TapResult.java": """
            package x;
            public record TapResult(Long tapId, String result) {
            }
        """,
    }

    def test_record_components_are_request_and_response_fields(self) -> None:
        ep = endpoint(scan(self.SOURCES), "POST", "/api/v1/taps/entry")
        req = fields(ep, "requestFields")
        self.assertEqual(set(req), {"mediaToken", "routeId", "legs", "legs.legNo", "legs.name", "extra", "note"})
        self.assertEqual((req["mediaToken"]["required"], req["routeId"]["required"], req["note"]["required"]), ("Y", "Y", "N"))
        self.assertEqual(req["mediaToken"]["maxSize"], "128")
        self.assertEqual(set(fields(ep, "responseFields")), {"tapId", "result"})

    def test_a_record_is_listed_as_the_evidence_file_of_the_endpoint(self) -> None:
        ep = endpoint(scan(self.SOURCES), "POST", "/api/v1/taps/entry")
        refs = {r["ref"] for r in ep["evidenceRefs"] if r["kind"] == "code"}
        self.assertTrue({f"{BASE}/TapRequest.java", f"{BASE}/Leg.java", f"{BASE}/TapResult.java"} <= refs, refs)


class ConstantPathTest(unittest.TestCase):
    SOURCES = {
        f"{BASE}/ApiPaths.java": """
            package x;
            public final class ApiPaths {
                public static final String V1 = "/api/v1";
                public static final String ACCOUNTS = V1 + "/accounts";
                static final String PAYMENTS = ApiPaths.V1 + "/payments";
            }
        """,
        f"{BASE}/AccountController.java": """
            package x;
            @RestController
            @RequestMapping(ApiPaths.ACCOUNTS)
            public class AccountController {
                @GetMapping("/{accountId}")
                public Account get(@PathVariable Long accountId) { return null; }
            }
        """,
        f"{BASE}/InvoiceController.java": """
            package x;
            @RestController
            @RequestMapping(ApiPaths.V1 + "/billing")
            public class InvoiceController {
                private static final String LIST = "/invoices";
                @GetMapping(LIST)
                public List<Invoice> list() { return null; }
                @GetMapping(path = ApiPaths.PAYMENTS)
                public List<Invoice> payments() { return null; }
            }
        """,
    }

    def test_constants_from_any_class_and_concatenations_are_resolved(self) -> None:
        paths = {e["path"] for e in scan(self.SOURCES)["endpoints"]}
        self.assertEqual(paths, {"/api/v1/accounts/{accountId}", "/api/v1/billing/invoices", "/api/v1/billing/api/v1/payments"})


class JacksonNamesTest(unittest.TestCase):
    SOURCES = {
        f"{BASE}/PartnerController.java": """
            package x;
            @RestController
            @RequestMapping("/partner/v1")
            public class PartnerController {
                @PostMapping("/ack")
                public TripPage ack(@RequestBody Ack request) { return null; }
            }
        """,
        f"{BASE}/Ack.java": """
            package x;
            @Data
            public class Ack {
                @JsonProperty("device_id")
                @NotBlank
                private String deviceId;
                @JsonIgnore
                private String internalNote;
                private String plain;
            }
        """,
        f"{BASE}/TripPage.java": """
            package x;
            @Value
            public class TripPage {
                List<TripView> items;
                @JsonProperty("next_cursor") String nextCursor;
                @JsonIgnore String hidden;
            }
        """,
        f"{BASE}/TripView.java": """
            package x;
            public record TripView(@JsonProperty("trip_id") Long tripId, @JsonIgnore String secret, String mode) {
            }
        """,
    }

    def test_json_names_are_used_and_ignored_fields_are_left_out(self) -> None:
        ep = endpoint(scan(self.SOURCES), "POST", "/partner/v1/ack")
        self.assertEqual(set(fields(ep, "requestFields")), {"device_id", "plain"})
        self.assertEqual(fields(ep, "requestFields")["device_id"]["required"], "Y")
        self.assertEqual(set(fields(ep, "responseFields")), {"items", "items.trip_id", "items.mode", "next_cursor"})


class ParameterNamesTest(unittest.TestCase):
    SOURCES = {
        f"{BASE}/PayController.java": """
            package x;
            @RestController
            @RequestMapping("/pay")
            public class PayController {
                @PostMapping("/{paymentId}/refund")
                public Result refund(
                        @PathVariable("paymentId") Long id,
                        @RequestHeader("Idempotency-Key") String key,
                        @RequestHeader(name = "X-Operator-Id", required = false) String operatorId,
                        @RequestParam("from") LocalDate fromDate,
                        @RequestParam(name = "operator_code", required = true) String operatorCode,
                        @RequestParam(required = false) String cursor,
                        @RequestParam(name = "limit", defaultValue = "100") Integer limit,
                        @RequestBody Refund request) { return null; }
            }
        """,
        f"{BASE}/Refund.java": """
            package x;
            public class Refund {
                private String reason;
            }
        """,
        f"{BASE}/Result.java": """
            package x;
            public class Result {
                private String status;
            }
        """,
    }

    def test_names_required_and_types_follow_the_annotations(self) -> None:
        ep = endpoint(scan(self.SOURCES), "POST", "/pay/{paymentId}/refund")
        req = fields(ep, "requestFields")
        self.assertEqual(set(req), {"paymentId", "Idempotency-Key", "X-Operator-Id", "from", "operator_code", "cursor", "limit", "reason"})
        required = {k: v["required"] for k, v in req.items()}
        self.assertEqual(required, {"paymentId": "Y", "Idempotency-Key": "Y", "X-Operator-Id": "N", "from": "Y", "operator_code": "Y",
                                    "cursor": "N", "limit": "N", "reason": "N"})
        self.assertEqual(req["paymentId"]["dataType"], "Long")
        self.assertEqual(req["from"]["dataType"], "LocalDate")
        self.assertEqual(req["Idempotency-Key"]["note"], "request header")


class MapResponseTest(unittest.TestCase):
    SOURCES = {
        f"{BASE}/SettleController.java": """
            package x;
            @Controller
            @RequestMapping("/settle")
            public class SettleController {
                @RequestMapping(value = "/adjust/register.do", method = RequestMethod.POST)
                @ResponseBody
                public Map<String, Object> register(@RequestBody Adjust vo) {
                    Map<String, Object> result = new HashMap<>();
                    result.put("adjustId", 1L);
                    result.put("status", "OK");
                    result.put("approved", true);
                    return result;
                }
            }
        """,
        f"{BASE}/Adjust.java": """
            package x;
            public class Adjust {
                private String reason;
            }
        """,
    }

    def test_put_keys_of_the_returned_map_are_response_fields(self) -> None:
        ep = endpoint(scan(self.SOURCES), "POST", "/settle/adjust/register.do")
        res = fields(ep, "responseFields")
        self.assertEqual(set(res), {"adjustId", "status", "approved"})
        self.assertEqual((res["adjustId"]["dataType"], res["status"]["dataType"], res["approved"]["dataType"]), ("Long", "String", "Boolean"))


class AuditFieldRuleTest(unittest.TestCase):
    SOURCES = {
        f"{BASE}/MediaController.java": """
            package x;
            @RestController
            @RequestMapping("/media")
            public class MediaController {
                @GetMapping("/{id}")
                public Media get(@PathVariable Long id) { return null; }
            }
        """,
        f"{BASE}/Media.java": """
            package x;
            public class Media {
                private Long id;
                private String registeredAt;
                private String region;
                private String registrationNo;
                private String createdAt;
                private String regDate;
                private String lastUpdatedBy;
            }
        """,
    }

    def test_business_names_that_only_contain_an_audit_word_are_kept(self) -> None:
        names = set(fields(endpoint(scan(self.SOURCES), "GET", "/media/{id}"), "responseFields"))
        self.assertEqual(names, {"id", "registeredAt", "region", "registrationNo"})

    def test_audit_columns_can_be_kept_on_request(self) -> None:
        names = set(fields(endpoint(scan(self.SOURCES, "--include-audit-fields"), "GET", "/media/{id}"), "responseFields"))
        self.assertEqual(names, {"id", "registeredAt", "region", "registrationNo", "createdAt", "regDate", "lastUpdatedBy"})


class SizeConstraintTest(unittest.TestCase):
    def test_size_max_is_recorded_so_a_reduction_is_seen_as_a_change(self) -> None:
        sources = {
            f"{BASE}/CController.java": """
                package x;
                @RestController
                @RequestMapping("/c")
                public class CController {
                    @PostMapping
                    public R post(@RequestBody Q q) { return null; }
                }
            """,
            f"{BASE}/Q.java": """
                package x;
                public class Q {
                    @NotBlank @Size(max = 50) private String name;
                    @Size(min = 1, max = 10) private String code;
                    private String free;
                }
            """,
            f"{BASE}/R.java": "package x;\npublic class R { private String ok; }\n",
        }
        req = fields(endpoint(scan(sources), "POST", "/c"), "requestFields")
        self.assertEqual((req["name"].get("maxSize"), req["code"].get("maxSize"), req["free"].get("maxSize")), ("50", "10", None))


class ControllerShapesTest(unittest.TestCase):
    SOURCES = {
        f"{BASE}/AbstractLookupController.java": """
            package x;
            public abstract class AbstractLookupController {
                @GetMapping("/lookup/{id}")
                public Lookup lookup(@PathVariable("id") String id) { return null; }
            }
        """,
        f"{BASE}/AdminCodeController.java": """
            package x;
            @RestController
            @RequestMapping("/api/admin/codes")
            public class AdminCodeController extends AbstractLookupController {
                @GetMapping({"/{group}", "/groups/{group}"})
                public Group group(@PathVariable String group) { return null; }
            }
        """,
        "src/test/java/x/FakeLegacyController.java": """
            package x;
            @RestController
            @RequestMapping("/fake")
            public class FakeLegacyController {
                @GetMapping("/ping")
                public String ping() { return "pong"; }
            }
        """,
        f"{BASE}/Group.java": """
            package x;
            public class Group {
                private String name;
            }
        """,
        f"{BASE}/Lookup.java": """
            package x;
            public class Lookup {
                private String label;
            }
        """,
    }

    def test_alias_paths_inherited_handlers_and_test_sources(self) -> None:
        doc = scan(self.SOURCES)
        paths = sorted(e["path"] for e in doc["endpoints"])
        self.assertEqual(paths, ["/api/admin/codes/groups/{group}", "/api/admin/codes/lookup/{id}", "/api/admin/codes/{group}"])


class MapFromServiceTest(unittest.TestCase):
    SOURCES = {
        f"{BASE}/SettleController.java": """
            package x;
            @Controller
            @RequestMapping("/settle")
            public class SettleController {
                @Resource(name = "settleService")
                private SettleService settleService;

                @RequestMapping(value = "/run.do", method = RequestMethod.POST)
                @ResponseBody
                public Map<String, Object> run(@RequestParam String settleDate) {
                    return settleService.runReconcile(settleDate);
                }
            }
        """,
        f"{BASE}/SettleService.java": """
            package x;
            public interface SettleService {
                Map<String, Object> runReconcile(String settleDate);
            }
        """,
        f"{BASE}/SettleServiceImpl.java": """
            package x;
            public class SettleServiceImpl implements SettleService {
                @Override
                public Map<String, Object> runReconcile(String settleDate) {
                    Map<String, Object> result = new HashMap<>();
                    result.put("jobId", "J1");
                    result.put("mismatchCount", 0);
                    return result;
                }
            }
        """,
    }

    def test_keys_put_by_the_service_method_are_followed(self) -> None:
        ep = endpoint(scan(self.SOURCES), "POST", "/settle/run.do")
        self.assertEqual(set(fields(ep, "responseFields")), {"jobId", "mismatchCount"})


if __name__ == "__main__":
    unittest.main()
