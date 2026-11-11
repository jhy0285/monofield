"""Shapes found when the Spring scanner was run on real public projects (docs/testing/real-projects-2026-11-11.md).

Each case is a gap that a real codebase exposed; the sources keep that project's formatting (google-java-format,
two-space indents, parameters split across lines).
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
BASE = "src/main/java/io/example/api"


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


def routes(doc: dict) -> list[str]:
    return sorted(f"{e['method']} {e['path']}" for e in doc["endpoints"])


ARTICLE_API = """
    package io.example.api;

    import org.springframework.http.ResponseEntity;
    import org.springframework.web.bind.annotation.*;

    @RestController
    @RequestMapping(path = "/articles/{slug}")
    public class ArticleApi {

      @GetMapping
      public ResponseEntity<?> article(
          @PathVariable("slug") String slug, @AuthenticationPrincipal User user) {
        return null;
      }

      @DeleteMapping
      public ResponseEntity deleteArticle(
          @PathVariable("slug") String slug, @AuthenticationPrincipal User user) {
        return null;
      }
    }
"""

TAGS_RESOURCE = """
    package io.example.api;

    @RestController
    @RequestMapping(value = "tags")
    public class TagsResource {
      @GetMapping
      public ResponseEntity getTags() {
        return null;
      }
    }
"""

ADVICE = """
    package io.example.api;

    @RestControllerAdvice
    public class ApiExceptionHandler {
      @GetMapping("/never")
      public String notAnEndpoint() {
        return null;
      }
    }
