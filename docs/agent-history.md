# Agent history

A running handoff record so any AI agent (Claude Code, Codex, or another) can
pick the repository up where the last one stopped. It complements, and never
replaces, `AGENTS.md`: that file holds the rules, this file holds what happened
and what is still open.

## How to use this file

1. Read root `AGENTS.md`, then this file, before starting work.
2. Start from **Current state** and **Open items**; read the newest **Log**
   entries for context. Do not redo work an entry already records as done.
3. Before you finish any task, update this file in the **same commit** as the
   work (see "Update protocol"). A task that ends without this update is not
   finished.

## Update protocol

Do this at the end of every task that changes the repository, and also after an
investigation whose findings the next agent would otherwise have to rediscover.

1. Add one entry at the **top** of the Log, using the template below.
2. Refresh **Current state** so it describes the branch as it is now.
3. Update **Open items**: remove what you finished, add what you found but did
   not do, and keep each item self-contained (what, where, why it matters).
4. Keep it short. An entry is about 5–15 lines; link to code, tests, ADRs, and
   docs instead of copying them. When the Log grows past roughly 300 lines,
   condense the oldest entries into one line each.

Rules for the content:

- Record only what you verified. State the exact commands you ran and whether
  they passed. Mark anything you did not run as not run. Never write that
  something works without a result behind it.
- Compare failures against a baseline (the same test on the base commit) before
  calling them pre-existing or new, and say which you did.
- Use repository-relative paths. No secrets, tokens, credentials, personal data,
  machine-specific absolute paths, or concrete daemon data directory examples
  (see "Daemon data directory contract" in `AGENTS.md`).
- Do not put your own commit hash in the entry you are committing; name the
  commit by its subject, or add the hash in a later entry.
- On a merge conflict in this file, keep both sides' entries, newest first.
- Do not put module details here that belong in a layer's `AGENTS.md`.

Entry template:

```markdown
### YYYY-MM-DD — <short title> (`<branch>`)

- **Request:** what the user asked for.
- **Changed:** behavior and files, at the level a reviewer needs.
- **Why:** root cause or motivation.
- **Verified:** commands and results; baseline comparison where relevant.
- **Not done:** deliberate omissions and why.
- **Next agent:** gotchas, order of operations, anything easy to get wrong.
```

## Current state

As of 2026-10-30.

- Product: MonoField, a local Windows workbench that takes Codex or Claude Code
  CLI work to Korean SI deliverables (interface-spec XLSX, screen-spec PPTX,
  reviewed spec diffs). It is an independent fork of the Apache-2.0 Open Design
  project; see `docs/adr/0002-upstream-maintenance.md` (status: Proposed, only
  phase A done).
- Version: `0.11.7-preview.4` (root `package.json`), prepared on 2026-10-30 for the execution
  permissions release; `0.11.7-preview.3` is the previous published preview. Workspace packages are
  still named `@open-design/*`; env vars still use the `OD_*` prefix.
- Shape: pnpm monorepo. `apps/daemon` (Express + SQLite, `monofield` CLI) and
  `apps/web` (Next.js 16) hold most of the code (roughly 320k and 410k lines of
  TypeScript). Largest files: `apps/web/src/components/FileViewer.tsx`,
  `apps/daemon/src/server.ts`, `apps/daemon/src/cli.ts`,
  `apps/web/src/components/ProjectView.tsx`, `SettingsDialog.tsx` (each 8k–11k
  lines).
- Working branch for agent sessions: `ccr-8432aecf-n9xdfd`. No pull request has
  been opened from it.
- Local verification status (run on 2026-10-28 at the head of the branch):
  `pnpm guard`, `pnpm typecheck` and `pnpm i18n:check` pass. Unit suites pass in
  full: `@open-design/web` 402 files / 3891 tests (13 skipped),
  `@open-design/daemon` 459 files / 5530 tests, `@open-design/components`
  2 files / 18 tests. The whole Playwright suite (`e2e/ui`, 367 tests) and the
  Vitest e2e suites (`e2e/specs`, `e2e/tests`, 37 files) were run once on
  2026-10-28; 90 Playwright tests failed, every one of them also fails on the
  commit before this series except for 23 AMR tests that were not run there (see
  Known baseline failures). No regression was found. On 2026-10-29 `pnpm guard`
  and `pnpm typecheck` passed again, and all 64 of those non-AMR failures were fixed
  file by file (see the newest Log entries), and the AMR tests were settled: the two AMR UI files that
  cover reachable surfaces pass with the `amrEnabled` worker option, and the AMR specs that
  could not pass were removed at the user's request (see the newest Log entry).
- Marketing site (`apps/monofield-site`, buildless static site for monofield.vercel.app):
  the hero redesigned on 2026-10-30 is finished on this branch. Traces show no Layout and no
  Paint during its loop and nothing of it running once it is scrolled away, and it was viewed
  from 1440 px to 390 px in both languages and with reduced motion (see the two newest Log
  entries). It is not live: the site deploys from `main`, and this branch is not merged.
- Layout: regions can be resized or folded in the development workspace (tools
  panel height, Design Files preview width, AI input) and the classic chat
  panel width; see the newest Log entry and `Splitter` in
  `packages/components/src/splitter.tsx`.
- Execution permissions (2026-10-30): one global level, `read-only` / `default` / `full`,
  stored as `executionPermissionLevel` in app config and served by
  `GET/PUT /api/execution-permissions` (`packages/contracts/src/api/execution-permissions.ts`).
  It sets the Codex sandbox and the Claude Code permission mode for runs that start after a
  change, and on Windows `full` makes MonoField Desktop restart with administrator rights (UAC
  at every launch). Surfaces: Settings → Execution permissions, a red "Full access" pill beside
  the settings cog, and `monofield permissions [show|set <level>] [--json]`. `default` keeps the
  shipped behavior. The Windows elevation path has unit tests only; it was not run on Windows.

### Environment notes

Observed in a Linux cloud sandbox on 2026-10-27; they may not match your
machine. Check before relying on them.

- The repo needs Node `~24`. The sandbox shipped Node 22, so Node 24 was
  obtained from the `node@24` npm package and put first on `PATH`.
- Dependencies were installed with `pnpm install --frozen-lockfile
  --ignore-scripts`, then `node ./scripts/postinstall.mjs` to build the
  workspace packages (the skipped install scripts include that step). Native
  modules then had to be prepared by hand:
  - `better-sqlite3`: run `prebuild-install` inside the package directory.
  - `node-pty`: no Linux prebuild is shipped; `node-gyp rebuild` in its package
    directory worked (make, g++, and python3 were present). Without it, any UI
    test that opens the terminal fails (for example `e2e/ui/development-focus.test.ts`).
- Playwright: `e2e` pins `@playwright/test` 1.60.0, which expects a different
  Chromium build than the sandbox preinstalled. The workaround was a throwaway
  Playwright config kept outside the repo that imports `e2e/playwright.config.ts`,
  overrides `testDir`, and sets `launchOptions.executablePath`. Do not commit
  such a config.
- `pnpm install` changes the file mode of `apps/daemon/bin/monofield.mjs` to
  executable. Do not commit that mode change.
- Start a local stack with `pnpm tools-dev start web --daemon-port <port>
  --web-port <port> --namespace <name>` and stop it with `pnpm tools-dev stop
  --namespace <name>`. Never stop it with `pkill -f tools-dev`; the pattern
  matches the shell running the command.
- First `next dev` compile of the project page takes about 45 seconds.
- The sandbox runs as root and exports `ANTHROPIC_BASE_URL`, `HTTPS_PROXY` and
  `no_proxy`. Specs that assumed none of those (daemon `connection-test`) now
  clear or override them; one `xai` token spec that needs a mode-000 file to be
  unreadable is skipped as root. A spec that fails only here is probably a new
  one that forgot to isolate the environment.
- A full `e2e/ui` run keeps about 390 MB of scratch per failed worker under
  `.tmp/e2e/`, and Playwright starts a new worker after every failure, so a run
  with many failures fills the disk (it reached 25 GB). Delete `.tmp/e2e/playwright-*`
  folders that nothing has touched for a while, from a loop if the run is long.
- A failing `e2e/ui` test waits for the whole test timeout; the default used here
  (`OD_PLAYWRIGHT_TIMEOUT=400000`) is 6.7 minutes, which made one pass take hours.
  A timeout of 100000 was enough for every test that can pass. The list reporter
  prints failure details only when the run ends, so a run that is stopped early
  loses them; use `--reporter=list,json` and let it finish.
- Two Playwright runs at once (two processes with one worker each, or one with
  two workers) worked on 4 cores, but heavy load made two tests fail that pass
  alone (`app-restoration` line 73, `settings-hover-contrast` line 150), and two
  `e2e/tests/dialog` specs failed with a missing-selector error until run alone.
  Re-run a failure by itself before calling it a regression.
