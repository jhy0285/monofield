# MonoField 0.11.5

MonoField 0.11.5 focuses on a faster start, safer project boundaries, and a
clear path from request to evidence.

## Development that stays attached to the right project

- Run several modules from one workspace without sharing process state,
  profile arguments, ports, logs, or database policy by accident.
- Switch between modules and return to each module's own running, stopped,
  loading, or failed state.
- Preserve failed-process evidence when a stop cannot be completed, instead of
  reporting a false success.
- Keep Git review, terminal work, browser verification, and governed database
  access scoped to the active project.

## Faster model readiness and smaller explanatory prompts

- The selected local CLI can be used when its own readiness check finishes;
  other adapters continue scanning in the background.
- On the measured Windows host, Codex was ready in 1.7 seconds while the full
  24-adapter scan finished later.
- Interface and screen specification how-to questions use a compact guidance
  profile. The measured prompt fell from 54,050 to 4,373 characters (91.9%)
  without weakening the full context used for actual generation or revision.
- BYOK and OpenAI-compatible endpoints now describe their true boundary:
  conversation and document generation do not automatically inherit Desktop
  filesystem, terminal, browser, or database tools.

## Documents and design

- Manual preview edits persist correctly after save.
- Screen-spec image references must be contained in the project, be regular
  PNG/JPEG/WebP files with matching signatures, and remain within the size
  limit.
- A new responsive four-step documents/design guide joins the development
  walkthrough and can be reopened from the product guide.
- The downloadable Korean guide now includes illustrated multi-project, DB,
  interface-spec, screen-spec, usage, recovery, and final-check workflows.

## Downloads

- `MonoField-default-setup.exe` — Windows installer
- `MonoField-default-portable.zip` — portable Windows build
- `MonoField-default-payload.7z` and `latest.yml` — Desktop updater assets
- `SHA256SUMS.txt` — SHA-256 checksums for every published asset

The current direct-download Windows binaries are unsigned. Microsoft Defender
SmartScreen can therefore show an unrecognized-publisher warning; verify the
download against `SHA256SUMS.txt` from this release.
