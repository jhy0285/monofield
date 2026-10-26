# Spring Security fixture

Synthetic shop API for the static auth analysis in `scan_spring.py`. Its
controllers sit outside `/api/v1/`, so only the security configuration can say
which endpoints need a login:

- `SecurityConfig` — Spring Security 6 lambda DSL with two ordered
  `SecurityFilterChain` beans (a `securityMatcher`-scoped partner chain and
  the API chain), a `String[]` constant, a cross-file constant from
  `SecurityPaths`, `PathRequest.toStaticResources()`, an `HttpMethod`-specific
  rule, a commented-out rule, `web.ignoring()`, and
  `@EnableMethodSecurity(securedEnabled = true)`.
- Controllers use `@PreAuthorize` on the class and on methods, `@Secured`, and
  `@RolesAllowed` (whose JSR-250 family is not enabled).
- `src/test/java/.../TestSecurityConfig` permits everything and must never
  decide production endpoints.

Not copied from any real system.