- The Vitest e2e specs that call `chromium.launch()` (`tests/dialog/*`) need the
  Playwright browser build their version expects. With a mismatch, point
  `PLAYWRIGHT_BROWSERS_PATH` at a scratch folder holding a
  `chromium_headless_shell-<build>/chrome-headless-shell-linux64/chrome-headless-shell`
  link to the installed Chromium; nothing outside the scratch folder changes.
- The AMR e2e specs need `OD_ENABLE_AMR=1` (daemon) and
  `NEXT_PUBLIC_OD_ENABLE_AMR=1` (web); AMR is off otherwise. Even with both set,
  four `e2e/tests/amr` specs fail with "Desktop credential vault authorization is
  unavailable" because they save AMR credentials through `/api/app-config` and the
  vault exists only while MonoField Desktop runs.
- Stopping a background script with `pkill -f <name>` kills the shell that
  contains `<name>` in its own command line. Find the PID with `ps -eo pid,args`
  and a bracketed pattern such as `grep "[e]2e-cleaner"`.
- Running a daemon spec against an older commit needs the daemon's own
  `node_modules`; a git worktree of the older commit with `apps/daemon/node_modules`
  symlinked to the main checkout's worked for the baseline comparison.

- Playwright workers now warm the web server before the first test
  (`e2e/lib/playwright/suite.ts`, `warmUpWeb`); a cold `next dev` compile of the
  entry page takes 30 to 45 seconds and used to fail the first test of every worker.
  A killed Playwright run leaves its daemon and web sidecars running with parent 1;
  find them by `--od-stamp-namespace=playwright-...` and stop them by PID, or the
  next run competes with them for CPU.
- A `test.describe.configure({ mode: 'serial' })` file skips every test after the
  first failure, so its failure count understates the damage; run a suspect test by
  its line number to see it.
- A full disk makes Chromium crash ("Page crashed") and fails whatever runs next.
  `.tmp/e2e/playwright-*` held 27 GB again; delete those folders between runs.
- A spec whose config omits `privacyDecisionAt` gets the first-run privacy notice
  over the bottom right of the window, which can cover buttons it needs. The other
  specs set `privacyDecisionAt: 1`.
- A spec that saves a BYOK API key needs a stand-in for the Desktop credential
  vault: the web app PUTs the key to `/api/byok/credentials` first, and without the
  vault that call fails and the whole settings save is skipped (nothing reaches local
  storage). `routeByokVault` in `e2e/ui/settings-api-protocol.test.ts` is one;
  afterwards local storage holds `STORED_BYOK_API_KEY`, not the key.
- Mocks that flip state "on the nth request" (for example the connector status in
  `settings-memory-routines`) break when the UI reads that endpoint more or less
  often. Flip them on a test-controlled flag instead.

### Known baseline failures

`@open-design/desktop` unit suite in this sandbox (2026-10-30): 8 files fail on the base commit and
after the execution-permissions change alike, 7 because the Electron binary is not installed
("Electron failed to install correctly") and `development-process-broker` (4 tests).

Web unit and daemon unit suites: none. On 2026-10-27, on the commit before this
series (the merge of pull request 11), the web suite had 95 failing tests and the
daemon suite 90 (23 files); all were investigated and resolved (see the Log). The
daemon failure set was compared test by test against that commit before it was
changed, and the two sets were identical.

`e2e/ui`: 90 of 367 tests failed on 2026-10-28 when run alone, 26 AMR tests and 64
others. For the 64 others, each one was also run on the commit before this series,
under the same conditions, and failed there too, so none came from this series. For
the AMR tests, three were run on that commit and fail there; the other 23 were not,
but the baseline had `ENABLE_AMR_RUNTIME = false` fixed in the renderer, so the AMR
screens they drive could not appear. They need the two AMR flags (see Environment
notes), which the harness does not set.

On 2026-10-29, all 64 were fixed and each file re-run alone:
`settings-memory-routines` (16 of 16 pass), `project-management-flows` (37 of 37),
`visual-entry` (11 of 11), `settings-api-protocol` (12 of 12),
`design-systems-manager` (3 of 3), `settings-design-systems` (3 of 3),
`critique-theater` (4 pass, 3 are `test.fixme`), `settings-media-providers` (3 of 3),
`document-review` (2 of 2), `chat-todo-autoscroll` (2 of 2), `change-plan`,
`app-restoration` (Browser Inspiration, see below), `chat-design-system-switch`,
`composer-toolbar-alignment`, `app` (the one failing test), `real-daemon-run` (13 of
13 pass in one run), `critical-smoke`, `app-manual-edit` and
`new-project-ds-picker-clipping`. Causes were spec drift (the
Memory page moved its add and import flows into a modal; the navigation rail,
settings menu and hand-off controls changed; onboarding opens on the local coding
agent and the plugin gallery moved from Home to the Library view; saved BYOK keys go
to the credential vault instead of local storage; "Design systems" is "Document
Styles" in Settings and "Design Jury" is "HTML Design Review (Experimental)" in
English; Brand & styles became a list with a detail panel; a first-run privacy notice
covers the bottom right of the window unless the config sets `privacyDecisionAt`;
the question form is in the Questions tab and Continue sends it, after which the chat
banner is a finished, disabled marker; the composer's document style pill is the shared
`project-ds-picker-*`;
the document dependency panel (and the change plan inside it) is collapsed until
its summary is opened; the to-do card is inline in the chat log, not pinned above
the composer; media provider keys are kept out of browser storage),
a hydration race in the shared
`ensureRailOpen` helper, and cold `next dev` compiles; two were product bugs (the
design system dropdown clipped inside the New Project panel, and the "Memory created"
confirmation vanished with the modal), and four were reload bugs and a prompt-matching
bug in the run and delivery path (see the newest Log entries). None of the 64 is known
to fail now. The AMR failures counted on 2026-10-28 are gone too: `amr-login-pill` and
`amr-logout-requires-relogin` pass with the `amrEnabled` worker option, and
`amr-onboarding`, `amr-run-failure-recovery` and `e2e/tests/amr` were removed on
2026-10-29. Caution: `real-daemon-run` runs in `serial`
mode, so a failure there hid the five tests after it, which were never run before
2026-10-29 (one of them failed for the reload bug above and one for the plugin prompt).

`e2e/specs` and `e2e/tests`: 10 of 207 tests failed on the first run. One was
stale (`specs/namespace`, fixed); two (`tests/dialog/*`) pass alone once the
browser build is matched; three AMR specs (`relogin-required`) pass with the AMR
flags set; four AMR specs need the Desktop credential vault and cannot pass
without it. These were not run on the commit before this series; the code they
exercise is unchanged by it.

## Open items

Newest first within each group. Remove an item when it is done.

Execution permissions (see the newest Log entry):

- Run the Windows elevation path on a real packaged Windows build: choosing Full access →
  UAC "Yes" → the old window quits and the elevated copy starts (after-quit handshake in
  `apps/desktop/src/main/elevation.ts`); UAC "No" keeps the normal-rights window and
  Settings says so; a launch with `full` saved relaunches elevated; going back to `default`
  drops the rights after the app is reopened. Check that Explorer drag-and-drop is refused
  while elevated (UIPI) and that the file picker still works. None of this was run.
- Files the elevated app or its agents create may be owned by the Administrators group;
  whether that trips Git's `safe.directory` check in a later normal-rights run was not
  checked.
- The level covers Codex and Claude Code only. Other adapters (Gemini, OpenCode and so on)
  keep their own flags, and Codex image generation (`apps/daemon/src/media/index.ts`) still
  uses workspace-write unless `OD_CODEX_SANDBOX` is set; the Settings footnote says so.

End-to-end tests:

- Run `e2e/ui` as a whole once on a quiet machine (one worker, `OD_PLAYWRIGHT_TIMEOUT=100000`,
  `.tmp/e2e/playwright-*` cleaned between batches) to confirm the non-AMR failures are gone
  together; each file was run alone, and the run and delivery changes of 2026-10-29 were
  re-checked only on `app`, `app-restoration`, `chat-*`, `document-review` and
  `real-daemon-run` (see the newest Log entry).
- The AMR product surfaces (sign-in, model polling, the AMR agent, the cloud landing in
  `EntryShell.tsx`, which nothing can reach) still ship behind `OD_ENABLE_AMR` /
  `NEXT_PUBLIC_OD_ENABLE_AMR`. Removing them is ADR 0002 work; when it happens, remove
  `amr-login-pill`, `amr-logout-requires-relogin`, the `amrEnabled` worker option in
  `e2e/lib/playwright/suite.ts` and `e2e/lib/amr.ts` with them.

