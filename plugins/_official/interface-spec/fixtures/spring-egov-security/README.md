# eGovFrame-style security overlay

Files here are added on top of `../spring-egov/` to give the eGovFrame-style
board module a Spring Security configuration in the
`WebSecurityConfigurerAdapter` style (Spring Security 5 non-lambda DSL):

- `web.ignoring()` for static resources;
- the list and detail `.do` screens are open (`permitAll()`);
- every other `.do` URL needs `ROLE_USER` through `/**/*.do`.

The scanner tests copy `spring-egov/` and this overlay into one temporary
project, so the board module itself is not duplicated. Not copied from any
real system.
