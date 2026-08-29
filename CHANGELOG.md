# MonoField changelog

MonoField uses semantic versions for source and Desktop releases. Historical
upstream development remains available in Git history; this file records the
independent MonoField product line.

## 0.11.5 — 2026-08-29

- Isolated development-server state by project, module, working directory, and
  exact launch fingerprint so parallel services retain their own status, logs,
  profile, environment, port, and stop lifecycle.
- Made module database selection authoritative and reset persistent write
  permission when a connection identity changes, preventing policy reuse across
  projects or replacement databases.
- Reduced explanation-style interface and screen specification prompts by
  91.9% in the measured fixture while keeping full evidence and artifact context
  for real generation, editing, validation, and export requests.
- Let the selected local CLI become usable as soon as its readiness result
  arrives; on the measured Windows host Codex became ready in 1.7 seconds while
  the remaining adapter scan continued in the background.
- Fixed manual preview edits being replaced by stale content and tightened
  screen-spec image inputs with containment, real-file, format, signature, and
  size checks.
- Added a responsive four-step documents/design walkthrough, finalized the
  development walkthrough, and expanded the downloadable illustrated Korean
  user guide to cover multi-project work, governed data, specifications, usage,
  recovery, and release checks.
- Reworked the README and public website around verifiable workflows, clearer
  local CLI versus BYOK capability boundaries, keyboard-accessible previews,
  and direct download and GitHub Star paths.

## 0.11.4 — 2026-08-28

- Made usage reporting explicit across Codex, Claude, Gemini, Copilot, local
  CLIs, and BYOK providers: the displayed input is the full context reported by
  the selected runtime, not a MonoField-only token surcharge.
- Added multi-project development discovery, per-project run state, broader
  Node/Python/Go/Java run configurations, environment profiles, terminal
  access, branch switching, and clearer side-by-side Git review.
- Improved controlled database development, project-scoped connection policy,
  Windows and UNC path handling, and safe read/write execution guidance.
- Reduced startup work with lazy locale loading, faster local-chat routing,
  slimmer packaged assets, and more resilient runtime executable discovery.
- Added guided first-run tours for development and document/design work,
  expanded downloadable user guides, update notices, and optional GitHub Star
  support prompts while removing the newsletter flow.

## 0.11.3 — 2026-08-26

- Added reviewed GPT-5.6 Sol, Terra, and Luna recommendations without allowing
  an older installed Codex catalog to hide them.
- Kept live CLI discovery authoritative for future, previously unknown models;
  newly discovered entries appear before the reviewed fallback list.
- Added efficient automatic model-catalog refresh at app startup and every six
  hours while the app remains open, plus clearer manual rescan copy.
- Verified current Codex CLI, Claude Code, Gemini CLI, and OpenCode adapters on
  Windows.

## 0.11.2 — 2026-08-25

- Completed the public product boundary: MonoField app name, executable,
  protocol, environment variables, schemas, plugin authoring files, deploy
  examples, website, and release metadata.
- Added the software-development workspace with linked working folders, Git
  changes, project run configurations, browser verification, and controlled
  database context.
- Added document/design workflows for interface specifications, screen
  specifications, slides, prototypes, and reusable workflows.
- Improved Browser review with DOM marks, drawn regions, adjustments, approved
  automation, popup tabs, and combined review requests.
- Added response and conversation usage details, model/runtime measurement
  provenance, and cost reporting when the provider supplies pricing data.
- Improved dark-mode contrast, focus states, Desktop startup, CLI detection
  caching, and prompt/context efficiency.
- Added the MonoField website and Windows Desktop release assets.

## Provenance

MonoField is an independent project derived from the Apache-2.0-licensed Open
Design codebase. See `README.md`, `LICENSE`, and `NOTICE` for attribution and
license details.