Marketing site (`apps/monofield-site`, see the newest Log entry):

- Decide whether the scene should loop forever. It is finite on purpose: the change cycle
  runs 3.6 times (about 34 s) and ends on the finished picture, as the app Home hero does.
- The intro (first ~5 s) still costs 229 UpdateLayoutTree, 29 Layout and 367 Paint per 5 s,
  once: the `rise-in` blur (`filter`) and the 12 spec `cell-in` animations run on the main
  thread, plus the two "M" stroke draws and the header colour transition. Dropping the blur
  from `rise-in` is the cheapest cut if the intro has to be lighter. Left as is.
- Over the dark hero the header's inline mark shows only its white "M"; the `#090909` tile is
  nearly invisible there (it shows on the light header and in the footer). Left as is.
- At 520 px and below the spec hides column A (ID), so its letter row starts at B.
- The 403 "rate limit exceeded" console error in Playwright runs is most likely `script.js`'s
  request to `api.github.com/repos/jhy0285/monofield/releases/latest`, rate-limited as seen from
  the sandbox; the page keeps its static links when it fails. The request URL was not confirmed.
- The structured data still lists `monofield-development.png` as the screenshot and the file
  is unchanged; keep it in `apps/monofield-site/` or update the JSON-LD and `tests/seo.test.ts`.

Layout and UI:

- The AI input under the workspace in the development layout can be folded but
  not resized; the tools panel, the Design Files preview and the classic chat
  panel can. Other regions (the left navigation rail, the file viewer's side
  panels) were not reviewed for resizing.
- In `next dev` the Next.js overlay button sits in the bottom-right corner and
  covers whatever is there. It does not exist in a production build.
- Previewing an HTML file in Design Files logged "Failed to read the
  'localStorage' property ... sandboxed" page errors from the sandboxed preview
  iframe in a Playwright run. Not investigated and not compared with the base
  commit.

Multi-project workspaces:

- `listFiles` in `apps/daemon/src/projects.ts` has no cap on the number of files,
  so opening a folder with about 54,000 files still returns a ~13 MB listing
  (the second listing request was removed; see the Log). Consider a cap or a
  scoped listing.
- A workspace root with no project marker (no `.git`, `package.json`, `pom.xml`,
  and so on) is not in the module list returned by
  `GET /api/projects/:id/development/configs`, so the module selector cannot
  select the root itself. This was left as is on purpose; whether terminal and
  Git need the root is not checked.

Repository direction (`docs/adr/0002-upstream-maintenance.md`, status Proposed):

- Phases B and D are done only in their reversible form: community adapters are
  marked and the Settings sections are ordered (media providers, connectors,
  design systems, Critique Theater and Pets sit under a "More" divider), but
  nothing is hidden. The AMR surfaces were already off by default behind
  `OD_ENABLE_AMR` (daemon) and `NEXT_PUBLIC_OD_ENABLE_AMR` (renderer, new
  `apps/web/src/runtime/amr-flag.ts`). Hiding media providers and connectors
  unless enabled is not done.
- Phase C (move media templates, most design systems and design-only skills into
  an optional bundle) is not started.
- Phase E (rename `@open-design/*` packages and the remaining `od` naming) is not
  started. It changes the lockfile, so it needs the Nix pnpm deps hash refresh
  described in `AGENTS.md`.
- The Langfuse bridge (`apps/daemon/src/langfuse-bridge.ts`, about 1,100 lines),
  PostHog config and AMR analytics mirroring still build their payloads but send
  nothing by design. Deleting them would be a cleanup under the ADR; their specs
  now assert only that nothing is sent.

Code health:

- Split `apps/daemon/src/server.ts`, `apps/daemon/src/cli.ts`, and the large web
  components listed above. Do it as mechanical moves in their own PRs, not mixed
  with behavior changes. Not started: a split mixed into this series would have
  made its fixes impossible to review.
- `e2e/ui/app-restoration.test.ts` has `runPythonSourcePreviewFlow`, which
  nothing calls and which still reads the removed `.code-viewer` element.
- 19 occurrences of "an MonoField" remain in the content under `plugins/` and
  `design-systems/`; whether editing those files affects any integrity check was
  not looked at.
- Some agent-guide text gives a concrete daemon data directory example, which the
  "Daemon data directory contract" in `AGENTS.md` forbids. Noticed, not fixed.
- Database access supports PostgreSQL only; Oracle and Tibero need the broker
  work described in `docs/adr/0003-oracle-tibero-metadata-access.md` (phase 1
  only is implemented). It cannot be verified without those databases.

## Log

### 2026-10-30 — Settings → Execution permissions, one Codex-style level (`ccr-8432aecf-n9xdfd`)

- **Request:** a "실행 권한" Settings section covering the Codex sandbox, the Claude permission mode
  and running as administrator, with UI and CLI in the same change, DTOs in contracts and all 19
  locales; after review the user asked for a single Codex-like setting for MonoField, Codex and
  Claude together, a polished UI, tests, a merge to `main` and an app release.
- **Changed:** contracts `api/execution-permissions.ts` (levels, `resolveExecutionPermissions`,
  `executionPermissionsNeedRestart`) and `AppConfigPrefs.executionPermissionLevel`; daemon
  app-config validation, `execution-permissions.ts`, `routes/execution-permissions.ts`,
  `RuntimeContext.executionPermissionLevel` passed from `server.ts`; `codex.ts` maps
  read-only/default/full to `--sandbox read-only` / workspace-write + network /
  danger-full-access (resume: `sandbox_mode="read-only"` / unchanged /
  `--dangerously-bypass-approvals-and-sandbox`; no `--add-dir` in read-only), and
  `OD_CODEX_SANDBOX=danger-full-access` still widens every level; `claude.ts` passes `plan` for
  read-only, `bypassPermissions` otherwise; CLI `monofield permissions` in
  `services/permissions-cli.ts`. `packages/platform`: `isWindowsProcessElevated` (integrity label
  from `whoami /groups`) and `launchWindowsElevated` (`Start-Process -Verb RunAs`, declined →
  `declined`). Desktop `elevation.ts`: packaged Windows only, relaunch with the launcher after-quit
  args, startup relaunch when the daemon reports `startElevated`, IPC `od:elevation:relaunch`,
  host bridge `elevation.relaunchAsAdministrator`. Web: `ExecutionPermissionsSection` (three
  radio cards, status panel, confirm dialog portaled to `<body>`, Escape closes only the
  confirm), `ExecutionPermissionBadge` beside the settings cog, `providers/execution-permissions.ts`,
  `Icon` `shield`, 42 `executionPermissions.*` keys in 19 locales. Tests in each package and
  `e2e/ui/settings-execution-permissions.test.ts`.
- **Why:** MonoField hard-coded workspace-write for Codex and bypassPermissions for Claude; widening
  needed an environment variable and narrowing was impossible.
- **Verified:** Node 24.22.2, pnpm 10.33.2. `pnpm guard` 67 pass; `pnpm typecheck` exit 0;
  `pnpm i18n:check` pass. `pnpm --filter` tests: contracts 263 pass; platform 69 pass (1 skipped);
  components 18 pass; daemon 5545 pass, 1 fail (`run-failure-telemetry-smoke` 20 s timeout under
  load, passes alone, 2/2); web 3927 pass, 1 fail (`SettingsDialog.execution` found two
  `/Claude Code/` buttons because the new nav hint named the agents; hint reworded, the file and
  the new specs then pass 136/136); monofield-site 8 pass; desktop 4 failed / 191 passed in 8
  files, the same 8 files and 4 tests that fail on the base commit (Electron binary missing in
  this sandbox, development-process-broker), compared in a worktree of the base commit.
  `e2e/ui/settings-execution-permissions.test.ts` 2 pass. Live check against `tools-dev` (namespace
  `perm-ui`): API read/write/400, CLI output, and screenshots in Korean and English at 1280 and
  820 px (cards stack by container width), the confirm dialog, the header pill; Windows-only
  states were viewed with a routed Windows-shaped API answer.
- **Not done:** the Windows UAC/relaunch path on Windows (not run, see Open items); dark theme
  was not viewed.
- **Next agent:** `od:elevation:relaunch` must stay outside the slice between the `od:update:install`
  and `od:update:quit` handlers (`tests/main/updater-host-boundary.test.ts`). A nested `Dialog` inside
  Settings needs a portal; without it the backdrop covers only the section.

### 2026-10-30 — monofield.vercel.app hero: measured, two paint/restyle sources fixed, viewed (`ccr-8432aecf-n9xdfd`)

