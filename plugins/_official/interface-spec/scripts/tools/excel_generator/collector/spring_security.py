"""Static Spring Security evidence for each endpoint's `authRequired`.

Reads the Java security configuration — `SecurityFilterChain` beans and
`WebSecurityConfigurerAdapter.configure(HttpSecurity)` — together with
`web.ignoring()` rules and method-security annotations (`@PreAuthorize`,
`@Secured`, `@RolesAllowed`, `@PermitAll`, `@DenyAll`). Every endpoint gets
one of three statuses and is never judged from the shape of its URL:

- ``required``: a URL rule or an annotation rejects anonymous requests;
- ``public``: `web.ignoring()` or a URL rule lets anonymous requests through
  and no annotation requires authentication;
- ``undecided``: there is no Java security configuration, no rule matches, or
  a matcher/expression cannot be evaluated statically.

Stdlib-only, like every interface-spec scanner. XML security configuration,
servlet filters and HandlerInterceptors are not read.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable

REQUIRED = "required"
PUBLIC = "public"
UNDECIDED = "undecided"
_UNKNOWN = "unknown"  # a rule or annotation whose effect cannot be evaluated statically

STATUS_LABELS = {REQUIRED: "인증 필요", PUBLIC: "인증 불필요", UNDECIDED: "미확정", _UNKNOWN: "해석 불가"}
UNDECIDED_NOTE = "인증 여부 확인 필요"
NO_CONFIG_REASON = "Java 보안 설정(SecurityFilterChain/WebSecurityConfigurerAdapter) 없음"

NON_PRODUCTION_DIRS = {"test", "tests", "build", "target"}

_LOWEST = 2**31 - 1
_HIGHEST = -(2**31)
_ADAPTER_ORDER = 100  # WebSecurityConfigurerAdapter's own @Order

_STRING_RE = re.compile(r'"((?:[^"\\\n]|\\.)*)"')
_IDENT_RE = re.compile(r"[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*")
_TYPE_NAME_RE = re.compile(r"\b(?:class|interface|enum)\s+([A-Za-z_]\w*)")
_CONST_RE = re.compile(
    r"\b(?:static\s+final|final\s+static)\s+String\s*(?:\[\s*\])?\s+([A-Za-z_]\w*)\s*(?:\[\s*\])?\s*="
)
_METHOD_RE = re.compile(
    r"\b([\w.$<>\[\]?]+)\s+([A-Za-z_]\w*)\s*\(([^()]*)\)\s*(?:throws\s+[\w.,\s]+?)?\s*\{"
)
_NOT_TYPES = {"new", "return", "else", "throw", "case"}
_NOT_METHODS = {"if", "for", "while", "switch", "catch", "synchronized", "try"}
_ORDER_RE = re.compile(r"@(?:[\w.]+\.)?Order\s*\(\s*(?:value\s*=\s*)?([^)]*)\)")
_HTTP_METHOD_RE = re.compile(r"\bHttpMethod\.([A-Z]+)\b")
_HTTP_VERBS = {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE"}

# Matcher calls in a filter chain. Plural forms either feed an authorization
# rule (`.requestMatchers(..).permitAll()`) or, with no access method after
# them, the chain scope; singular forms always scope the chain.
_CALL_RE = re.compile(
    r"\.\s*(antMatchers|mvcMatchers|regexMatchers|requestMatchers|anyRequest"
    r"|securityMatchers|securityMatcher|antMatcher|mvcMatcher|regexMatcher|requestMatcher)\s*\("
)
_PLURAL_CALLS = {"antMatchers", "mvcMatchers", "regexMatchers", "requestMatchers", "anyRequest"}
_FOLLOW_RE = re.compile(r"\s*(?:\.\s*servletPath\s*\([^)]*\)\s*)?\.\s*([A-Za-z_]\w*)\s*\(")
_CHANNEL_CALLS = {"requiresSecure", "requiresInsecure", "requires"}
_PUBLIC_ACCESS = {"permitAll", "anonymous"}
_REQUIRED_ACCESS = {
    "authenticated", "fullyAuthenticated", "rememberMe", "denyAll",
    "hasRole", "hasAnyRole", "hasAuthority", "hasAnyAuthority", "hasAllRoles", "hasAllAuthorities",
}
_ACCESS_CALLS = _PUBLIC_ACCESS | _REQUIRED_ACCESS | {"access", "hasIpAddress", "not"}
_SPEL_REQUIRED = {
    "hasRole", "hasAnyRole", "hasAuthority", "hasAnyAuthority", "isAuthenticated",
    "isFullyAuthenticated", "isRememberMe", "denyAll", "authenticated", "fullyAuthenticated",
}

# Default URL patterns behind Spring Boot's request-matcher shortcuts.
_KNOWN_MATCHERS = (
    ("PathRequest.toStaticResources()", ("/css/**", "/js/**", "/images/**", "/webjars/**", "/favicon.*", "/*/icon-*")),
    ("PathRequest.toH2Console()", ("/h2-console/**",)),
    ("EndpointRequest.", ("/actuator/**",)),
)
_MATCHER_FACTORIES = {
    "AntPathRequestMatcher": "ant", "antMatcher": "ant", "MvcRequestMatcher": "ant", "pattern": "ant",
    "matcher": "ant", "RegexRequestMatcher": "regex", "regexMatcher": "regex",
}

_SECURITY_ANNOTATION_RE = re.compile(
    r"@(?:[\w.]+\.)?(PreAuthorize|Secured|RolesAllowed|PermitAll|DenyAll)\b\s*(?:\((.*)\))?", re.S
)
# Each annotation only acts when its method-security family is switched on.
_ANNOTATION_FLAGS = {
    "PreAuthorize": "prePostEnabled", "Secured": "securedEnabled",
    "RolesAllowed": "jsr250Enabled", "PermitAll": "jsr250Enabled", "DenyAll": "jsr250Enabled",
}
_METHOD_SECURITY_RE = re.compile(r"@(?:[\w.]+\.)?(EnableMethodSecurity|EnableGlobalMethodSecurity)\b(?:\s*\(([^)]*)\))?")
_ANONYMOUS_ROLES = {"IS_AUTHENTICATED_ANONYMOUSLY", "ROLE_ANONYMOUS", "ANONYMOUS"}

_PATH_VARIABLE = "\x00"  # stands in for a `{var}` segment of an endpoint path


def production_java_files(root: Path) -> list[Path]:
    """Java sources outside test and build-output directories, in a stable order.

    Shared by the endpoint auth analysis and `detect_spring_auth`, so a
    test-only security configuration never decides how production endpoints
    authenticate.
    """
    return sorted(
        path for path in root.rglob("*.java")
        if not NON_PRODUCTION_DIRS.intersection(path.relative_to(root).parts[:-1])
    )


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""


def _skip_literal(text: str, i: int) -> int:
    """Index just past the string or char literal that starts at `i`."""
    quote = text[i]
    j = i + 1
    while j < len(text):
        if text[j] == "\\":
            j += 2
            continue
        if text[j] in (quote, "\n"):
            return j + 1
        j += 1
    return j


def _blank_comments(text: str) -> str:
    """Replace comments with spaces, keeping newlines so offsets map to the same lines."""
    out = list(text)
    i = 0
    while i < len(text):
        if text[i] in "\"'":
            i = _skip_literal(text, i)
            continue
        if text.startswith("//", i) or text.startswith("/*", i):
            if text[i + 1] == "/":
                end = text.find("\n", i)
                end = len(text) if end == -1 else end
            else:
                end = text.find("*/", i + 2)
                end = len(text) if end == -1 else end + 2
            for k in range(i, end):
                if out[k] != "\n":
                    out[k] = " "
            i = end
            continue
        i += 1
    return "".join(out)


def _close_paren(text: str, open_idx: int) -> int:
    """Index of the bracket closing `text[open_idx]`, or -1 when unbalanced."""
    depth = 0
    i = open_idx
    while i < len(text):
        ch = text[i]
        if ch in "\"'":
            i = _skip_literal(text, i)
            continue
        if ch in "({[":
            depth += 1
        elif ch in ")}]":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def _split_top(text: str, sep: str = ",") -> list[str]:
    """Split on `sep` outside literals and brackets."""
    parts: list[str] = []
    depth = 0
    start = i = 0
    while i < len(text):
        ch = text[i]
        if ch in "\"'":
            i = _skip_literal(text, i)
            continue
        if ch in "({[":
            depth += 1
        elif ch in ")}]":
            depth -= 1
        elif ch == sep and depth == 0:
            parts.append(text[start:i].strip())
            start = i + 1
        i += 1
    parts.append(text[start:].strip())
    return [part for part in parts if part]


def _statement_end(text: str, start: int) -> int:
    depth = 0
    i = start
    while i < len(text):
        ch = text[i]
        if ch in "\"'":
            i = _skip_literal(text, i)
            continue
        if ch in "({[":
            depth += 1
        elif ch in ")}]":
            depth -= 1
        elif ch == ";" and depth <= 0:
            return i
        i += 1
    return len(text)


def _decode(body: str) -> str:
    escapes = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "s": " ", "0": "\0"}

    def replace(match: re.Match[str]) -> str:
        escape = match.group(1)
        if escape.startswith("u"):
            return chr(int(escape[-4:], 16))
        return escapes.get(escape, escape)

    return re.sub(r"\\(u+[0-9a-fA-F]{4}|.)", replace, body)


def _outer_call(expr: str) -> tuple[str, str] | None:
    """(callee name, argument text) of the call an expression ends with."""
    last: tuple[int, int] | None = None
    i = 0
    while i < len(expr):
        ch = expr[i]
        if ch in "\"'":
            i = _skip_literal(expr, i)
            continue
        if ch == "(":
            close = _close_paren(expr, i)
            if close == -1:
                return None
            last = (i, close)
            i = close + 1
            continue
        i += 1
    if not last or last[1] != len(expr) - 1:
        return None
    name = re.search(r"([A-Za-z_]\w*)\s*$", expr[: last[0]])
    return (name.group(1), expr[last[0] + 1 : last[1]]) if name else None


def _line(text: str, pos: int) -> int:
    return text.count("\n", 0, pos) + 1


def _snippet(text: str, limit: int = 160) -> str:
    flat = re.sub(r"\s+\.", ".", re.sub(r"\s+", " ", text)).strip()
    flat = re.sub(r"\(\s+", "(", re.sub(r"\s+\)", ")", flat))
    return flat if len(flat) <= limit else flat[: limit - 1] + "…"


def _annotations_before(text: str, pos: int) -> str:
    return text[max(text.rfind(ch, 0, pos) for ch in ";{}") + 1 : pos]


def _order(annotations: str, default: int) -> int:
    found = _ORDER_RE.search(annotations)
    if not found:
        return default
    parts = re.fullmatch(r"(?:[\w.]+\.)?([A-Z_]+|-?\d+)([+-]\d+)?", re.sub(r"\s+", "", found.group(1)))
    if not parts:
        return default
    named = {"HIGHEST_PRECEDENCE": _HIGHEST, "LOWEST_PRECEDENCE": _LOWEST, "BASIC_AUTH_ORDER": _LOWEST - 5}
    token = parts.group(1)
    base = int(token) if token.lstrip("-").isdigit() else named.get(token)
    return default if base is None else base + int(parts.group(2) or 0)


# --- path matching --------------------------------------------------------


def _with_path_variables(path: str) -> str:
    """Replace each `{var}` (or `{var:regex}`) of an endpoint path with one placeholder."""
    out: list[str] = []
    depth = 0
    for ch in path:
        if ch == "{":
            if depth == 0:
                out.append(_PATH_VARIABLE)
            depth += 1
        elif ch == "}" and depth:
            depth -= 1
        elif depth == 0:
            out.append(ch)
    return "".join(out)


def _segment_regex(segment: str) -> re.Pattern[str]:
    out: list[str] = []
    i = 0
    while i < len(segment):
        ch = segment[i]
        if ch == "*":
            out.append("[^/]*")
        elif ch == "?":
            out.append("[^/]")
        elif ch == "{":
            close = _close_paren(segment, i)
            out.append("[^/]+")
            i = close if close != -1 else len(segment)
        else:
            out.append(re.escape(ch))
        i += 1
    return re.compile("".join(out))


def _match_segments(pattern: list[str], path: list[str]) -> bool:
    if not pattern:
        return not path
    head = pattern[0]
    if head == "**" or re.fullmatch(r"\{\*\w*\}", head):
        return any(_match_segments(pattern[1:], path[k:]) for k in range(len(path) + 1))
    return bool(path) and bool(_segment_regex(head).fullmatch(path[0])) and _match_segments(pattern[1:], path[1:])


def ant_match(pattern: str, path: str) -> bool:
    """Whether an Ant/PathPattern matcher covers every request of an endpoint path.

    A path variable is matched only by a wildcard segment (`*`, `**`, `{x}`),
    never by a literal: `/orders/public` does not cover `/orders/{orderId}`.
    """
    if pattern in ("/**", "**"):
        return True
    concrete = _with_path_variables(path)
    if pattern.startswith("/") != concrete.startswith("/"):
        return False
    return _match_segments([s for s in pattern.split("/") if s], [s for s in concrete.split("/") if s])


def _regex_match(regex: str, path: str) -> bool | None:
    """Regex matchers can only be decided for a path variable when every sample value agrees."""
    concrete = _with_path_variables(path)
    samples = [concrete.replace(_PATH_VARIABLE, value) for value in ("1", "a")] if _PATH_VARIABLE in concrete else [concrete]
    try:
        hits = {bool(re.fullmatch(regex, sample)) for sample in samples}
    except re.error:
        return None
    return hits.pop() if len(hits) == 1 else None


@dataclass(frozen=True)
class _Pattern:
    kind: str  # "ant", "regex", or "any"
    value: str = ""
    method: str | None = None

    def matches(self, method: str, path: str) -> bool | None:
        if self.method and self.method != method:
            return False
        if self.kind == "any":
            return True
        if self.kind == "regex":
            return _regex_match(self.value, path)
        return ant_match(self.value, path)


def _any_match(patterns: Iterable[_Pattern], method: str, path: str) -> bool | None:
    result: bool | None = False
    for pattern in patterns:
        hit = pattern.matches(method, path)
        if hit:
            return True
        if hit is None:
            result = None
    return result


# --- expressions ----------------------------------------------------------


def _spel_verdict(expression: str) -> str:
    """Whether a SpEL access expression lets anonymous requests through."""
    expr = expression.strip()
    if re.fullmatch(r"(?:permitAll|isAnonymous)(?:\(\s*\))?", expr):
        return PUBLIC
    stripped = re.sub(r"'(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\"", "''", expr)
    if re.search(r"[!#@]", stripped):
        return _UNKNOWN
    words = set(re.findall(r"[A-Za-z_]\w*", stripped)) - {"and", "or", "AND", "OR"}
    return REQUIRED if words and words <= _SPEL_REQUIRED else _UNKNOWN


class _Constants:
    """`static final String` and `String[]` constants, loaded lazily across the project."""

    def __init__(self, files: list[Path]) -> None:
        self._files = files
        self._local: dict[Path, dict[str, str]] | None = None
        self._qualified: dict[str, tuple[str, Path]] = {}
        self._bare: dict[str, list[tuple[str, Path]]] = {}

    def _load(self) -> dict[Path, dict[str, str]]:
        if self._local is None:
            self._local = {}
            for path in self._files:
                raw = _read(path)
                if "static" not in raw or "String" not in raw:
                    continue
                text = _blank_comments(raw)
                owner = _TYPE_NAME_RE.search(text)
                local = self._local.setdefault(path, {})
                for found in _CONST_RE.finditer(text):
                    name = found.group(1)
                    expr = text[found.end() : _statement_end(text, found.end())].strip()
                    local[name] = expr
                    self._bare.setdefault(name, []).append((expr, path))
                    if owner:
                        self._qualified[f"{owner.group(1)}.{name}"] = (expr, path)
        return self._local

    def values(self, expr: str, ctx: Path, depth: int = 0) -> list[str] | None:
        """String values of a literal, array, concatenation or constant; None when unresolvable."""
        local = self._load()
        e = re.sub(r"^(?:value|path)\s*=\s*", "", expr.strip())
        if not e or depth > 8:
            return None
        array = re.fullmatch(r"(?:new\s+String\s*\[\s*\]\s*)?\{(.*)\}", e, re.S) or re.fullmatch(
            r"(?:java\.util\.)?(?:List|Set|Arrays)\.(?:of|asList)\s*\((.*)\)", e, re.S
        )
        if array:
            out: list[str] = []
            for item in _split_top(array.group(1)):
                values = self.values(item, ctx, depth + 1)
                if values is None:
                    return None
                out.extend(values)
            return out
        parts = _split_top(e, "+")
        if len(parts) > 1:
            joined = ""
            for part in parts:
                values = self.values(part, ctx, depth + 1)
                if values is None or len(values) != 1:
                    return None
                joined += values[0]
            return [joined]
        literal = _STRING_RE.fullmatch(e)
        if literal:
            return [_decode(literal.group(1))]
        if not _IDENT_RE.fullmatch(e):
            return None
        names = e.split(".")
        found: tuple[str, Path] | None = None
        if len(names) > 1:
            found = self._qualified.get(".".join(names[-2:]))
        elif names[0] in local.get(ctx, {}):
            found = (local[ctx][names[0]], ctx)
        elif len(self._bare.get(names[0], [])) == 1:  # e.g. a static import
            found = self._bare[names[0]][0]
        return self.values(found[0], found[1], depth + 1) if found else None


# --- model ----------------------------------------------------------------


@dataclass(frozen=True)
class SecurityAnnotation:
    """A method-security annotation on a controller class or handler method."""

    name: str
    args: str
    text: str
    source: Path
    line: int
    symbol: str


def security_annotation(text: str, source: Path, line: int, symbol: str) -> SecurityAnnotation | None:
    found = _SECURITY_ANNOTATION_RE.match(text.strip())
    if not found:
        return None
    return SecurityAnnotation(found.group(1), (found.group(2) or "").strip(), _snippet(text), source, line, symbol)


@dataclass
class AuthDecision:
    status: str  # REQUIRED, PUBLIC, or UNDECIDED
    reason: str = ""  # why an undecided endpoint could not be decided
    evidence: list[dict] = field(default_factory=list)  # interface-spec `evidenceRefs`

    @property
    def auth_required(self) -> bool | None:
        """True/False when decided, None when undecided."""
        return None if self.status == UNDECIDED else self.status == REQUIRED

    @property
    def note(self) -> str:
        return f"{UNDECIDED_NOTE}: {self.reason}" if self.status == UNDECIDED else ""


@dataclass
class _Rule:
    patterns: list[_Pattern] | None  # None: the matcher could not be resolved
    verdict: str
    snippet: str
    source: Path
    line: int
    symbol: str


@dataclass
class _Chain:
    order: int
    seq: int
    symbol: str
    scopes: list[list[_Pattern] | None]  # empty: the chain handles every request
    rules: list[_Rule]

    def covers(self, method: str, path: str) -> bool | None:
        if not self.scopes:
            return True
        hit = _any_match([p for scope in self.scopes if scope for p in scope], method, path)
        if hit is False and any(scope is None for scope in self.scopes):
            return None
        return hit


@dataclass
class _Method:
    name: str
    kind: str  # "chain", "ignoring", or "helper"
    order: int
    body_start: int
    body_end: int


class SpringSecurityModel:
    """Spring Security rules of one codebase, queried per endpoint."""

    def __init__(self, files: list[Path], display: Callable[[Path], str]) -> None:
        self._display = display
        self.constants = _Constants(files)
        self.chains: list[_Chain] = []
        self.ignored: list[_Rule] = []
        self.method_security = {"prePostEnabled": False, "securedEnabled": False, "jsr250Enabled": False}

    @classmethod
    def load(cls, root: Path, display: Callable[[Path], str] | None = None) -> SpringSecurityModel:
        files = production_java_files(root)
        model = cls(files, display or (lambda path: path.relative_to(root).as_posix()))
        for path in files:
            raw = _read(path)
            if "Security" not in raw:
                continue
            text = _blank_comments(raw)
            model._read_method_security(text)
            if "HttpSecurity" in text or "WebSecurity" in text:
                model._read_config(path, text)
        model.chains.sort(key=lambda chain: (chain.order, chain.seq))
        return model

    # loading

    def _read_method_security(self, text: str) -> None:
        for found in _METHOD_SECURITY_RE.finditer(text):
            modern = found.group(1) == "EnableMethodSecurity"
            attrs = found.group(2) or ""
            for flag, modern_default in (("prePostEnabled", True), ("securedEnabled", False), ("jsr250Enabled", False)):
                setting = re.search(rf"\b{flag}\s*=\s*(true|false)\b", attrs)
                enabled = setting.group(1) == "true" if setting else modern and modern_default
                self.method_security[flag] = self.method_security[flag] or enabled

    def _read_config(self, source: Path, text: str) -> None:
        owner = _TYPE_NAME_RE.search(text)
        cls_name = owner.group(1) if owner else source.stem
        class_order = _ADAPTER_ORDER if re.search(r"\bextends\s+WebSecurityConfigurerAdapter\b", text) else _LOWEST
        if owner:
            class_order = _order(_annotations_before(text, owner.start()), class_order)
        methods = list(self._methods(text, class_order))
        for method in methods:
            symbol = f"{cls_name}.{method.name}"
            if method.kind == "chain":
                rules: list[tuple[tuple[int, ...], _Rule]] = []
                scopes: list[list[_Pattern] | None] = []
                self._scan(text, method, methods, source, cls_name, (), {method.name}, rules, scopes)
                rules.sort(key=lambda item: item[0])
                self.chains.append(_Chain(method.order, len(self.chains), symbol,
                                          [scope for scope in scopes if scope != []], [rule for _, rule in rules]))
            elif method.kind == "ignoring":
                self._scan_ignoring(text, method, source, symbol)

    @staticmethod
    def _methods(text: str, class_order: int) -> Iterable[_Method]:
        for found in _METHOD_RE.finditer(text):
            return_type, name, params = found.groups()
            if return_type in _NOT_TYPES or name in _NOT_METHODS:
                continue
            body_start = found.end() - 1
            body_end = _close_paren(text, body_start)
            if body_end == -1:
                continue
            http = re.search(r"(?<!\w)HttpSecurity\b", params)
            if http and ("SecurityFilterChain" in return_type or name == "configure"):
                kind = "chain"
            elif "WebSecurityCustomizer" in return_type or (name == "configure" and re.search(r"(?<!\w)WebSecurity\b", params)):
                kind = "ignoring"
            else:
                kind = "helper"
            order = class_order if name == "configure" else _order(_annotations_before(text, found.start()), _LOWEST)
            yield _Method(name, kind, order, body_start, body_end)

    def _scan(self, text: str, method: _Method, methods: list[_Method], source: Path, cls_name: str,
              key: tuple[int, ...], visited: set[str], rules: list, scopes: list) -> None:
        """Collect a chain's authorization rules and scope matchers, inlining same-file helpers."""
        start, end = method.body_start, method.body_end
        symbol = f"{cls_name}.{method.name}"
        pos = start
        while (found := _CALL_RE.search(text, pos, end)) is not None:
            name = found.group(1)
            open_idx = found.end() - 1
            close = _close_paren(text, open_idx)
            if close == -1 or close >= end:
                break
            args = text[open_idx + 1 : close]
            customizer = "->" in args  # e.g. securityMatchers(m -> m.requestMatchers(..)): scan inside
            kind = "regex" if name.startswith("regex") else "ant"
            follow = _FOLLOW_RE.match(text, close + 1)
            follow_name = follow.group(1) if follow else None
            pos = open_idx + 1 if customizer else close + 1
            if name not in _PLURAL_CALLS:
                receiver = re.search(r"([A-Za-z_]\w*)\s*$", text[start : found.start()])
                if not customizer and args.strip() and not (receiver and receiver.group(1)[0].isupper()):
                    scopes.append(self._matcher_call(args, kind, source, nested_lambdas=True))
                continue
            if follow_name not in _ACCESS_CALLS and (
                customizer or follow_name in _CHANNEL_CALLS or (not args.strip() and name != "anyRequest")
            ):
                continue
            if follow is None or follow_name == "and":
                if name != "anyRequest":
                    scopes.append(self._matcher_call(args, kind, source, nested_lambdas=True))
                continue
            access_open = follow.end() - 1
            access_close = _close_paren(text, access_open)
            if access_close == -1 or access_close >= end:
                break
            patterns = [_Pattern("any")] if name == "anyRequest" else self._matcher_call(args, kind, source, nested_lambdas=False)
            verdict = self._access_verdict(follow_name, text[access_open + 1 : access_close], source)
            snippet = _snippet(text[found.start() + 1 : access_close + 1])
            rules.append((key + (found.start(),), _Rule(patterns, verdict, snippet, source, _line(text, found.start()), symbol)))
            pos = access_close + 1
        for helper in methods:
            if helper.name in visited or start <= helper.body_start < end:
                continue
            reference = re.compile(rf"(?<![\w.$])(?:this\s*\.\s*)?{helper.name}\s*\(|::\s*{helper.name}\b")
            for call in reference.finditer(text, start, end):
                self._scan(text, helper, methods, source, cls_name, key + (call.start(),),
                           visited | {helper.name}, rules, scopes)

    def _scan_ignoring(self, text: str, method: _Method, source: Path, symbol: str) -> None:
        for found in _CALL_RE.finditer(text, method.body_start, method.body_end):
            name = found.group(1)
            if name not in _PLURAL_CALLS:
                continue
            open_idx = found.end() - 1
            close = _close_paren(text, open_idx)
            if close == -1:
                break
            args = text[open_idx + 1 : close]
            if not args.strip() and name != "anyRequest":
                continue
            kind = "regex" if name.startswith("regex") else "ant"
            patterns = [_Pattern("any")] if name == "anyRequest" else self._matcher_call(args, kind, source, nested_lambdas=False)
            snippet = "ignoring()." + _snippet(text[found.start() + 1 : close + 1])
            self.ignored.append(_Rule(patterns, PUBLIC, snippet, source, _line(text, found.start()), symbol))

    def _matcher_call(self, args_text: str, kind: str, source: Path, nested_lambdas: bool) -> list[_Pattern] | None:
        args = _split_top(args_text)
        method = None
        if args:
            verb = re.fullmatch(r"(?:[\w.]+\.)?HttpMethod\.([A-Z]+)", args[0])
            if verb:
                method, args = verb.group(1), args[1:]
                if not args:
                    return [_Pattern("any", method=method)]
        patterns: list[_Pattern] = []
        for arg in args:
            resolved = self._matcher_arg(arg, kind, method, source, nested_lambdas)
            if resolved is None:
                return None
            patterns.extend(resolved)
        return patterns

    def _matcher_arg(self, arg: str, kind: str, method: str | None, source: Path,
                     nested_lambdas: bool) -> list[_Pattern] | None:
        if "->" in arg or "::" in arg:
            # A customizer's inner matchers are scanned on their own; a lambda
            # RequestMatcher in a rule is custom code we cannot evaluate.
            return [] if nested_lambdas else None
        for prefix, known in _KNOWN_MATCHERS:
            if arg.startswith(prefix):
                return [_Pattern("ant", value, method) for value in known]
        values = self.constants.values(arg, source)
        if values is not None:
            return [_Pattern(kind, value, method) for value in values]
        call = _outer_call(arg)
        if call and call[0] in _MATCHER_FACTORIES:
            factory_method, found = method, []
            for inner in _split_top(call[1]):
                verb = _HTTP_METHOD_RE.search(inner)
                if verb:
                    factory_method = verb.group(1)
                    continue
                values = self.constants.values(inner, source)
                if values is None:
                    continue  # e.g. the MvcRequestMatcher's HandlerMappingIntrospector
                if found and len(values) == 1 and values[0].upper() in _HTTP_VERBS:
                    factory_method = values[0].upper()
                else:
                    found.extend(values)
            if found:
                return [_Pattern(_MATCHER_FACTORIES[call[0]], value, factory_method) for value in found]
        if "AnyRequestMatcher" in arg:
            return [_Pattern("any", method=method)]
        return None

    def _access_verdict(self, name: str, args: str, source: Path) -> str:
        if name in _PUBLIC_ACCESS:
            return PUBLIC
        if name in _REQUIRED_ACCESS:
            return REQUIRED
        if name != "access":
            return _UNKNOWN  # hasIpAddress, not(), or an access method we do not know
        values = self.constants.values(args, source)
        if values is None:
            wrapped = _outer_call(args.strip())
            if wrapped and wrapped[0] == "WebExpressionAuthorizationManager":
                values = self.constants.values(wrapped[1], source)
        if values and len(values) == 1:
            return _spel_verdict(values[0])
        if re.match(r"\s*(?:AuthorityAuthorizationManager\.has\w+|AuthenticatedAuthorizationManager\."
                    r"(?:authenticated|fullyAuthenticated|rememberMe))\s*\(", args):
            return REQUIRED
        return _UNKNOWN

    # deciding

    def _evidence(self, source: Path, line: int, symbol: str, verdict: str, snippet: str) -> dict:
        return {"kind": "code", "ref": self._display(source), "line": line, "symbol": symbol,
                "summary": f"{STATUS_LABELS[verdict]}: {snippet}"}

    def _rule_evidence(self, rule: _Rule, verdict: str) -> dict:
        return self._evidence(rule.source, rule.line, rule.symbol, verdict, rule.snippet)

    def _url(self, method: str, path: str) -> AuthDecision:
        for rule in self.ignored:
            hit = None if rule.patterns is None else _any_match(rule.patterns, method, path)
            if hit is False:
                continue
            if hit is None:
                return AuthDecision(UNDECIDED, f"해석할 수 없는 매처 {rule.snippet} ({rule.source.name}:{rule.line})",
                                    [self._rule_evidence(rule, _UNKNOWN)])
            return AuthDecision(PUBLIC, "", [self._rule_evidence(rule, PUBLIC)])
        if not self.chains:
            return AuthDecision(UNDECIDED, NO_CONFIG_REASON)
        for chain in self.chains:
            covered = chain.covers(method, path)
            if covered is False:
                continue
            if covered is None:
                return AuthDecision(UNDECIDED, f"{chain.symbol}의 securityMatcher를 해석할 수 없음")
            for rule in chain.rules:
                hit = None if rule.patterns is None else _any_match(rule.patterns, method, path)
                if hit is False:
                    continue
                where = f"({rule.source.name}:{rule.line})"
                if hit is None:
                    return AuthDecision(UNDECIDED, f"해석할 수 없는 매처 {rule.snippet} {where}",
                                        [self._rule_evidence(rule, _UNKNOWN)])
                if rule.verdict == _UNKNOWN:
                    return AuthDecision(UNDECIDED, f"해석할 수 없는 인가 규칙 {rule.snippet} {where}",
                                        [self._rule_evidence(rule, _UNKNOWN)])
                return AuthDecision(rule.verdict, "", [self._rule_evidence(rule, rule.verdict)])
            return AuthDecision(UNDECIDED, f"{chain.symbol}에 이 경로와 일치하는 인가 규칙 없음")
        return AuthDecision(UNDECIDED, "이 경로를 처리하는 SecurityFilterChain 없음")

    def _annotation(self, annotation: SecurityAnnotation) -> tuple[str, str]:
        flag = _ANNOTATION_FLAGS[annotation.name]
        if not self.method_security[flag]:
            return _UNKNOWN, f"{annotation.text} 사용, 메서드 보안 활성화({flag}) 확인 안 됨"
        if annotation.name == "PermitAll":
            return PUBLIC, ""
        if annotation.name == "DenyAll":
            return REQUIRED, ""
        values = self.constants.values(annotation.args, annotation.source) if annotation.args else None
        if annotation.name == "PreAuthorize":
            verdict = _spel_verdict(values[0]) if values and len(values) == 1 else _UNKNOWN
        elif values:
            verdict = PUBLIC if _ANONYMOUS_ROLES.intersection(values) else REQUIRED
        else:
            verdict = _UNKNOWN
        return verdict, f"해석할 수 없는 메서드 보안 {annotation.text}" if verdict == _UNKNOWN else ""

    def _annotations(self, on_method: list[SecurityAnnotation],
                     on_class: list[SecurityAnnotation]) -> AuthDecision | None:
        # Within one family a method annotation replaces the class one; the
        # families (pre/post, @Secured, JSR-250) are enforced independently.
        effective: list[SecurityAnnotation] = []
        for flag in dict.fromkeys(_ANNOTATION_FLAGS.values()):
            family = [a for a in on_method if _ANNOTATION_FLAGS[a.name] == flag]
            effective += family or [a for a in on_class if _ANNOTATION_FLAGS[a.name] == flag]
        judged = [(annotation, *self._annotation(annotation)) for annotation in effective]
        for verdict in (REQUIRED, _UNKNOWN, PUBLIC):
            chosen = [(annotation, reason) for annotation, found, reason in judged if found == verdict]
            if chosen:
                evidence = [self._evidence(a.source, a.line, a.symbol, verdict, a.text) for a, _ in chosen]
                reason = "; ".join(reason for _, reason in chosen if reason)
                return AuthDecision(UNDECIDED if verdict == _UNKNOWN else verdict, reason, evidence)
        return None

    @staticmethod
    def _combine(url: AuthDecision, annotations: AuthDecision | None) -> AuthDecision:
        """Anonymous access needs both the URL rule and the annotations to allow it."""
        if annotations is None or url.status == REQUIRED:
            return url
        if annotations.status == REQUIRED:
            return AuthDecision(REQUIRED, "", (url.evidence if url.status == PUBLIC else []) + annotations.evidence)
        evidence = url.evidence + annotations.evidence
        if url.status == PUBLIC and annotations.status == PUBLIC:
            return AuthDecision(PUBLIC, "", evidence)
        return AuthDecision(UNDECIDED, "; ".join(r for r in (url.reason, annotations.reason) if r), evidence)

    def decide(self, http_method: str, path: str, method_annotations: Iterable[SecurityAnnotation] = (),
               class_annotations: Iterable[SecurityAnnotation] = ()) -> AuthDecision:
        """Decide an endpoint; `http_method` may list several methods (e.g. "GET/POST")."""
        annotations = self._annotations(list(method_annotations), list(class_annotations))
        methods = [m for m in re.split(r"[/,|\s]+", http_method.upper()) if m] or [http_method.upper()]
        per_method = [(method, self._combine(self._url(method, path), annotations)) for method in methods]
        evidence: list[dict] = []
        for _, decision in per_method:
            evidence += [ref for ref in decision.evidence if ref not in evidence]
        statuses = {decision.status for _, decision in per_method}
        if len(statuses) == 1:
            reasons = dict.fromkeys(decision.reason for _, decision in per_method if decision.reason)
            return AuthDecision(statuses.pop(), "; ".join(reasons), evidence)
        detail = ", ".join(f"{method} {STATUS_LABELS[decision.status]}" for method, decision in per_method)
        return AuthDecision(UNDECIDED, f"HTTP 메서드별 판정이 다름({detail})", evidence)
