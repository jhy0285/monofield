"""Spring scanner auth decisions come from security configuration, never from the URL shape."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
FIXTURES_DIR = SCRIPTS_DIR.parent / "fixtures"
sys.path.insert(0, str(SCRIPTS_DIR))

from tools.excel_generator.collector.spring_security import ant_match  # noqa: E402

UNDECIDED_AUTH = {"type": "undecided"}


def _scan(codebase: Path) -> dict:
    with tempfile.TemporaryDirectory() as temp_dir:
        output_path = Path(temp_dir) / "interface-spec.json"
        subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / "scan_spring.py"), "--codebase-path", str(codebase), "--out", str(output_path)],
            check=True, capture_output=True, text=True,
        )
        return json.loads(output_path.read_text(encoding="utf-8"))


def _scan_sources(sources: dict[str, str], parent: str = "") -> dict:
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir) / parent / "app"
        for relative, body in sources.items():
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(textwrap.dedent(body), encoding="utf-8")
        return _scan(root)


def _status(endpoint: dict) -> str:
    if endpoint.get("auth") == UNDECIDED_AUTH:
        assert endpoint["authRequired"] is True, "undecided auth must keep authRequired true"
        return "undecided"
    return "required" if endpoint["authRequired"] else "public"


def _by_route(document: dict) -> dict[tuple[str, str], dict]:
    return {(endpoint["method"], endpoint["path"]): endpoint for endpoint in document["endpoints"]}


class SpringAuthFixtureTest(unittest.TestCase):
    def test_permit_all_in_security_config_overrides_the_api_v1_prefix(self) -> None:
        document = _scan(FIXTURES_DIR / "spring")
        endpoints = _by_route(document)
        self.assertEqual(document["auth"]["type"], "bearer")

        join = endpoints[("POST", "/api/v1/members/join")]
        self.assertEqual(_status(join), "public")
        self.assertNotIn("auth", join)
        self.assertEqual(join["evidenceRefs"], [{
            "kind": "code",
            "ref": "src/main/java/kr/example/legacy/config/SecurityConfig.java",
            "line": 15,
            "symbol": "SecurityConfig.filterChain",
            "summary": '인증 불필요: antMatchers("/api/v1/members/join").permitAll()',
        }])

        for route, endpoint in endpoints.items():
            if route == ("POST", "/api/v1/members/join"):
                continue
            with self.subTest(route=route):
                self.assertEqual(_status(endpoint), "required")
                self.assertEqual(endpoint["note"], "")
                self.assertEqual([(ref["line"], ref["summary"]) for ref in endpoint["evidenceRefs"]],
                                 [(16, "인증 필요: anyRequest().authenticated()")])

    def test_egov_fixture_without_security_config_keeps_auth_undecided(self) -> None:
        document = _scan(FIXTURES_DIR / "spring-egov")
        self.assertNotIn("auth", document)
        for route, endpoint in _by_route(document).items():
            with self.subTest(route=route):
                self.assertEqual(_status(endpoint), "undecided")
                self.assertIn("인증 여부 확인 필요: Java 보안 설정", endpoint["note"])
                self.assertNotIn("evidenceRefs", endpoint)

    def test_egov_security_overlay_decides_do_urls(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            project = Path(temp_dir) / "board"
            shutil.copytree(FIXTURES_DIR / "spring-egov", project)
            shutil.copytree(FIXTURES_DIR / "spring-egov-security" / "src", project / "src", dirs_exist_ok=True)
            document = _scan(project)
        endpoints = _by_route(document)
        self.assertEqual({route: _status(endpoint) for route, endpoint in endpoints.items()}, {
            ("GET/POST", "/board/selectBoardList.do"): "public",
            ("GET/POST", "/board/selectBoard.do"): "public",
            ("POST", "/board/insertBoard.do"): "required",
        })
        insert = endpoints[("POST", "/board/insertBoard.do")]
        self.assertEqual(insert["note"], "")
        self.assertEqual(insert["evidenceRefs"][0]["symbol"], "EgovSecurityConfig.configure")
        self.assertEqual(insert["evidenceRefs"][0]["summary"], '인증 필요: antMatchers("/**/*.do").hasRole("USER")')
        # Form login names no header or cookie scheme to put on the document.
        self.assertNotIn("auth", document)

    def test_spring_security_fixture_decisions(self) -> None:
        document = _scan(FIXTURES_DIR / "spring-security")
        endpoints = _by_route(document)
        self.assertEqual(document["auth"]["type"], "bearer")
        self.assertEqual({route: _status(endpoint) for route, endpoint in endpoints.items()}, {
            # GET-only permitAll rule; `/api/products/**` also covers the base path.
            ("GET", "/api/products"): "public",
            ("GET", "/api/products/{productId}"): "public",
            ("POST", "/api/products"): "required",
            # A method annotation can only narrow a public URL rule.
            ("GET", "/api/products/{productId}/cost"): "required",
            # @RolesAllowed is inert unless jsr250Enabled is switched on.
            ("GET", "/api/products/{productId}/stock"): "undecided",
            # GET is public, POST is not: one row cannot state both.
            ("GET/POST", "/api/products/search"): "undecided",
            # `PUBLIC_URLS` String[] constant.
            ("POST", "/auth/login"): "public",
            ("POST", "/auth/token/refresh"): "public",
            ("POST", "/auth/logout"): "required",
            # `SecurityPaths.DOCS` constant in another file + class/method annotations.
            ("GET", "/docs/guide"): "public",
            ("GET", "/docs/changelog"): "required",
            ("GET", "/docs/policies"): "required",
            # The commented-out permitAll rule must not open the admin URLs.
            ("GET", "/admin/users"): "required",
            # `web.ignoring()`.
            ("GET", "/health"): "public",
            # The @Order(1) partner chain only checks the source network.
            ("POST", "/partner/orders/callback"): "undecided",
        })

        cost = endpoints[("GET", "/api/products/{productId}/cost")]
        self.assertEqual([(ref["ref"].rsplit("/", 1)[-1], ref["summary"]) for ref in cost["evidenceRefs"]], [
            ("SecurityConfig.java", '인증 불필요: requestMatchers(HttpMethod.GET, "/api/products/**").permitAll()'),
            ("ProductController.java", "인증 필요: @PreAuthorize(\"hasRole('MANAGER')\")"),
        ])
        self.assertEqual(cost["evidenceRefs"][1]["symbol"], "ProductController.getProductCost")

        search = endpoints[("GET/POST", "/api/products/search")]
        self.assertIn("HTTP 메서드별 판정이 다름(GET 인증 불필요, POST 인증 필요)", search["note"])
        self.assertIn("모든 HTTP 메서드를 허용", search["note"])
        self.assertIn("jsr250Enabled", endpoints[("GET", "/api/products/{productId}/stock")]["note"])
        self.assertIn("hasIpAddress", endpoints[("POST", "/partner/orders/callback")]["note"])

        guide = endpoints[("GET", "/docs/guide")]
        self.assertEqual(guide["evidenceRefs"][-1]["summary"], '인증 불필요: @PreAuthorize("permitAll()")')
        changelog = endpoints[("GET", "/docs/changelog")]
        self.assertEqual(changelog["evidenceRefs"][-1]["symbol"], "DocsController")

        # src/test security configuration never decides production endpoints.
        refs = [ref["ref"] for endpoint in document["endpoints"] for ref in endpoint.get("evidenceRefs", [])]
        self.assertFalse(any("src/test/" in ref for ref in refs))

    def test_scanner_summary_counts_auth_statuses(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            result = subprocess.run(
                [sys.executable, str(SCRIPTS_DIR / "scan_spring.py"), "--codebase-path", str(FIXTURES_DIR / "spring-security"),
                 "--out", str(Path(temp_dir) / "interface-spec.json")],
                check=True, capture_output=True, text=True,
            )
        self.assertEqual(json.loads(result.stdout)["auth"], {"required": 6, "public": 6, "undecided": 3})


class SpringAuthEdgeCaseTest(unittest.TestCase):
    CONTROLLER = """\
        package demo;

        @RestController
        public class DemoController {

            @GetMapping("/api/public/notices")
            public String notices() {
                return "";
            }

            @PostMapping("/api/public/notices")
            public String postNotice() {
                return "";
            }

            @GetMapping("/pages/home")
            public String home() {
                return "";
            }

            @GetMapping("/other")
            public String other() {
                return "";
            }
        }
        """

    def test_scoped_chains_helpers_and_unresolvable_matchers(self) -> None:
        document = _scan_sources({
            "src/main/java/demo/DemoController.java": self.CONTROLLER,
            "src/main/java/demo/SecurityConfig.java": """\
                package demo;

                @Configuration
                public class SecurityConfig {

                    @Bean
                    @Order(Ordered.HIGHEST_PRECEDENCE)
                    public SecurityFilterChain api(HttpSecurity http) throws Exception {
                        http.securityMatchers(matchers -> matchers.requestMatchers("/api/**"));
                        http.authorizeHttpRequests(this::apiRules);
                        return http.build();
                    }

                    private void apiRules(AuthorizeHttpRequestsConfigurer<HttpSecurity>.AuthorizationManagerRequestMatcherRegistry auth) {
                        auth.requestMatchers(new AntPathRequestMatcher("/api/public/**", "GET")).permitAll()
                            .requestMatchers(request -> request.getHeader("X-Internal") != null).permitAll()
                            .anyRequest().authenticated();
                    }

                    @Bean
                    public SecurityFilterChain pages(HttpSecurity http) throws Exception {
                        http.authorizeHttpRequests(auth -> auth.requestMatchers("/pages/**").authenticated());
                        return http.build();
                    }
                }
                """,
        })
        endpoints = _by_route(document)
        self.assertEqual({route: _status(endpoint) for route, endpoint in endpoints.items()}, {
            ("GET", "/api/public/notices"): "public",
            # The GET-only rule does not apply and the lambda matcher may match anything.
            ("POST", "/api/public/notices"): "undecided",
            ("GET", "/pages/home"): "required",
            ("GET", "/other"): "undecided",
        })
        notices = endpoints[("GET", "/api/public/notices")]
        self.assertEqual(notices["evidenceRefs"][0]["symbol"], "SecurityConfig.apiRules")
        self.assertIn("해석할 수 없는 매처", endpoints[("POST", "/api/public/notices")]["note"])
        self.assertIn("SecurityConfig.pages에 이 경로와 일치하는 인가 규칙 없음", endpoints[("GET", "/other")]["note"])

    def test_test_sources_decide_neither_endpoint_auth_nor_the_scheme(self) -> None:
        document = _scan_sources({
            "src/main/java/demo/DemoController.java": self.CONTROLLER,
            "src/test/java/demo/TestSecurityConfig.java": """\
                package demo;

                public class TestSecurityConfig {
                    @Bean
                    public SecurityFilterChain open(HttpSecurity http) throws Exception {
                        http.authorizeHttpRequests(auth -> auth.anyRequest().permitAll())
                            .oauth2ResourceServer(oauth2 -> oauth2.jwt());
                        return http.build();
                    }
                }
                """,
        })
        self.assertNotIn("auth", document)
        self.assertEqual({_status(endpoint) for endpoint in document["endpoints"]}, {"undecided"})

    def test_a_checkout_under_a_build_directory_is_still_production_code(self) -> None:
        document = _scan_sources({
            "src/main/java/demo/DemoController.java": self.CONTROLLER,
            "src/main/java/demo/SecurityConfig.java": """\
                package demo;

                public class SecurityConfig extends WebSecurityConfigurerAdapter {
                    @Override
                    protected void configure(HttpSecurity http) throws Exception {
                        http.authorizeRequests().anyRequest().authenticated()
                            .and().oauth2ResourceServer().jwt();
                    }
                }
                """,
        }, parent="build")
        self.assertEqual(document["auth"]["type"], "bearer")
        self.assertEqual({_status(endpoint) for endpoint in document["endpoints"]}, {"required"})


class AntMatchTest(unittest.TestCase):
    def test_wildcards_cover_path_variables_but_literals_do_not(self) -> None:
        cases = [
            ("/**/*.do", "/board/insertBoard.do", True),
            ("/api/**", "/api", True),
            ("/api/products/**", "/api/products/{productId}/cost", True),
            ("/orders/*", "/orders/{orderId}", True),
            ("/orders/{id}", "/orders/{orderId}", True),
            ("/orders/*.json", "/orders/{orderId}.json", True),
            ("/api/v?/orders", "/api/v1/orders", True),
            ("/orders/public", "/orders/{orderId}", False),
            ("/orders/*", "/orders/{orderId}/items", False),
            ("orders/**", "/orders", False),
            ("/api/v1/members/join", "/api/v1/members/{memberId}", False),
        ]
        for pattern, path, expected in cases:
            with self.subTest(pattern=pattern, path=path):
                self.assertEqual(ant_match(pattern, path), expected)


if __name__ == "__main__":
    unittest.main()