- **Request:** finish the hero handed off below: 5 s trace, the unviewed layouts, then site test, typecheck and guard.
- **Measured before:** 5 s traces (`Tracing.start`, `devtools.timeline`, counts on `CrRendererMain`, 1440x900, page
  served by `python3 -m http.server`). Change loop: UpdateLayoutTree 298, Layout 0, Paint 416; reduced motion 0/0/0;
  scrolled past the hero 300/0/416 with no hero animation running. Mapping `Paint` events' `args.data.nodeId` with
  `DOM.describeNode` split them between `button.intro-play` and the document layer it sits in (209 each): the
  button's `ring` animated `box-shadow` forever, on screen or not. The hero itself painted nothing in the loop.
  The per-frame restyle was `.sheet-sync`, which ran two opacity animations, so neither went to the compositor
  (`compositeFailed` 64 in the trace's `Animation` events).
- **Changed (`apps/monofield-site/styles.css`):** the ring is a disc (`.intro-play::before`) that scales and fades; the
  one-off fade-in moved to the badge slot `.sheet-status`; hero captions flow as text (`text-wrap: balance`,
  `word-break: keep-all`), because at 390 px a wrapped caption left its dot alone at the left edge and Korean broke
  inside a word ("인터페 / 이스").
- **Verified after:** loop 27/0/0 (12 ms of style per 5 s); 390x844 with the stacked scene in view 33/0/0; scrolled
  past 27/0/0 with no hero animation running; after the loop 26/1/2; no compositor failure in the loop window. Screenshots
  at 1440 (11 s and 36 s), 1000, 800, 768, 700, 640, 560 and 390 px, EN and KO: no horizontal overflow; `.hero-shot`
  shows at every width; reduced motion at 390 and 1440 px is the finished picture with 0 running animations; the KO→EN
  click swaps copy, alt and labels, and a reload keeps `monofield-language`; header mark and footer brand (`/mark.svg`)
  render. `pnpm --filter monofield-site test` 8 pass, `pnpm --filter monofield-site typecheck` exit 0, `pnpm guard`
  67 pass (Node 24.22.2, pnpm 10.33.2).
- **Not done:** the live site (not run; it deploys from `main`); the intro's one-off cost and the other open items below.
- **Next agent:** judge from natural playback or reduced motion. Calling `finish()` on every animation blanked the spec's
  ID column in screenshots, a `fullPage` capture taken during `scroll-behavior: smooth` drew the fixed header mid-page,
  and an element screenshot of `.engine` dropped the caption's second line; none of these happen on the real page.

### 2026-10-30 — monofield.vercel.app hero: code → MonoField → spec scene (`ccr-8432aecf-n9xdfd`)

- **Request:** add motion graphics to the vercel.app site, then: do not keep the old site hero's
  form, redesign it as you see fit (clean, classy). The user then asked to stop here and leave
  the rest to another agent, so this entry is a handoff of **unfinished** work.
- **Changed (`apps/monofield-site/`):**
  - `index.html`: the hero's contour SVG, floating file chips, tilted screenshot, scan line and
    border beam are gone. New background (`.hero-dots`, `.hero-sweep`, `.hero-glow`) and a new
    figure `.engine`: a code pane (an `OrderController.java` with `@RestController` endpoints),
    a MonoField "M" core between two wires, and an interface-spec spreadsheet pane
    (`interface-spec.xlsx`, rows `IF-001..003`). All of it is `aria-hidden` with a caption that
    says it is an illustration; bilingual labels use the existing `data-ko`/`data-en` swap.
    The real app capture moved into `figure.hero-shot` below the scene and is now `loading="lazy"`
    (it is no longer the LCP image). The header brand uses an inline SVG mark whose "M" stroke
    draws in (`.brand-mark-stroke`); the footer still uses `/mark.svg`.
  - `styles.css`: the hero section is rewritten. Resting styles are the finished picture (the
    two new code lines typed, the `IF-003 DELETE` row added), so reduced motion and no-animation
    visitors see a complete, static scene (`@media (prefers-reduced-motion: reduce)` sets
    `animation: none` on the hero background and scene). Timeline: intro once (code lines in,
    scan, packet through the core, first rows written, ~4.4 s), then a change cycle of 8 s,
    3.6 iterations, from 5.6 s: two lines typed (a `.cover` stepped with `steps()`), a packet
    carries the change through the core, the spec gains its row with a "+1 row" diff mark, then
    it winds back; it ends mid-hold on the finished picture. Everything animates `transform` /
    `opacity` (one short stroke draw for the "M"); no `var()` inside transform keyframes. Under
    800 px the scene stacks vertically with the wires running downward. The status-dot pulse ring
    is now an `::after` fading and scaling (it used to animate `box-shadow`).
  - `motion.js`: the contour drawing, chip fly-out and tilt code are removed. What remains: the
    header on-dark toggle, a pointer glow that moves with `translate`, an IntersectionObserver
    that sets `.is-offscreen` on the hero (CSS pauses all animation) and one that sets
    `.engine.is-live` when 35 % of the scene is visible (until then the scene is held on its first
    frame, so a visitor who scrolls to it sees it start from the beginning), and the unchanged
    reveal/video code. `.hero-shot` was added to the reveal targets.
- **Verified:** `pnpm --filter monofield-site test` (8 pass), `pnpm --filter monofield-site
  typecheck`, `pnpm guard`: all pass. Playwright screenshots at 1440x900 (EN and KO, frames from
  0.7 s to 10.2 s), 1366x700 with the scene scrolled in late (it did not start until visible),
  1000 px, 700 px stacked (KO), 390 px, and 1440 px with reduced motion; no page errors.
- **Not done:** a performance trace of the new hero (**not run**); a visual check of the lower real
  screenshot (`.hero-shot`); a second look at 390 px / reduced motion at 390 px after the last
  CSS edits; the commit does not touch the sections below the hero.
- **Next agent:** serve the folder with a static server (`python3 -m http.server` in
  `apps/monofield-site`) and look with Playwright. Language is stored in `localStorage` key
  `monofield-language`. The SEO test requires exactly one `<h1>`, `/motion.js` loaded with
  `defer`, no inline script, a `prefers-reduced-motion` block in `styles.css` and
  `motion.js`; keep the hero copy and `data-ko`/`data-en` pairs. Timing constants in the scene are
  mirrored between the CSS custom properties and the keyframe percentages (8000 ms cycle): if you
  change the cycle length, recompute the percentages. Do not reintroduce inline scripts (CSP is
  `script-src 'self'`).

### 2026-10-30 — Home hero motion: measured and made cheap (`ccr-8432aecf-n9xdfd`)

- **Request:** is the Home hero motion fine for performance?
- **Measured:** 5 s Chromium traces of the idle Home screen on a local stack (renderer main
  thread). Before: style recalculation 60.8 ms vs 10.8 ms with the hero motion off, paint
  56.5 ms / 314 paints vs 28.1 ms / 147, main-thread tasks 446 ms vs 331 ms, and it never
  stopped. The step highlight animated `color`, `background-color` and `border-color` (repaint
  every frame), and the pulse's `transform` keyframes used `var(--link)`.
- **Changed (`HeroBrand.module.css`, `HeroBrand.tsx`):** the lit state is two pseudo-element
  layers that only fade (`::before` pill, `::after` strong copy of the label from `data-label`);
  the pulse keyframes use fixed distances (a `pulse-travel-short` variant at 560 px and below);
  the ambient loops are finite: the pipeline plays 4 cycles (24 s, `--hero-loops`) and the field
  sweep 3 passes (27 s), then the hero rests.
- **Verified:** after: paints 143 vs 147 with the motion off, style 23.5 ms vs 8.2 ms, main-thread
  tasks equal within run-to-run noise; with the finite animations finished, the only running
  animation on Home is the composer caret, as with the motion off. Inactive entry views are
  `hidden` (display: none), so the hero does not animate behind another destination. Frames of
  the lit step in light, dark and at 390 px look as before. `tsc` clean; hero unit specs (73)
  pass.
- **Next agent:** keep hero loops on `opacity`/`transform` with literal values; measure with a
  trace (`Tracing.start` with `devtools.timeline`) before adding another loop.

### 2026-10-30 — Home hero brand: motion graphic (`ccr-8432aecf-n9xdfd`)

- **Request:** make the branding screen look better, using motion graphics.
- **Changed:** the Home hero's brand block (mark, name, headline, "code / interface spec /
  screen spec", trust line) is now `components/home-hero/HeroBrand.tsx` with
  `HeroBrand.module.css`, replacing the `.home-hero__brand|title|subtitle|trust` rules in
  `styles/home/home-hero.css` and `styles/entrance.css`. Motion, all CSS: the mark's "M" is
  drawn as an SVG stroke with a glint across the tile, two rings leave the mark once, the name
  types in letter by letter, the headline words rise out of a blur one after another, and the
  subtitle is drawn as a pipeline whose three steps light up in turn while a dot travels the
  dashed link between them (6 s loop). A dot grid behind the block is lit by a slow band of
  light. Hover on the mark tilts it and replays the glint.
- **Design rules kept:** the product ease; every animation settles on the element's own static
  style (`backwards` fill), so the page is finished when animations are off; `prefers-reduced-
  motion` turns all of it off; light and dark follow the theme tokens; the headline and
  subtitle are exposed to assistive technology as plain text (`VisuallyHidden`), the animated
  copies are `aria-hidden`.
- **Locale handling:** the pipeline steps come from splitting the existing
  `homeHero.subtitlePrefix` on `/` (all 19 locales use it); right-to-left text (Arabic,
  Persian) stays in one box and the brand name stays left to right, because separate word boxes
  scramble mixed runs ("من Codex وClaude Code"); words stay inline boxes offset with `top`, so
  line breaks match plain text; a link and the step it leads to wrap together on a narrow
  screen. No i18n keys were added.
- **Verified:** looked at frames in light and dark at 1280 px, Korean, Arabic and Persian, 390 px,
  and with reduced motion, on a local stack. `tests/components/home-hero/HeroBrand.test.tsx`
  (10 specs) and the 32 `HomeHero`/`home-hero`/`styles`/`EntryView` unit files (146 tests) pass;
  `tsc` in `apps/web` is clean. `e2e/ui` `visual-entry`, `critical-smoke` and
  `entry-chrome-flows` pass (49 of 49 in one batch run, except one `entry-chrome-flows` test
  that timed out on a card overlapping a button and did not reproduce in 3 reruns, or when the
  whole file ran (35 of 35)).
- **Not done:** no e2e spec asserts the new hero DOM (only the unit spec); the looping
  animations are not checked by a visual baseline (`captureVisual` turns animations off);
  `apps/web/public/app-icon.svg` is unchanged, the hero mark inlines its path.
- **Next agent:** keep the hero strings and the `/` separators in step; a locale whose subtitle
  has no `/` shows one lit step and no links.

### 2026-10-29 — Remove the AMR specs that cannot pass (`ccr-8432aecf-n9xdfd`)

- **Request:** the user chose to remove the AMR tests (the recommendation in the previous
  entry).
- **Changed:** deleted `e2e/ui/amr-onboarding.test.ts` (23 tests, the unreachable cloud
  landing), `e2e/ui/amr-run-failure-recovery.test.ts` (8, the Desktop credential vault) and
  `e2e/tests/amr/` (5 files: 4 vault-bound, and `relogin-required`, which only passes with the
  AMR flags that the Vitest harness does not set), plus the orphaned `e2e/lib/vitest/amr.ts`
  and the two unused helpers `seedVelaLoginConfig` / `clearVelaLoginConfig` in
  `e2e/lib/amr.ts`. Removed the two files from `e2e/lib/playwright/suites.ts` (UI P0 groups and
  coverage list), from `test:ui:critical` in `e2e/package.json`, and `amr-onboarding` from the
  `playwright_critical` group `a` file list in `.github/workflows/ci.yml`. Kept
  `amr-login-pill` and `amr-logout-requires-relogin`: they pass and cover AMR code that still
  ships behind the flag. Product code is unchanged.
- **Verified:** `pnpm guard` (it checks the UI P0 suite topology against the coverage list)
  passes; `tsc -p tsconfig.json --noEmit` in `e2e` is clean.
- **Not done:** the AMR product surfaces themselves (Open items).
- **Next agent:** `docs/testing/launch-review-e2e-regressions.zh-CN.md` still names
  `amr-onboarding.test.ts`; it is a dated review record and was left as written.

### 2026-10-29 — Turn the AMR runtime on for the AMR UI specs (`ccr-8432aecf-n9xdfd`)

- **Request:** continue; the open item was what to do with the 26 AMR `e2e/ui` tests.
- **Changed:** `e2e/lib/playwright/suite.ts` has a worker option `amrEnabled` (default false)
  that starts the worker's stack with `OD_ENABLE_AMR=1` and `NEXT_PUBLIC_OD_ENABLE_AMR=1`; the
  four `ui/amr-*.test.ts` files set `test.use({ amrEnabled: true })` and use the MonoField
  strings ("Sign in to MonoField", "MonoField AMR"). Nothing else in the harness changes, so
  the other specs still run with AMR off.
- **Result:** `amr-login-pill` (1) and `amr-logout-requires-relogin` (1) pass. The other two
  files still fail, for reasons that are product decisions, not drift:
  - `amr-onboarding` (23 tests, all fail): they start from the cloud sign-in landing, which
    MonoField no longer shows. `EntryShell.tsx` initialises `connectExpanded` and `runtime` to
    `'local'`, nothing sets `connectExpanded` back to `null`, and the landing renders only for
    `null`, so it is unreachable even with the AMR flags on. The first test failed at
    `gotoOnboarding` for all of them. `package.json` `test:ui:critical` still lists this file
    with `--grep @critical`.
  - `amr-run-failure-recovery` (8 tests): the first fails in `setupAmrWorkspace`, because
    saving AMR credentials through `PUT /api/app-config` needs the Desktop credential vault,
    which the daemon reaches over the Desktop sidecar IPC and which needs the Desktop auth
    handshake. The same blocks four `e2e/tests/amr` specs. A fix is a stand-in Desktop sidecar
    for the harness, not a daemon backdoor.
- **Verified:** the four files run alone, one worker, with no flags in the shell:
  `amr-login-pill` and `amr-logout-requires-relogin` 2 of 2; `amr-onboarding` fails from the
  first test (12 tried); `amr-run-failure-recovery` fails at the first test. `tsc -p
  tsconfig.json --noEmit` in `e2e` is clean. Not run: the 23 `amr-onboarding` tests beyond the
  first 12. The Vitest e2e suites (`pnpm exec vitest run -c vitest.config.ts tests specs` in
  `e2e`, after all the run and delivery changes of the day): 177 passed, 9 failed, 21
  skipped; the 9 are exactly the known set: the four vault-bound `tests/amr` specs, the three
  `relogin-required` specs (they pass with the AMR flags set, which that command did not
  set), and the two `tests/dialog` specs (they need the Playwright browser build their version
  expects). No new failure.
- **Not done:** the decision below.
- **Next agent:** the user decides between (a) removing `amr-onboarding` and
  `amr-run-failure-recovery` (and the four vault-bound `e2e/tests/amr` specs) together with the
  AMR surfaces under ADR 0002, (b) rewriting the onboarding specs for the local-first Connect
  step and building the Desktop stand-in for the vault ones, or (c) leaving them failing.
  Recommendation: (a) for `amr-onboarding`, because the flow it tests cannot be reached; take
  it out of `test:ui:critical` with it.

### 2026-10-29 — Fix a reload before the run reply: pending delivery capability and the finished-row check (`ccr-8432aecf-n9xdfd`)

- **Request:** continue with the last baseline `e2e/ui` failure, `real-daemon-run` line 219
  ("survives reload before the create response reaches the browser").
- **Changed (product, `ProjectView.tsx`):** (1) The reattach scan now checks the run of
  the latest assistant message when it is `succeeded` with a run id and no produced
  files: if the run requires delivery and has no acknowledgment, it replays and delivers
  (the daemon can finish a row itself while no page is attached, writing the text and
  the status but no file, and the row alone cannot tell). The status it fetches is reused.
  (2) `rememberPendingArtifactDeliveryCapability` / `claimPendingArtifactDeliveryCapability`:
  the delivery capability is also filed under the assistant message when a turn is sent,
  and claimed under the run id when the reply (or, after a reload, the reattach scan)
  names it. Before, a reload before the reply lost the run-keyed capability, and recovery
  failed closed with "The document delivery capability was not available after
  reconnecting".
- **Why:** both gaps meant that a reload in the first moments of a document run, or while
  no page was attached, lost the artifact for good.
- **Verified:** red then green: two new `ProjectView.reattach-restore` tests (the finished
  row, and the claimed capability; the second fails without the claim). `tsc -p tsconfig.json
  --noEmit` in `apps/web` is clean and the nine `tests/components/ProjectView*` files pass
  (170 tests). `e2e/ui/real-daemon-run` 13 of 13 in one run, line 219 included.
  Afterwards: `e2e/ui/app`, `app-restoration`, `chat-design-system-switch`,
  `chat-todo-autoscroll` and `document-review` together, one worker: 59 of 59 pass
  (11 minutes). Root `pnpm guard` and `pnpm typecheck` pass. `pnpm --filter
  @open-design/web test`: 403 of 404 files pass; the one failure was
  `ProductTutorial` (it passes 3 of 3 alone), and the run before that failed
  `BrandsTab.refresh` (also passes alone): both are timing-sensitive under load.
- **Not done:** the daemon unit suite and the Vitest e2e suites after these changes;
  `e2e/ui` as a whole.
- **Next agent:** `ProjectView.tsx` is the place for delivery and reattach rules, and
  `providers/daemon.ts` for the stream; keep the two guards of `isPageHiding` and the
  delivery recovery for active runs (previous entry) in mind before changing either.

### 2026-10-29 — Fix reload during a run, folder-relative delivery names, and the last small specs (`ccr-8432aecf-n9xdfd`)

- **Request:** continue with the remaining baseline `e2e/ui` failures.
- **Changed (product):** (1) `apps/web/src/runtime/page-lifecycle.ts` (`isPageHiding`,
  set on `beforeunload`/`pagehide`, cleared on `pageshow` or after 3 s): when the page is
  being torn down, the stream error that follows is not a failed run, so
  `providers/daemon.ts` (`streamViaDaemon` catch, the disconnect branch) and
  `ProjectView.tsx` (both `onError` handlers and the reattach `.catch`) leave the message
  running and the next load reattaches. Before, a reload mid-run marked the message
  `failed` and the run was never picked up again. (2) `ProjectView.tsx`: a page that
  reattaches to a run that is still going now owns its artifact delivery
  (`interruptedArtifactDeliveryRecovery` is also true for active runs that owe delivery);
  before, the stream reconciled the final status before `onDone` and always found
  delivery unacknowledged, so every such run ended `ARTIFACT_DELIVERY_INCOMPLETE`.
  (3) `ProjectView.tsx`: a file name the request gives relative to a folder it also asks for
  ("produce a folder named generated-plugin with SKILL.md") is satisfied by that file in
  the folder (`deliveryFileMatchesDeclared`, matching at a path-segment boundary). Before,
  every plugin authoring run failed delivery.
- **Changed (specs):** `app` question form flow uses the Questions tab and the answered
  banner; `chat-design-system-switch` uses `project-ds-picker-*` and polls for the PATCH;
  `composer-toolbar-alignment` expects 3 or more controls (the working directory control
  left the row); `real-daemon-run` plugin authoring and `lib/fake-agents.ts` use the
  "Create a MonoField plugin for:" prompt and `monofield.json`.
- **Why:** the three product changes are bugs a reader of the specs would call data loss:
  a reload mid-run lost the artifact. They were found by the `real-daemon-run` slow-reload
  test, then by the plugin authoring test that the serial skip had hidden.
- **Verified:** red then green: `tests/runtime/page-lifecycle.test.ts` (5), the new
  `ProjectView.reattach-restore` test (fails without the change) and the new
  `ProjectView.api-empty-response` test for folder-relative names. `pnpm guard` and
  `pnpm typecheck` pass. `pnpm --filter @open-design/web test`: 403 of 404 files pass; the
  one failure, `BrandsTab.refresh`, passes 3 of 3 alone (a polling timing test under
  load). `e2e/ui`, one worker, each alone: `app` question-form test, `chat-design-system-switch`,
  `composer-toolbar-alignment`, `real-daemon-run` lines 71-189 (7 of 7 in one run) and 240,
  265, 297, 314 (plugin authoring: 2 of 3 runs after the final change; the failing run
  timed out on a menu item reported outside the viewport) and 368. Line 163 failed once in
  a file run and passed in the four later runs that included it. Not run: the daemon unit suite, `e2e/ui` as a whole after
  these changes, the Vitest e2e suites.
- **Not done:** `real-daemon-run` line 219 (see Known baseline failures). A provider-level
  unit test for the `streamViaDaemon` catch guard (the e2e covers it).
- **Next agent:** `isPageHiding` relies on `beforeunload` because the browser cuts
  the fetches before `pagehide`; do not move the guard to `pagehide` only. The cause of
  line 219 is described under Known baseline failures.

### 2026-10-29 — Fix `app-restoration`, `chat-todo-autoscroll`, `settings-media-providers`, `document-review` and `change-plan` specs (`ccr-8432aecf-n9xdfd`)

- **Request:** continue with the remaining baseline `e2e/ui` failures.
- **Changed:** `app-restoration`: the four Browser Inspiration tests are replaced by
  one (see Why). `chat-todo-autoscroll`:
  grows the inline to-do card in the chat log (`growInlineTodo`) and checks the log's
  `scrollHeight` instead of the pinned slot's effect on `clientHeight`.
  `settings-media-providers`: a stateful daemon stand-in (`statefulMediaDaemon`); local
  storage must hold `apiKeyConfigured` and no key, the daemon holds the key, and a
  fresh load shows an empty field with "Saved · ••••-key". `document-review` and
  `change-plan`: open the collapsed "Screen, API and database dependencies" panel
  before using it (and again after the Korean reload in `change-plan`).
- **Why:** Browser Inspiration works only in the desktop app: read-only inspection and
  the `page_info` / `navigate` actions need the Electron webview and an approved
  automation session (`resolveBrowserAccessPolicy` in `apps/web/src/runtime/browser-access.ts`),
  which a plain browser cannot provide, so the new test asserts "Read-only inspection is
  unavailable." and no action list. **The prompt contracts the four old tests checked
  (`@agent-browser`, `Operation: page_info`, `navigate`) now have no automated coverage
  at all**; they need a desktop harness. The rest is spec drift.
- **Verified:** each file run alone, one worker: `app-restoration` Browser Inspiration
  1 of 1 (the other tests of that file were not re-run), `chat-todo-autoscroll` 2 of 2
  (the product keeps a bottom-pinned user pinned as the inline card grows),
  `settings-media-providers` 3 of 3, `document-review` 2 of 2, `change-plan` 1 of 1;
  `tsc -p tsconfig.json --noEmit` in `e2e` clean. Not run: `pnpm guard` and
  `pnpm typecheck` after this change (spec-only edits), the web unit suite.
- **Not done:** the 4 failures in Known baseline failures.
- **Next agent:** `app` fails only `question-form-submit-persistence` (16 of 17 pass
  alone), so triage that test, not the file.

### 2026-10-29 — Fix `design-systems-manager`, `settings-design-systems` and `critique-theater` specs (`ccr-8432aecf-n9xdfd`)

- **Request:** continue with the remaining baseline `e2e/ui` failures.
- **Changed:** `critique-theater`: the live stage is named by
  `critiqueTheater.userFacingName`, now "HTML Design Review (Experimental)" in
  English. `settings-design-systems`: the Settings section and its buttons say
  "Document Styles" / "Add document style" / "View imported document style", and the
  config sets `privacyDecisionAt: 1` so the privacy notice does not cover the Import
  button. `design-systems-manager`: rewritten for Brand & styles as a list
  (`design-system-card-<id>`) with a detail panel (`design-system-detail-<id>`): the
  status toggle, the "More actions" menu for Delete and "Default for new chats", the
  default badge, and the search box (`design-systems-search`). The draft/published
  filter dropdown is gone from the product (its `dsManager.filter*` strings are
  unused), so that test now checks the status dots and the search instead.
- **Why:** spec drift after the redesigns and renames, plus the privacy notice.
- **Verified:** each file run alone, one worker, `OD_PLAYWRIGHT_TIMEOUT=60000`:
  `critique-theater` 4 passed (3 skipped by `test.fixme`), `settings-design-systems`
  3 of 3, `design-systems-manager` 3 of 3; `tsc -p tsconfig.json --noEmit` in `e2e`
  is clean. Not run: `pnpm guard` and `pnpm typecheck` after this change (spec-only
  edits), the web unit suite.
- **Not done:** the 15 remaining failures in Known baseline failures; the unused
  `dsManager.filter*` strings were left in place.
- **Next agent:** the same drift probably explains the rest: check current labels in
  `apps/web/src/i18n/locales/en.ts` and current test ids before suspecting the product.

### 2026-10-29 — Fix `visual-entry` and `settings-api-protocol` specs (`ccr-8432aecf-n9xdfd`)

- **Request:** continue with the remaining baseline `e2e/ui` failures.
- **Changed:** `e2e/ui/visual-entry.test.ts`: the onboarding capture follows the
  local coding agent step (no cloud sign-in), and the plugin gallery tests open the
  Library view first (`openLibrary`), since Home keeps only the recent projects
  strip. `e2e/ui/settings-api-protocol.test.ts`: added `routeByokVault`, a stand-in
  for the Desktop credential vault, used by both open helpers and the autosave
  recovery test; saved config now holds `STORED_BYOK_API_KEY` and the vault holds the
  key; a reopened Settings dialog shows an empty key field; the cache test now
  expects a second model request carrying the stored-key marker.
- **Why:** with no vault, saving a BYOK key failed before local storage was written,
  so every persistence assertion read the old config. Two earlier "passes" in the
  file (clearing the key, model fetch failure) had only passed because nothing was
  saved; with saving working, clearing the key moves the model off the account-only
  one to the first suggested model, so the test now asserts that, not `gpt-4o`.
- **Verified:** each file run alone, one worker, `OD_PLAYWRIGHT_TIMEOUT=60000`:
  `visual-entry` 11 of 11, `settings-api-protocol` 12 of 12. `pnpm guard` and
  `pnpm typecheck` pass after the change. Not run: the web unit suite (no source
  change in this entry).
- **Not done:** the model list cache is keyed by the key, so a reopened dialog (which
  holds the marker) fetches the list again; harmless, not changed. The 24 remaining
  failures.
- **Next agent:** the capture names in `visual-entry` changed
  (`visual-onboarding-connect`, `visual-library-catalog`,
  `visual-library-plugin-filter`); nothing in the repository reads them.

### 2026-10-29 — Fix baseline e2e failures: navigation, Memory, popover clipping (`ccr-8432aecf-n9xdfd`)

- **Request:** keep going on the pre-existing `e2e/ui` failures, one file at a time,
  fixing the spec or the product, whichever is wrong.
- **Changed:** `e2e/lib/playwright/rail.ts` `ensureRailOpen` waits for the shell and
  for the toggle or the open rail before deciding (it raced hydration);
  `e2e/lib/playwright/suite.ts` warms the web server per worker;
  `project-management-flows`, `critical-smoke`, `app-manual-edit` and
  `new-project-ds-picker-clipping` follow the current UI; `settings-memory-routines`
  is rewritten for the Memory page (helpers `openAddMemoryModal`,
  `openImportFromApps`, `openAdvancedMemoryModal`; "Learn from chats" is a hook on the
  "How it works" tab; connector status follows an `githubAuthorized` flag).
  Product fixes: the New Project design system dropdown and brand flyout are portalled
  and placed inside the window (`apps/web/src/utils/popoverPlacement.ts`,
  `NewProjectPanel.tsx`, `styles/workspace/connectors.css`), and the "Memory
  created" confirmation now shows on the Memory page, because it used to render inside
  the Add modal that saving closes (`MemorySection.tsx`).
- **Why:** the 64 non-AMR failures came from spec drift after the UI redesigns, a
  hydration race, cold compiles, and two real bugs above.
- **Verified:** each file run alone with one worker and `OD_PLAYWRIGHT_TIMEOUT=100000`:
  `settings-memory-routines` 16 of 16 pass (two runs; the first had two failures
  from the status-read-count mock, fixed), `project-management-flows` 37 of 37, the
  other three files pass. Web unit: `popoverPlacement` 6 specs; `MemorySection` 28
  specs, and the create test fails without the `MemorySection.tsx` change and passes
  with it. `pnpm guard` and `pnpm typecheck` pass. Not run: `pnpm --filter
  @open-design/web test` in full after the last change (only the `MemorySection` file),
  `e2e/ui` as a whole, and the 38 remaining failures after these fixes.
- **Not done:** the 38 failures in Known baseline failures; the AMR decision.
- **Next agent:** do not run two Playwright runs at once; load alone made tests that
  pass fail. After a killed run, look for orphaned sidecars. `next dev` rewrites
  `apps/web/next-env.d.ts`; restore it with `git checkout` before committing.

### 2026-10-28 — Full e2e regression run (`ccr-8432aecf-n9xdfd`)

- **Request:** run all of e2e and check for regressions.
- **Changed:** one stale spec, `e2e/specs/namespace/main.spec.ts`, which looked for
  `OD_SIDECAR_IPC_PATH` and `OD_DATA_DIR` in `/api/mcp/install-info`; the daemon
  emits the `MONOFIELD_*` names and its code is unchanged since before this
  series. Nothing else was changed; the failures found are recorded, not fixed.
- **Why:** the earlier verification had run only four of the 49 `e2e/ui` files and
  none of `e2e/specs` and `e2e/tests`.
- **Verified:** all 367 Playwright tests got a result (one worker, then two for the
  second half to save time). 92 failed on the first pass; two of them
  (`app-restoration` line 73, `settings-hover-contrast` line 150) pass alone, so
  they failed under load. The other 90 (26 AMR, 64 others) were re-run alone on
  the branch and failed again, and the 64 others were re-run on the commit before
  this series with the same timeout and workers and failed there too: no
  regression. Three of the 26 AMR tests were also run there and fail. The Vitest
  e2e suites: 10 of 207 tests failed; after the namespace fix and the follow-ups in
  Known baseline failures, the remaining failures are the four vault-bound AMR
  specs.
- **Not done:** the 23 other AMR tests and the Vitest e2e failures were not run on
  the base commit; the causes are the unchanged flag and vault code, not a
  measurement. The 64 persistent failures were not diagnosed.
- **Next agent:** read Environment notes before starting a long e2e run: disk, the
  timeout, and the rule to re-run a failure alone. The base-commit comparison was
  done by checking out that commit in the same working tree (it was clean),
  rebuilding the daemon, running, and checking the branch out again, which also
  needed the daemon rebuilt; `next dev` rewrites `apps/web/next-env.d.ts` during
  a run, so restore it with `git checkout` before committing.

### 2026-10-28 — Resizable regions and a foldable AI input (`ccr-8432aecf-n9xdfd`)

- **Request:** check that the UI looks good, that each region can be stretched or
  shrunk freely, and that it is comfortable to read; fix what is not.
- **Changed:** checked on screen first. The only resize handle was between the
  chat and the workspace, and the development layout has no such split, so with a
  bottom tool open on a 720px window the file list kept about 108px. Added a
  `Splitter` primitive (`packages/components/src/splitter.tsx`: WAI-ARIA
  separator, drag and keyboard, RTL-aware, `onCommit` for persistence) and
  `usePersistentSize` / `useViewportHeight` hooks. Applied it to the tools panel
  height (`workspace/DevelopmentToolsDock.tsx`, sizing rules in
  `developmentDockSize.ts`) and the Design Files list/preview split
  (`DesignFilesPanel.tsx`, `design-files/previewSize.ts`). The compact AI input
  folds into its toolbar (`ChatPane.tsx`), which returns about 170px to the
  editor. Sizes are stored in `localStorage` under `monofield:layout:*` only when
  a person changes them; double click or Enter restores the default. Labels are
  in all 19 locales.
- **Why:** nothing in the development layout could be resized. A second finding:
  `styles/viewer/routines.css` pinned the preview column to 360px with a more
  specific selector than `design-files.css` (which says 380px), so the real
  default was 360px; the rule now follows `--df-preview-width`.
- **Verified:** red then green for `Splitter` (12 specs, including RTL). New unit
  specs for the hook, the sizing rules, the dock and the composer toggle; three
  e2e specs in `e2e/ui/development-multi-project.test.ts` (drag, keyboard,
  reload, double click, fold) pass, and so do the 25 specs of that file,
  `development-focus`, `app-design-files` and `workspace-keyboard-flows`. Driven
  by hand in a browser: default 245px dock, drag to 155px, three ArrowUp to 203px,
  kept after reload, reset by double click; preview 360px to 520px, End leaves the
  list at 280px. `pnpm guard`, `pnpm typecheck`, `pnpm i18n:check` and the web,
  daemon and components suites pass. One existing style contract
  (`tests/styles/design-files-preview-list.test.ts`) had to accept the variable
  form of the column width.
- **Not done:** resizing the AI input itself (it folds, but is not draggable)
  and other regions such as the navigation rail. The "an MonoField" article fix in
  the same series touched 62 places in source and docs.
- **Next agent:** a new resizable region should use `Splitter` plus
  `usePersistentSize`, and keep the default in a pure function with a spec, as the
  two sizing modules do. A grid track that reads a CSS variable must be checked
  against the global stylesheets that also set it.

### 2026-10-28 — Daemon baseline cleanup and two daemon defects (`ccr-8432aecf-n9xdfd`)

- **Request:** continue with everything left, without stopping.
- **Changed:** the daemon suite had 90 failing tests in 23 files. Defects fixed in
  code: `server.ts` injected a one-argument snapshot lookup into the plugin routes
  that call it as `getSnapshot(db, id)`, so `GET /api/applied-plugins/:id`, its
  `/canon` form and both snapshot listings returned 500 on every call
  (`getPolicyAllowedSnapshotForRoutes` adapts it); and `plugins/diff.ts` labeled
  half its fields `od.*` and half `monofield.*`, now all `monofield.*`. The rest
  was test drift, handled in specs only: the MonoField rename (CLI name, env
  names, the default data directory name, repository links), a saved agent now kept by
  `POST /api/runs` instead of scanning for another (`routes/runs.ts` documents
  why), inert telemetry (Langfuse bridge, PostHog config, AMR analytics routes),
  AMR off by default (`vi.hoisted(() => vi.stubEnv('OD_ENABLE_AMR', '1'))`) and the
  Desktop-only credential vault (`tests/helpers/credential-vault.ts`), and ambient
  environment (`ANTHROPIC_BASE_URL`, proxies, running as root).
- **Why:** the failures hid two real regressions in the same list as drift, so a
  new failure could not be told from an old one.
- **Verified:** before changing anything, the 23 files were run on the merge
  commit before the series and the failing tests matched the branch's exactly (180
  lines each). After: the 23 files pass (503 tests, 3 skipped) and the full daemon
  suite passes (459 files / 5530 tests). `plugins-headless-run` was red before the
  snapshot fix, with the response body `SQLite3 can only bind...`, and is green
  after; it also now checks `/canon` and both listings.
