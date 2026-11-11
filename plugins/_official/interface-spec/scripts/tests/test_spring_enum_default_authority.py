"""Enum values, request defaults and required authorities: what a caller must send, gets when it sends nothing,
and must hold. Without them the change analysis cannot see a new enum value, a changed page size or a narrowed role
(ABT scenarios B1-B4 and eGovFrame commit e4823589, docs/testing/real-projects-2026-11-11.md)."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
BASE = "src/main/java/demo"


def scan(sources: dict[str, str]) -> dict[tuple[str, str], dict]:
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir) / "app"
        for relative, body in sources.items():
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(textwrap.dedent(body), encoding="utf-8")
        out = Path(temp_dir) / "spec.json"
        subprocess.run([sys.executable, str(SCRIPTS_DIR / "scan_spring.py"), "--codebase-path", str(root), "--out", str(out)],
                       check=True, capture_output=True, text=True)
        doc = json.loads(out.read_text(encoding="utf-8"))
        return {(e["method"], e["path"]): e for e in doc["endpoints"]}


def fields(endpoint: dict, side: str) -> dict[str, dict]:
    return {f.get("path") or f["nameEn"]: f for f in endpoint[f"{side}Fields"]}


PAYMENTS = {
    f"{BASE}/type/PaymentStatus.java": """
        package demo.type;

        public enum PaymentStatus {
            PAID,
            REFUNDED;

            public boolean isFinal() {
                return this == REFUNDED;
            }
        }
    """,
    # The wire value is the @JsonValue code, not the constant name.
    f"{BASE}/type/RefundReason.java": """
        package demo.type;

        import com.fasterxml.jackson.annotation.JsonValue;

        public enum RefundReason {
            CUSTOMER("customer"),
            DUPLICATE("duplicate");

            private final String code;

            RefundReason(String code) {
                this.code = code;
            }

            @JsonValue
            public String getCode() {
                return code;
            }
        }
    """,
    f"{BASE}/type/Channel.java": """
        package demo.type;

        public enum Channel {
            @JsonProperty("web") WEB,
            @JsonProperty("app") APP
        }
    """,
    f"{BASE}/dto/RefundRequest.java": """
        package demo.dto;

        @Data
        public class RefundRequest {
            @NotNull
            private RefundReason reason;
            private List<PaymentStatus> onlyWhen;
            private Channel channel = Channel.WEB;
            private String memo;
        }
    """,
    f"{BASE}/dto/PaymentView.java": """
        package demo.dto;

        @Data
        public class PaymentView {
            private Long id;
            private PaymentStatus status;
        }
    """,
    f"{BASE}/dto/PageQuery.java": """
        package demo.dto;

        @Data
        public class PageQuery {
            @Min(0)
            private Integer page = 0;
            private Integer size = 20;
            private String sort = "createdAt,desc";
            private boolean includeClosed = false;
            private List<String> tags = new ArrayList<>();
            private static final int MAX = 100;
        }
    """,
    f"{BASE}/web/PaymentController.java": """
        package demo.web;

        @RestController
        @RequestMapping("/payments")
        public class PaymentController {

            @PostMapping("/{id}/refund")
            public PaymentView refund(@PathVariable Long id, @RequestBody RefundRequest request) {
                return null;
            }

            @GetMapping
            public List<PaymentView> list(@RequestParam(required = false) PaymentStatus status,
                                          @RequestParam(value = "size", defaultValue = "20") int size) {
                return null;
            }

            @GetMapping("/search")
            public List<PaymentView> search(PageQuery query) {
                return null;
            }
        }
    """,
}


class EnumValuesTest(unittest.TestCase):
    def test_enum_fields_list_their_wire_values_on_both_sides(self) -> None:
        eps = scan(PAYMENTS)
        refund = eps[("POST", "/payments/{id}/refund")]
        request = fields(refund, "request")
        self.assertEqual(request["reason"]["enumValues"], ["customer", "duplicate"])
        self.assertEqual(request["onlyWhen"]["enumValues"], ["PAID", "REFUNDED"])
        self.assertEqual(request["channel"]["enumValues"], ["web", "app"])
        self.assertNotIn("enumValues", request["memo"])
        self.assertEqual(fields(refund, "response")["status"]["enumValues"], ["PAID", "REFUNDED"])
        # a query parameter typed as an enum too
        self.assertEqual(fields(eps[("GET", "/payments")], "request")["status"]["enumValues"], ["PAID", "REFUNDED"])


class DefaultValuesTest(unittest.TestCase):
    def test_request_param_defaults_and_dto_initializers_are_recorded(self) -> None:
        eps = scan(PAYMENTS)
        self.assertEqual(fields(eps[("GET", "/payments")], "request")["size"]["defaultValue"], "20")
        self.assertNotIn("defaultValue", fields(eps[("GET", "/payments")], "request")["status"])
        query = fields(eps[("GET", "/payments/search")], "request")
        self.assertEqual({name: f.get("defaultValue") for name, f in query.items()}, {
            "page": "0", "size": "20", "sort": "createdAt,desc", "includeClosed": "false",
            # a constructed object is not a literal default
            "tags": None,
        })
        # an enum constant initializer is written as the wire value
        self.assertEqual(fields(eps[("POST", "/payments/{id}/refund")], "request")["channel"]["defaultValue"], "web")

    def test_response_fields_carry_no_default(self) -> None:
        eps = scan({**PAYMENTS, f"{BASE}/dto/PaymentView.java": """
            package demo.dto;

            @Data
            public class PaymentView {
                private Long id;
                private PaymentStatus status = PaymentStatus.PAID;
            }
        """})
        self.assertNotIn("defaultValue", fields(eps[("POST", "/payments/{id}/refund")], "response")["status"])


METHOD_SECURITY = {
    f"{BASE}/config/MethodSecurityConfig.java": """
        package demo.config;

        @Configuration
        @EnableMethodSecurity(securedEnabled = true, jsr250Enabled = true)
        public class MethodSecurityConfig {
        }
    """,
}


class AuthoritiesTest(unittest.TestCase):
    def test_method_security_annotations_name_the_authorities(self) -> None:
        eps = scan({**METHOD_SECURITY, f"{BASE}/web/AdminController.java": """
            package demo.web;

            @RestController
            @RequestMapping("/admin")
            @PreAuthorize("hasRole('ADMIN')")
            public class AdminController {

                @GetMapping("/users")
                public String users() { return null; }

                @PreAuthorize("hasAnyAuthority('SCOPE_users.read', 'SCOPE_users.admin')")
                @GetMapping("/users/{id}")
                public String user(@PathVariable Long id) { return null; }

                @PreAuthorize("hasRole('ADMIN') or hasRole('ROLE_MANAGER')")
                @PostMapping("/users")
                public String create() { return null; }

                @PreAuthorize("hasRole('ADMIN') and #id == principal.id")
                @DeleteMapping("/users/{id}")
                public String delete(@PathVariable Long id) { return null; }

                @PreAuthorize("isAuthenticated()")
                @GetMapping("/me")
                public String me() { return null; }
            }
        """, f"{BASE}/web/ReportController.java": """
            package demo.web;

            @RestController
            public class ReportController {
                @Secured({"ROLE_AUDITOR", "ROLE_ADMIN"})
                @GetMapping("/reports")
                public String reports() { return null; }

                @RolesAllowed("FINANCE")
                @GetMapping("/reports/finance")
                public String finance() { return null; }
            }
        """})
        got = {route: (e.get("authorities"), e.get("accessRule")) for route, e in eps.items()}
        self.assertEqual(got, {
            ("GET", "/admin/users"): (["ROLE_ADMIN"], None),
            ("GET", "/admin/users/{id}"): (["SCOPE_users.read", "SCOPE_users.admin"], None),
            ("POST", "/admin/users"): (["ROLE_ADMIN", "ROLE_MANAGER"], None),
            ("DELETE", "/admin/users/{id}"): (None, "hasRole('ADMIN') and #id == principal.id"),
            ("GET", "/admin/me"): (None, None),
            ("GET", "/reports"): (["ROLE_AUDITOR", "ROLE_ADMIN"], None),
            ("GET", "/reports/finance"): (["ROLE_FINANCE"], None),
        })
        self.assertTrue(all(e["authRequired"] for e in eps.values()))

    def test_url_rules_in_java_and_xml_configuration_name_the_authorities(self) -> None:
        controller = {f"{BASE}/web/SettleController.java": """
            package demo.web;

            @Controller
            public class SettleController {
                @RequestMapping(value = "/settle/adjust.do", method = RequestMethod.POST)
                public String adjust() { return null; }
                @RequestMapping(value = "/settle/list.do", method = RequestMethod.GET)
                public String list() { return null; }
                @RequestMapping(value = "/main.do", method = RequestMethod.GET)
                public String main() { return null; }
            }
        """}
        java = scan({**controller, f"{BASE}/config/SecurityConfig.java": """
            package demo.config;

            @Configuration
            public class SecurityConfig {
                @Bean
                public SecurityFilterChain chain(HttpSecurity http) throws Exception {
                    http.authorizeHttpRequests(auth -> auth
                        .requestMatchers("/settle/adjust.do").hasAnyRole("SETTLE", "ADMIN")
                        .requestMatchers("/settle/**").hasAuthority("SCOPE_settle.read")
                        .anyRequest().authenticated());
                    return http.build();
                }
            }
        """})
        self.assertEqual({route: e.get("authorities") for route, e in java.items()}, {
            ("POST", "/settle/adjust.do"): ["ROLE_SETTLE", "ROLE_ADMIN"],
            ("GET", "/settle/list.do"): ["SCOPE_settle.read"],
            ("GET", "/main.do"): None,
        })
        xml = scan({**controller, "src/main/resources/context-security.xml": """<beans:beans xmlns="http://www.springframework.org/schema/security"
                xmlns:beans="http://www.springframework.org/schema/beans">
            <http>
                <intercept-url pattern="/settle/adjust.do" access="ROLE_ADMIN,ROLE_SETTLE"/>
                <intercept-url pattern="/settle/**" access="hasRole('SETTLE')"/>
                <intercept-url pattern="/**" access="isAuthenticated()"/>
            </http>
        </beans:beans>
        """})
        self.assertEqual({route: e.get("authorities") for route, e in xml.items()}, {
            ("POST", "/settle/adjust.do"): ["ROLE_ADMIN", "ROLE_SETTLE"],
            ("GET", "/settle/list.do"): ["ROLE_SETTLE"],
            ("GET", "/main.do"): None,
        })


if __name__ == "__main__":
    unittest.main()
