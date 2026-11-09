"""XML Spring Security configuration (`context-security.xml`, eGovFrame style) decides endpoint auth like the Java one."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
UNDECIDED = {"type": "undecided"}


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


def status(endpoint: dict) -> str:
    if endpoint.get("auth") == UNDECIDED:
        return "undecided"
    return "required" if endpoint["authRequired"] else "public"


CONTROLLERS = {
    "src/main/java/x/SettleController.java": """
        package x;
        @Controller
        @RequestMapping("/settle")
        public class SettleController {
            @RequestMapping(value = "/daily/list.do", method = RequestMethod.GET)
            public String list() { return null; }
            @RequestMapping(value = "/adjust.do", method = RequestMethod.POST)
            public String adjust() { return null; }
        }
    """,
    "src/main/java/x/LoginController.java": """
        package x;
        @Controller
        public class LoginController {
            @RequestMapping(value = "/login.do", method = RequestMethod.GET)
            public String login() { return null; }
            @RequestMapping(value = "/main.do", method = RequestMethod.GET)
            public String main() { return null; }
            @RequestMapping(value = "/resources/ping", method = RequestMethod.GET)
            public String ping() { return null; }
        }
    """,
}

SECURITY_NS = ('xmlns="http://www.springframework.org/schema/security" xmlns:beans="http://www.springframework.org/schema/beans" '
               'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"')


class XmlSecurityTest(unittest.TestCase):
    def test_intercept_urls_decide_in_order_and_security_none_is_public(self) -> None:
        eps = scan({**CONTROLLERS, "src/main/resources/egovframework/spring/context-security.xml": f"""<?xml version="1.0" encoding="UTF-8"?>
            <beans:beans {SECURITY_NS}>
                <!-- static resources -->
                <http pattern="/resources/**" security="none"/>
                <http use-expressions="true">
                    <intercept-url pattern="/login.do" access="permitAll"/>
                    <intercept-url pattern="/settle/**" access="hasRole('ROLE_SETTLE')"/>
                    <intercept-url pattern="/**" access="isAuthenticated()"/>
                </http>
            </beans:beans>
        """})
        self.assertEqual({k: status(v) for k, v in eps.items()}, {
            ("GET", "/settle/daily/list.do"): "required", ("POST", "/settle/adjust.do"): "required",
            ("GET", "/login.do"): "public", ("GET", "/main.do"): "required", ("GET", "/resources/ping"): "public",
        })

    def test_the_decision_cites_the_xml_file_and_line(self) -> None:
        eps = scan({**CONTROLLERS, "src/main/resources/context-security.xml": f"""<beans:beans {SECURITY_NS}>
            <http>
                <intercept-url pattern="/settle/**" access="hasRole('ROLE_SETTLE')"/>
                <intercept-url pattern="/**" access="permitAll"/>
            </http>
        </beans:beans>
        """})
        refs = [r for r in eps[("GET", "/settle/daily/list.do")]["evidenceRefs"] if r["ref"].endswith("context-security.xml")]
        self.assertEqual(len(refs), 1, refs)
        self.assertEqual(refs[0]["line"], 3)
        self.assertIn("settle", refs[0]["summary"])

    def test_prefixed_namespace_chain_pattern_and_old_style_attributes(self) -> None:
        eps = scan({**CONTROLLERS, "src/main/resources/context-security.xml": """<beans:beans xmlns:security="http://www.springframework.org/schema/security"
                xmlns:beans="http://www.springframework.org/schema/beans">
            <security:http pattern="/settle/**" use-expressions="false">
                <security:intercept-url pattern="/settle/adjust.do" access="ROLE_ADMIN,ROLE_SETTLE"/>
                <security:intercept-url pattern="/settle/**" access="IS_AUTHENTICATED_ANONYMOUSLY"/>
            </security:http>
        </beans:beans>
        """})
        got = {k: status(v) for k, v in eps.items()}
        self.assertEqual(got[("POST", "/settle/adjust.do")], "required")
        self.assertEqual(got[("GET", "/settle/daily/list.do")], "public")
        # no chain covers the rest: still undecided, never guessed
        self.assertEqual(got[("GET", "/main.do")], "undecided")

    def test_http_method_attribute_and_unevaluable_rules(self) -> None:
        eps = scan({**CONTROLLERS, "src/main/resources/context-security.xml": f"""<beans:beans {SECURITY_NS}>
            <http>
                <intercept-url pattern="/settle/daily/list.do" method="GET" access="permitAll"/>
                <intercept-url pattern="/settle/**" access="hasIpAddress('10.0.0.0/8')"/>
                <intercept-url pattern="/**" access="isAuthenticated()"/>
            </http>
        </beans:beans>
        """})
        self.assertEqual(status(eps[("GET", "/settle/daily/list.do")]), "public")
        self.assertEqual(status(eps[("POST", "/settle/adjust.do")]), "undecided")
        self.assertIn("hasIpAddress", eps[("POST", "/settle/adjust.do")]["note"])

    def test_xml_and_java_chains_decide_together(self) -> None:
        eps = scan({**CONTROLLERS,
                    "src/main/java/x/ApiController.java": """
                        package x;
                        @RestController
                        @RequestMapping("/api")
                        public class ApiController {
                            @GetMapping("/ping")
                            public String ping() { return null; }
                        }
                    """,
                    "src/main/java/x/SecurityConfig.java": """
                        package x;
                        @Configuration
                        public class SecurityConfig {
                            @Bean
                            public SecurityFilterChain api(HttpSecurity http) throws Exception {
                                http.securityMatcher("/api/**")
                                    .authorizeHttpRequests(a -> a.requestMatchers("/api/ping").permitAll().anyRequest().authenticated());
                                return http.build();
                            }
                        }
                    """,
                    "src/main/resources/context-security.xml": f"""<beans:beans {SECURITY_NS}>
                        <http pattern="/settle/**">
                            <intercept-url pattern="/settle/**" access="hasRole('ROLE_SETTLE')"/>
                        </http>
                    </beans:beans>
                    """})
        got = {k: status(v) for k, v in eps.items()}
        self.assertEqual(got[("GET", "/api/ping")], "public")
        self.assertEqual(got[("GET", "/settle/daily/list.do")], "required")

    def test_xml_that_is_not_security_or_not_production_is_ignored(self) -> None:
        eps = scan({**CONTROLLERS,
                    "src/main/resources/mapper/board.xml": """<mapper namespace="x"><select id="a">select 1</select></mapper>""",
                    "target/classes/context-security.xml": f"""<beans:beans {SECURITY_NS}><http><intercept-url pattern="/**" access="permitAll"/></http></beans:beans>""",
                    "src/test/resources/context-security.xml": f"""<beans:beans {SECURITY_NS}><http><intercept-url pattern="/**" access="permitAll"/></http></beans:beans>"""})
        self.assertEqual({status(v) for v in eps.values()}, {"undecided"})

    def test_entity_declarations_are_never_expanded(self) -> None:
        eps = scan({**CONTROLLERS, "src/main/resources/context-security.xml": f"""<?xml version="1.0"?>
            <!DOCTYPE beans [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]>
            <beans:beans {SECURITY_NS}><http><intercept-url pattern="/**" access="permitAll"/></http></beans:beans>
        """})
        self.assertEqual({status(v) for v in eps.values()}, {"undecided"})


if __name__ == "__main__":
    unittest.main()