- **Not done:** the Langfuse bridge and its context building are still in the
  tree (see Open items); its 19 payload specs were replaced by contract specs
  rather than ported, because the payload cannot be produced any more.
- **Next agent:** `packages/*` and `apps/daemon` specs assume nothing about the
  shell. When a daemon spec fails here but not on a clean machine, suspect the
  environment first (see Environment notes).

### 2026-10-28 — Web and e2e baseline cleanup, quick switcher, translations (`ccr-8432aecf-n9xdfd`)

- **Request:** same continuation; all remaining items.
- **Changed:** the web suite's 95 failing tests and `e2e/ui`'s 9 are resolved.
  Code fixes: concurrent annotations no longer lose a prompt line
  (`ChatComposer.tsx` keeps the staged list in a ref), the verification advice
  textarea uses the focus-ring token (the theme contrast contract requires it),
  and the quick switcher lists a file open in a tab once (`QuickSwitcher.tsx`).
  The renderer reads the AMR switch from `runtime/amr-flag.ts`. ja and zh-CN now
  translate 356 keys each that were English copies. Specs: telemetry-off contracts
  replace upstream event assertions (`tests/analytics*`), rebrand drift updated, the
  onboarding end-to-end spec rewritten around the local CLI agent
  (`App.onboarding-agent-e2e.test.tsx`). e2e: quick switcher counts the always-present
  Docs Files tab, the browser region is "Built-in browser", the artifact-mix spec seeds
  files through the files API because chat artifacts now open only after a verified
  delivery receipt that a mocked `/api/runs` cannot give, and source files open in an
  editable textarea rather than `.code-viewer`.
