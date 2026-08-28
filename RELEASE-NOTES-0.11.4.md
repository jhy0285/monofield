# MonoField 0.11.4

MonoField 0.11.4 makes development work faster to start, easier to verify, and
clearer to understand—especially when a model reports a large input-token
count.

## Model usage you can read correctly

- Usage details now state that input tokens are the full context reported by
  the selected model provider or CLI. They are not all extra tokens introduced
  by MonoField.
- The explanation applies consistently to Codex, Claude, Gemini, Copilot,
  local CLIs, OpenAI-compatible endpoints, and other BYOK providers.
- The disclosure explains runtime instructions, tools, conversation history,
  project context, cached prefixes, reasoning, totals, and USD only when the
  provider actually reports it.

## Development workspace

- Discover multiple projects from a workspace while keeping run state, Git,
  browser verification, terminal sessions, and database policy scoped to the
  active project.
- Detect and run a wider set of Java, Node, Python, and Go configurations,
  including project profiles and common framework launchers.
- Start and stop projects with visible state, inspect complete launch errors,
  switch Git branches safely, and compare changes in a more resilient split
  view.
- Use controlled database connections with read-only, approval-required, or
  explicitly allowed structured writes.

## Faster, smaller, and easier to learn

- Load uncommon language dictionaries only when selected and keep common
  locales available at first paint.
- Reuse local agent sessions more efficiently and avoid unnecessary runtime
  discovery or prompt context.
- Exclude obsolete startup media and development-only material from Desktop
  packages.
- Follow contextual product tours for software development, documents/design,
  database connections, project runs, Git review, and browser verification.
- Receive release update notices and an optional GitHub Star prompt without a
  newsletter signup flow.

## Downloads

- `MonoField-default-setup.exe` — Windows installer
- `MonoField-default-portable.zip` — portable Windows build
- `SHA256SUMS.txt` — SHA-256 checksums for published assets

The Windows binaries are currently unsigned, so Microsoft Defender SmartScreen
may show an unrecognized-publisher warning.