"""


class RealWorldShapesTest(unittest.TestCase):
    def test_controllers_are_found_by_annotation_whatever_the_file_is_called(self) -> None:
        doc = scan({f"{BASE}/ArticleApi.java": ARTICLE_API, f"{BASE}/TagsResource.java": TAGS_RESOURCE,
                    f"{BASE}/ApiExceptionHandler.java": ADVICE})
        self.assertEqual(routes(doc), ["DELETE /articles/{slug}", "GET /articles/{slug}", "GET /tags"])

    def test_a_class_that_is_not_a_controller_is_not_scanned_even_if_named_like_one(self) -> None:
        doc = scan({f"{BASE}/ArticleApi.java": ARTICLE_API, f"{BASE}/ArticleController.java": """
            package io.example.api;

            public class ArticleController {
              @GetMapping("/not-wired")
              public String helper() {
                return null;
              }
            }
        """})
        self.assertEqual(routes(doc), ["DELETE /articles/{slug}", "GET /articles/{slug}"])

    def test_a_statically_imported_request_method_is_read(self) -> None:
        doc = scan({f"{BASE}/UsersApi.java": """
            package io.example.api;

            import static org.springframework.web.bind.annotation.RequestMethod.GET;
            import static org.springframework.web.bind.annotation.RequestMethod.POST;

            @RestController
            public class UsersApi {
              @RequestMapping(path = "/users", method = POST)
              public ResponseEntity createUser(@Valid @RequestBody RegisterParam registerParam) {
                return null;
              }

              @RequestMapping(path = "/users/search", method = {GET, POST})
              public ResponseEntity search() {
                return null;
              }
            }
        """})
        self.assertEqual(routes(doc), ["GET/POST /users/search", "POST /users"])

    REGISTER = {
        f"{BASE}/UsersApi.java": """
            package io.example.api;

            @RestController
            public class UsersApi {
              @PostMapping("/users")
              public ResponseEntity createUser(@Valid @RequestBody RegisterParam registerParam) {
                return null;
              }
            }
        """,
        "src/main/java/io/example/application/RegisterParam.java": """
            package io.example.application;

            @Getter
            @JsonRootName("user")
            @NoArgsConstructor
            public class RegisterParam {
              @NotBlank(message = "can't be empty")
              @Email(message = "should be an email")
              private String email;

              @NotBlank(message = "can't be empty")
              private String password;
            }
        """,
    }

    def test_a_root_name_wraps_the_request_body_when_the_project_unwraps_root_values(self) -> None:
        doc = scan({**self.REGISTER, "src/main/resources/application.properties":
                    "spring.jackson.deserialization.UNWRAP_ROOT_VALUE=true\n"})
        fields = {f["path"]: f["required"] for f in doc["endpoints"][0]["requestFields"]}
        self.assertEqual(fields, {"user": "Y", "user.email": "Y", "user.password": "Y"})

    def test_yaml_configuration_counts_too_and_without_it_the_body_is_not_wrapped(self) -> None:
        doc = scan({**self.REGISTER, "src/main/resources/application.yml":
                    "spring:\n  jackson:\n    deserialization:\n      unwrap-root-value: true\n"})
        self.assertEqual([f["path"] for f in doc["endpoints"][0]["requestFields"]], ["user", "user.email", "user.password"])
        plain = scan(self.REGISTER)
        self.assertEqual([f["path"] for f in plain["endpoints"][0]["requestFields"]], ["email", "password"])

    RESPONSES = {
        f"{BASE}/UsersApi.java": """
            package io.example.api;

            @RestController
            @AllArgsConstructor
            public class UsersApi {
              private UserQueryService userQueryService;

              @PostMapping("/users/login")
              public ResponseEntity userLogin(@Valid @RequestBody LoginParam loginParam) {
                UserData userData = userQueryService.findById(loginParam.getEmail()).get();
                return ResponseEntity.ok(userResponse(new UserWithToken(userData, "token")));
              }

              private Map<String, Object> userResponse(UserWithToken userWithToken) {
                return new HashMap<String, Object>() {
                  {
                    put("user", userWithToken);
                  }
                };
              }
            }
        """,
        f"{BASE}/CommentsApi.java": """
            package io.example.api;

            @RestController
            @RequestMapping(path = "/articles/{slug}/comments")
            @AllArgsConstructor
            public class CommentsApi {
              private CommentQueryService commentQueryService;
              private TagsQueryService tagsQueryService;

              @GetMapping
              public ResponseEntity getComments(
                  @PathVariable("slug") String slug, @AuthenticationPrincipal User user) {
                List<CommentData> comments = commentQueryService.findByArticleId(slug, user);
                return ResponseEntity.ok(
                    new HashMap<String, Object>() {
                      {
                        put("comments", comments);
                        put("total", tagsQueryService.count());
                      }
                    });
              }

              @GetMapping(path = "/first")
              public ResponseEntity first(@PathVariable("slug") String slug) {
                return commentQueryService.findFirst(slug).map(this::commentResponse).orElseThrow();
              }

              private ResponseEntity<Map<String, Object>> commentResponse(CommentData commentData) {
                return ResponseEntity.ok(
                    new HashMap<String, Object>() {
                      {
                        put("comment", commentData);
                      }
                    });
              }
            }
        """,
        f"{BASE}/TagsApi.java": """
            package io.example.api;

            @RestController
            @RequestMapping(path = "tags")
            @AllArgsConstructor
            public class TagsApi {
              private TagsQueryService tagsQueryService;

              @GetMapping
              public ResponseEntity getTags() {
                return ResponseEntity.ok(tagsQueryService.page());
              }
            }
        """,
        "src/main/java/io/example/application/UserWithToken.java": """
            package io.example.application;

            @Getter
            public class UserWithToken {
              private String email;
              private String username;
              private String token;
            }
        """,
        "src/main/java/io/example/application/CommentData.java": """
            package io.example.application;

            @Data
            public class CommentData {
              private String id;
              private String body;
              @JsonProperty("author")
              private ProfileData profileData;
            }
        """,
        "src/main/java/io/example/application/ProfileData.java": """
            package io.example.application;

            @Data
            public class ProfileData {
              private String username;
              private boolean following;
            }
        """,
        "src/main/java/io/example/application/TagPage.java": """
            package io.example.application;

            @Getter
            public class TagPage {
              @JsonProperty("tags")
              private List<String> names;
              @JsonProperty("tagsCount")
              private int count;
            }
        """,
        "src/main/java/io/example/application/CommentQueryService.java": """
            package io.example.application;

            @Service
            public class CommentQueryService {
              public List<CommentData> findByArticleId(String id, User user) {
                return null;
              }

              public Optional<CommentData> findFirst(String slug) {
                return null;
              }
            }
        """,
        "src/main/java/io/example/application/TagsQueryService.java": """
            package io.example.application;

            @Service
            public class TagsQueryService {
              public TagPage page() {
                return null;
              }

              public int count() {
                return 0;
              }
            }
        """,
    }

    def test_response_maps_built_in_helpers_inline_or_by_method_reference_are_read(self) -> None:
        doc = scan(self.RESPONSES)
        response = {f"{e['method']} {e['path']}": [f["path"] for f in e["responseFields"]] for e in doc["endpoints"]}
        self.assertEqual(response["POST /users/login"], ["user", "user.email", "user.username", "user.token"])
        self.assertEqual(response["GET /articles/{slug}/comments"],
                         ["comments", "comments.id", "comments.body", "comments.author", "comments.author.username",
                          "comments.author.following", "total"])
        self.assertEqual(response["GET /articles/{slug}/comments/first"],
                         ["comment", "comment.id", "comment.body", "comment.author", "comment.author.username",
                          "comment.author.following"])
        # a service result passed straight to ok() is expanded like a declared return type
        self.assertEqual(response["GET /tags"], ["tags", "tagsCount"])

    def test_a_dto_field_typed_as_another_dto_is_listed_once(self) -> None:
        # Found when the Kotlin reader reused the Map-key expansion: a returned DTO's own DTO field was expanded twice.
        doc = scan({**self.RESPONSES, f"{BASE}/CommentsApi.java": """
            package io.example.api;

            @RestController
            public class CommentsApi {
              @GetMapping("/comments/{id}")
              public CommentData one(@PathVariable("id") String id) {
                return null;
              }
            }
        """})
        paths = [f["path"] for f in doc["endpoints"][0]["responseFields"]] if doc["endpoints"][0]["path"] == "/comments/{id}" else \
            [f["path"] for e in doc["endpoints"] if e["path"] == "/comments/{id}" for f in e["responseFields"]]
        self.assertEqual(paths, ["id", "body", "author", "author.username", "author.following"])

    def test_a_request_class_declared_in_the_controller_file_is_read_on_its_own(self) -> None:
        doc = scan({f"{BASE}/UsersApi.java": """
            package io.example.api;

            @RestController
            @AllArgsConstructor
            public class UsersApi {
              private UserRepository userRepository;
              private String defaultImage;

              @PostMapping("/users/login")
              public ResponseEntity userLogin(@Valid @RequestBody LoginParam loginParam) {
                return null;
              }
            }

            @Getter
            @JsonRootName("user")
            @NoArgsConstructor
            class LoginParam {
              @NotBlank(message = "can't be empty")
              @Email(message = "should be an email")
              private String email;

              @NotBlank(message = "can't be empty")
              private String password;
            }
        """, "src/main/resources/application.properties": "spring.jackson.deserialization.UNWRAP_ROOT_VALUE=true\n"})
        self.assertEqual([f["path"] for f in doc["endpoints"][0]["requestFields"]], ["user", "user.email", "user.password"])


if __name__ == "__main__":
    unittest.main()