- **Why:** same as above; the list mixed drift with defects.
- **Verified:** web suite 402 files / 3891 tests at the head of the branch; the
  nine e2e specs pass (re-run after each fix). An earlier full-suite run exited 1
  although every test passed, because an error-tracking spec leaked a jsdom
  uncaught exception; the spec now marks its synthetic event handled.
  `BrandsTab.refresh` failed once in a full run and passes alone; it was not seen
  again.
- **Not done:** the e2e files not named above were not run; `app-restoration`
  has a dead helper (Open items).
- **Next agent:** non-English dictionaries load lazily, so a spec that asserts
  translated text must await it. ja and zh-CN need explicit single-quoted keys
  (the tier-1 parity lock rejects double-quoted copies). The git commit that
  holds the quick switcher change also carries a content-free rename of the
  onboarding spec; the commit that rewrites it says so.

### 2026-10-28 — Multi-project follow-ups: listing, module discovery, picker, adapter marks (`ccr-8432aecf-n9xdfd`)

- **Request:** analyze the multi-project folder problem completely and carry out
  every improvement.
- **Changed:** `useDesignMdState` reads DESIGN.md first and lists the project's
  files only when it exists, which removed the duplicate multi-megabyte
  `GET /api/projects/:id/files` request. `scanDevelopmentProjects`
  (`apps/daemon/src/development-projects.ts`) now offers the modules a project
  declares inside its own repository (Maven/Gradle/workspace manifests under a
  nested Git root). The module selector became `ModulePicker` (count on the
  trigger, filter from eight modules, build-system labels, folder shown for nested
  modules); the active module's folder is marked in the Design Files list.
  ADR 0002 phases B and D in reversible form: `AgentSupportTag` marks every
  adapter except Codex CLI and Claude Code as community, and Settings sections
  are ordered with a "More" divider.
