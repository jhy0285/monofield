# MonoField 0.11.6

This release closes the failure mode where a document run could spend time
repeating a blocked Windows command, describe a finished result, and still
leave no project file behind.

## What changed

- **Reliable document delivery** — document/design creation is complete only
  after MonoField observes a saved-file receipt or a file changed during the
  same turn. Prose-only and partial artifact responses no longer look complete.
- **Windows sandbox recovery** — Codex logon error `1385` fails fast instead of
  retrying. Document creation receives one bounded host-owned delivery fallback;
  development projects keep the secured filesystem execution path.
- **Grounded market documents** — current prices, schedules, forecasts, and
  buy/sell opinions require successful source evidence from the same run. Facts
  and scenarios are kept distinct and unsupported values cannot be published as
  verified.
- **Clearer token accounting** — full input, new input, reused cache, output,
  reasoning, and total usage use consistent semantics across supported CLI
  runtimes. A large cache figure is explicitly described as cumulative reuse,
  not one giant prompt or a MonoField surcharge.
- **Updates that reach the user** — every Desktop screen can show a new-release
  notice once per version. When enabled, Windows notifications work in the
  background; download, release notes, and GitHub Star actions are available in
  the same prompt.
- **Browser automation without manual setup** — approved in-app Browser actions
  now receive the packaged MonoField CLI and Node runtime paths inside Codex's
  tool shell on Windows. Users only approve the tab; no
  `MONOFIELD_NODE_BIN` environment variable needs to be configured by hand.
- **Classic Spring projects** — in addition to Spring Boot, MonoField now finds
  active Maven Tomcat, Jetty, and Cargo plugins and Gradle
  Gretty/Tomcat/Jetty configurations. Plain Servlet/WAR projects remain visible
  with honest external-container guidance instead of a non-working Run action.
- **Guides stay in context** — closing a feature guide opened from Settings now
  closes only the guide, including with Escape, and leaves the selected
  Settings page open.

## Installation

- [Windows installer](https://github.com/jhy0285/monofield/releases/download/v0.11.6/MonoField-default-setup.exe)
- [Portable package](https://github.com/jhy0285/monofield/releases/download/v0.11.6/MonoField-default-portable.zip)
- [Checksums and all assets](https://github.com/jhy0285/monofield/releases/tag/v0.11.6)

Direct-download builds are currently unsigned. Windows may show an
unrecognized-publisher warning; compare the file against `SHA256SUMS.txt` before
running it.
