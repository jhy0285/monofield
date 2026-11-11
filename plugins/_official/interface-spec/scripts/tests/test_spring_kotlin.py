"""Spring MVC controllers, DTOs and security configuration written in Kotlin.

Kotlin differs from Java where it matters to the scanner: `name: Type` parameters, `?` for optional values, array
literals `[...]` in annotations, data classes whose constructor is the field list, `mapOf("k" to v)` bodies and the
`http { authorizeHttpRequests { authorize(...) } }` security DSL.
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
BASE = "src/main/kotlin/demo"


def scan(sources: dict[str, str]) -> dict:
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir) / "app"
        for relative, body in sources.items():
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(textwrap.dedent(body), encoding="utf-8")
        out = Path(temp_dir) / "spec.json"
        subprocess.run([sys.executable, str(SCRIPTS_DIR / "scan_spring.py"), "--codebase-path", str(root), "--out", str(out)],
                       check=True, capture_output=True, text=True)
        return json.loads(out.read_text(encoding="utf-8"))


def by_route(doc: dict) -> dict[tuple[str, str], dict]:
    return {(e["method"], e["path"]): e for e in doc["endpoints"]}


def fields(endpoint: dict, side: str) -> dict[str, dict]:
    return {f.get("path") or f["nameEn"]: f for f in endpoint[f"{side}Fields"]}


ARTICLES = {
    f"{BASE}/api/ArticleController.kt": """
        package demo.api

        import org.springframework.http.HttpStatus
        import org.springframework.http.MediaType
        import org.springframework.http.ResponseEntity
        import org.springframework.web.bind.annotation.*

        @RestController
        @RequestMapping("/api/articles")
        class ArticleController(private val service: ArticleService) {

            /** 게시글 목록 조회 */
            @GetMapping(produces = [MediaType.APPLICATION_JSON_VALUE])
            fun getArticles(
                @RequestParam(defaultValue = "20") limit: Int,
                @RequestParam tag: String?,
                @RequestParam(required = false) status: ArticleStatus?,
                request: HttpServletRequest,
            ): ResponseEntity<Map<String, Any>> {
                val articles = service.getArticles(limit, tag)
                return ResponseEntity.status(HttpStatus.OK).body(mapOf("articles" to articles, "articlesCount" to articles.size))
            }

            @GetMapping("/{slug}", produces = [MediaType.APPLICATION_JSON_VALUE])
            fun getArticle(@PathVariable slug: String): ArticleDto = service.getArticle(slug)

            @PostMapping(
                consumes = [MediaType.APPLICATION_JSON_VALUE],
                produces = [MediaType.APPLICATION_JSON_VALUE]
            )
            fun createArticle(
                @RequestBody request: CreateArticleRequest,
                @RequestHeader("X-Trace-Id") traceId: String?,
            ): ResponseEntity<Map<String, ArticleDto>> {
                return ResponseEntity(mapOf("article" to service.create(request)), HttpStatus.CREATED)
            }

            @DeleteMapping("/{slug}")
            fun deleteArticle(@PathVariable("slug") id: String): ResponseEntity<Unit> = ResponseEntity.noContent().build()

            @RequestMapping(path = ["/search", "/find"], method = [RequestMethod.GET, RequestMethod.POST])
            fun search(@ModelAttribute query: ArticleQuery): List<ArticleDto> = emptyList()

            private fun helper(): String = "not an endpoint"
        }
    """,
    f"{BASE}/api/ArticleDto.kt": """
        package demo.api

        import com.fasterxml.jackson.annotation.JsonIgnore
        import com.fasterxml.jackson.annotation.JsonProperty
        import com.fasterxml.jackson.annotation.JsonValue
        import jakarta.validation.constraints.NotBlank
        import jakarta.validation.constraints.Size

        data class ArticleDto(
            val slug: String,
            val title: String,
            @JsonProperty("tagList") val tags: List<String> = emptyList(),
            val author: ProfileDto,
            val status: ArticleStatus,
            @JsonIgnore val internalId: Long = 0,
        )

        data class ProfileDto(val username: String, val bio: String?)

        data class CreateArticleRequest(
            @field:NotBlank @field:Size(max = 120) val title: String,
            val body: String,
            val description: String? = null,
            val draft: Boolean = false,
            val status: ArticleStatus = ArticleStatus.DRAFT,
        )

        class ArticleQuery {
            var keyword: String? = null
            var size: Int = 20
            var page: Int = 0
        }

        enum class ArticleStatus(@get:JsonValue val code: String) {
            DRAFT("draft"),
            PUBLISHED("published");
        }
    """,
    f"{BASE}/api/ArticleService.kt": """
        package demo.api

        @Service
        class ArticleService(private val repository: ArticleRepository) {
            fun getArticles(limit: Int, tag: String?): List<ArticleDto> = repository.find(limit, tag)

            fun getArticle(slug: String): ArticleDto = repository.get(slug)

            fun create(request: CreateArticleRequest): ArticleDto {
                return repository.save(request)
            }
        }
    """,
    f"{BASE}/api/ApiExceptionHandler.kt": """
        package demo.api

        @RestControllerAdvice
        class ApiExceptionHandler {
            @GetMapping("/never")
            fun notAnEndpoint(): String = ""
        }
    """,
    "src/test/kotlin/demo/api/TestController.kt": """
        package demo.api

        @RestController
        class TestController {
            @GetMapping("/test-only")
            fun t(): String = ""
        }
    """,
}


class KotlinControllersTest(unittest.TestCase):
    def test_routes_methods_and_language(self) -> None:
        doc = scan(ARTICLES)
        self.assertEqual(sorted(by_route(doc)), [
            ("DELETE", "/api/articles/{slug}"), ("GET", "/api/articles"), ("GET", "/api/articles/{slug}"),
            ("GET/POST", "/api/articles/find"), ("GET/POST", "/api/articles/search"), ("POST", "/api/articles"),
        ])
        self.assertEqual(doc["source"]["language"], "kotlin")
        listing = by_route(doc)[("GET", "/api/articles")]
        self.assertEqual(listing["handlerName"], "getArticles")
        self.assertEqual(listing["interfaceName"], "게시글 목록 조회")
        self.assertTrue(listing["sourceFile"].endswith("ArticleController.kt"))

    def test_parameters_follow_kotlin_nullability(self) -> None:
        eps = by_route(scan(ARTICLES))
        query = fields(eps[("GET", "/api/articles")], "request")
        self.assertEqual({k: (f["dataType"], f["required"], f.get("defaultValue")) for k, f in query.items()}, {
            "limit": ("Integer", "N", "20"),
            "tag": ("String", "N", None),
            "status": ("ArticleStatus", "N", None),
        })
        self.assertEqual(query["status"]["enumValues"], ["DRAFT", "PUBLISHED"])  # bound by constant name
        self.assertEqual(fields(eps[("DELETE", "/api/articles/{slug}")], "request")["slug"]["required"], "Y")
        create = fields(eps[("POST", "/api/articles")], "request")
        self.assertEqual(create["X-Trace-Id"]["required"], "N")

    def test_request_body_data_class(self) -> None:
        create = fields(by_route(scan(ARTICLES))[("POST", "/api/articles")], "request")
        body = {k: (f["dataType"], f["required"], f.get("defaultValue"), f.get("maxSize", "")) for k, f in create.items()
                if k != "X-Trace-Id"}
        self.assertEqual(body, {
            "title": ("String", "Y", None, "120"),
            # non-null without a default: jackson-module-kotlin rejects a body without it
            "body": ("String", "Y", None, ""),
            "description": ("String", "N", None, ""),
            "draft": ("Boolean", "N", "false", ""),
            "status": ("ArticleStatus", "N", "draft", ""),
        })
        self.assertEqual(create["status"]["enumValues"], ["draft", "published"])  # @get:JsonValue code

    def test_responses_from_return_types_and_map_bodies(self) -> None:
        eps = by_route(scan(ARTICLES))
        detail = [f["path"] for f in eps[("GET", "/api/articles/{slug}")]["responseFields"]]
        self.assertEqual(detail, ["slug", "title", "tagList", "author", "author.username", "author.bio", "status"])
        listing = fields(eps[("GET", "/api/articles")], "response")
        self.assertEqual(listing["articles"]["dataType"], "List<ArticleDto>")
        self.assertIn("articles.author.username", listing)
        self.assertEqual(listing["articlesCount"]["dataType"], "Integer")
        created = [f["path"] for f in eps[("POST", "/api/articles")]["responseFields"]]
        self.assertEqual(created[:2], ["article", "article.slug"])
        self.assertEqual([f["path"] for f in eps[("GET/POST", "/api/articles/search")]["requestFields"]],
                         ["keyword", "size", "page"])
        self.assertEqual(fields(eps[("GET/POST", "/api/articles/search")], "request")["size"]["defaultValue"], "20")

    def test_java_and_kotlin_controllers_in_one_project(self) -> None:
        doc = scan({**ARTICLES, "src/main/java/demo/legacy/HealthController.java": """
            package demo.legacy;

            @RestController
            public class HealthController {
                @GetMapping("/health")
                public String health() { return "ok"; }
            }
        """})
        self.assertIn(("GET", "/health"), by_route(doc))
        self.assertIn(("GET", "/api/articles"), by_route(doc))
        self.assertEqual(doc["source"]["language"], "java, kotlin")


SECURITY = {
    f"{BASE}/api/AdminController.kt": """
        package demo.api

        @RestController
        @RequestMapping("/api/admin")
        @PreAuthorize("hasRole('ADMIN')")
        class AdminController {
            @GetMapping("/users")
            fun users(): List<String> = emptyList()

            @PreAuthorize("hasAnyAuthority('SCOPE_audit.read', 'SCOPE_audit.admin')")
            @GetMapping("/audit")
            fun audit(): List<String> = emptyList()
        }
    """,
    f"{BASE}/api/PublicController.kt": """
        package demo.api

        @RestController
        class PublicController {
            @GetMapping("/api/tags")
            fun tags(): List<String> = emptyList()

            @GetMapping("/api/profiles/{username}")
            fun profile(@PathVariable username: String): String = username

            @PostMapping("/api/reports")
            fun report(): String = ""
        }
    """,
    f"{BASE}/config/SecurityConfig.kt": """
        package demo.config

        @Configuration
        @EnableWebSecurity
        @EnableMethodSecurity
        class SecurityConfig {
            @Bean
            fun filterChain(http: HttpSecurity): SecurityFilterChain {
                http {
                    csrf { disable() }
                    authorizeHttpRequests {
                        authorize(HttpMethod.GET, "/api/tags", permitAll)
                        authorize("/api/profiles/**", permitAll)
                        authorize("/api/reports", hasAnyRole("REPORTER", "ADMIN"))
                        authorize(anyRequest, authenticated)
                    }
                }
                return http.build()
            }
        }
    """,
}


class KotlinSecurityTest(unittest.TestCase):
    def test_kotlin_dsl_rules_and_method_security_decide_auth(self) -> None:
        eps = by_route(scan(SECURITY))
        got = {route: (e["authRequired"], e.get("auth"), e.get("authorities")) for route, e in eps.items()}
        self.assertEqual(got, {
            ("GET", "/api/tags"): (False, None, None),
            ("GET", "/api/profiles/{username}"): (False, None, None),
            ("POST", "/api/reports"): (True, None, ["ROLE_REPORTER", "ROLE_ADMIN"]),
            ("GET", "/api/admin/users"): (True, None, ["ROLE_ADMIN"]),
            ("GET", "/api/admin/audit"): (True, None, ["SCOPE_audit.read", "SCOPE_audit.admin"]),
        })
        refs = [r for r in eps[("GET", "/api/tags")]["evidenceRefs"] if r["ref"].endswith("SecurityConfig.kt")]
        self.assertTrue(refs, eps[("GET", "/api/tags")]["evidenceRefs"])

    def test_java_style_chain_written_in_kotlin(self) -> None:
        eps = by_route(scan({**SECURITY, f"{BASE}/config/SecurityConfig.kt": """
            package demo.config

            @Configuration
            class SecurityConfig {
                @Bean
                fun filterChain(http: HttpSecurity): SecurityFilterChain {
                    http.authorizeHttpRequests {
                        it.requestMatchers("/api/tags", "/api/profiles/**").permitAll()
                            .anyRequest().authenticated()
                    }
                    return http.build()
                }
            }
        """}))
        self.assertFalse(eps[("GET", "/api/tags")]["authRequired"])
        self.assertTrue(eps[("POST", "/api/reports")]["authRequired"])
        self.assertNotIn("auth", eps[("POST", "/api/reports")])


FIXTURES = SCRIPTS_DIR.parent / "fixtures"


def scan_dir(codebase: Path) -> dict:
    with tempfile.TemporaryDirectory() as temp_dir:
        out = Path(temp_dir) / "spec.json"
        subprocess.run([sys.executable, str(SCRIPTS_DIR / "scan_spring.py"), "--codebase-path", str(codebase), "--out", str(out),
                        "--name-dict", str(codebase / "docs" / "term-dictionary.csv")],
                       check=True, capture_output=True, text=True)
        return json.loads(out.read_text(encoding="utf-8"))


def contract(doc: dict) -> dict:
    """What a caller sees, without where it was read from (file names and lines differ between the two languages)."""
    keep = ("nameEn", "nameKo", "dataType", "required", "path", "parentPath", "depth", "note", "maxSize", "enumValues", "defaultValue")
    return {
        "auth": doc.get("auth"),
        "endpoints": [{
            **{k: e.get(k) for k in ("method", "path", "interfaceName", "authRequired", "auth", "authorities", "handlerName",
                                     "requestExample", "responseExample")},
            "requestFields": [{k: f.get(k) for k in keep} for f in e["requestFields"]],
            "responseFields": [{k: f.get(k) for k in keep} for f in e["responseFields"]],
        } for e in doc["endpoints"]],
    }


def _tree(root: Path) -> dict[str, str]:
    return {str(p.relative_to(root)): p.read_text(encoding="utf-8") for p in root.rglob("*") if p.is_file() and p.suffix in (".kt", ".java", ".yml")}


class KotlinParityTest(unittest.TestCase):
    """The getting-started sample rewritten in Kotlin (`fixtures/spring-kotlin`) gives the Java sample's spec."""

    def test_the_kotlin_sample_matches_the_java_sample(self) -> None:
        java, kotlin = scan_dir(FIXTURES / "spring"), scan_dir(FIXTURES / "spring-kotlin")
        self.assertEqual(kotlin["source"]["language"], "kotlin")
        self.assertEqual(contract(kotlin), contract(java))

    def test_kdoc_comments_name_fields_like_javadoc(self) -> None:
        # Without a term dictionary the Korean labels come from the comments in both languages.
        java, kotlin = scan(_tree(FIXTURES / "spring")), scan(_tree(FIXTURES / "spring-kotlin"))
        labels = lambda doc: [(e["path"], f["nameEn"], f["nameKo"]) for e in doc["endpoints"]
                              for side in ("requestFields", "responseFields") for f in e[side]]
        self.assertEqual(labels(kotlin), labels(java))
        self.assertIn(("/api/v1/orders", "fromDate", "조회 시작일"), labels(kotlin))


if __name__ == "__main__":
    unittest.main()