- **Why:** the multi-project screen made the file listing, module list and
  selector scale badly; see the first multi-project entry below for the layout
  defect itself.
- **Verified:** specs were added for the module discovery
  (`apps/daemon/tests/development-projects.test.ts`) and the picker
  (`apps/web/tests/components/workspace/ModulePicker.test.tsx`), and three e2e
  specs in `e2e/ui/development-multi-project.test.ts` cover the original layout
  defect, the picker and the preview; whether each unit spec was seen red first
  was not recorded.
- **Not done:** an uncapped `listFiles`, and the workspace root as a selectable
  module (Open items).
- **Next agent:** `AGENTS.md` now lists 19 locales (it said 18).

### 2026-10-27 — Add the agent history handoff (`ccr-8432aecf-n9xdfd`)

- **Request:** after every task, keep a history file in the repository so any AI
  can continue the work.
- **Changed:** added this file; added the **Agent history handoff** section and
  a Core documentation index line to root `AGENTS.md` (`CLAUDE.md` imports it, so
  Claude Code and Codex both see the rule).
- **Why:** sessions are ephemeral and run on different tools; without a record in
  the repo the next agent re-derives the environment setup and re-finds the same
  open items.
- **Verified:** `pnpm guard` (includes the product-neutrality check over `docs/`
  and `AGENTS.md`). The rule is documentation only; nothing enforces it in CI.
- **Not done:** no CI check or PR-template item that fails when this file is not
  updated. Add one only if the maintainer wants enforcement; it would also bind
  human contributors.
- **Next agent:** the entries below were written in the same session as this
  one, so their "Verified" lines describe that session's runs.

### 2026-10-27 — Keep the file preview in its column in multi-project workspaces (`ccr-8432aecf-n9xdfd`)

- **Request:** opening a folder that holds several projects breaks the screen;
  analyze it and fix it.
- **Changed:** `apps/web/src/components/DesignFilesPanel.tsx` wraps the preview
  thumbnail and details in a scrolling `.df-preview-scroll`;
  `apps/web/src/styles/workspace/design-files.css` clips `.df-preview` and
  scrolls that wrapper. `shouldAutoPreviewDesignArtifacts()` in
  `apps/web/src/components/design-files/designArtifacts.ts` replaces the inline
  `importedFrom === 'folder'` check in `ProjectView.tsx` and turns the auto
  preview off for development workspaces.
- **Why:** two defects combined. The auto preview picked the newest HTML or
  image across all projects (a module the user was not working in), and
  `.df-preview` had `overflow: visible`, so once a bottom tool (changes,
  terminal, logs, impact) opened it was 293 px tall with 397 px of content that
  painted over the tool's header and buttons.
- **Verified:** red then green. `apps/web/tests/components/design-files/designArtifacts.test.ts`
  (3 tests) and `e2e/ui/development-multi-project.test.ts` (2 tests, builds a
  three-module workspace and checks nothing is painted over the tools dock) both
  failed before the change and pass after. Also passing: `pnpm guard`,
  `pnpm typecheck`, 89 web unit tests in the DesignFilesPanel, FileWorkspace, and
  new spec files, `e2e/ui/development-focus.test.ts` (with `node-pty` built),
  and `e2e/ui/visual-workspace.test.ts`. The nine tests listed under "Known
  baseline failures" also fail on the commit before the change.
- **Not done:** the open items under "Multi-project workspaces" (double file
  listing, no file cap, nested-root submodules). The reported symptom could not
  be matched to the user's own screen; the layout break above is what was
  reproduced.
- **Next agent:** reproduce with a folder of three modules, each with its own
  `.git`, a `pom.xml`, and `src/main/webapp/index.html`; import it through
  `POST /api/import/folder`, then `PATCH` the project metadata with
  `workMode: 'development'`. Run the unit spec with
  `pnpm --filter @open-design/web exec vitest run tests/components/design-files/designArtifacts.test.ts`
  and the UI spec from `e2e` with one worker.

### 2026-10-27 — Repository analysis (`ccr-8432aecf-n9xdfd`)

- **Request:** analyze the repository.
- **Changed:** nothing in the repository.
- **Why:** orientation for later work; the findings are summarized under
  "Current state" and "Open items".
- **Verified:** read-only inspection of the code and docs; no commands that
  change state, and no build or test run at that point.
- **Not done:** no refactor of the large files and no ADR 0002 phases beyond A.
- **Next agent:** start from `AGENTS.md`, then `docs/adr/0002-upstream-maintenance.md`
  for direction and `docs/architecture.md` for structure.
