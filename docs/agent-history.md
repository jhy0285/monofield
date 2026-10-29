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

As of 2026-10-29.

- Product: MonoField, a local Windows workbench that takes Codex or Claude Code
  CLI work to Korean SI deliverables (interface-spec XLSX, screen-spec PPTX,
  reviewed spec diffs). It is an independent fork of the Apache-2.0 Open Design
  project; see `docs/adr/0002-upstream-maintenance.md` (status: Proposed, only
  phase A done).
- Version: `0.11.7-preview.3` (root `package.json`). Workspace packages are
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
  and `pnpm typecheck` passed again, and 49 of those 64 non-AMR failures were
  fixed file by file (see the three newest Log entries), leaving 15 non-AMR and 26
  AMR.
- Layout: regions can be resized or folded in the development workspace (tools
  panel height, Design Files preview width, AI input) and the classic chat
  panel width; see the newest Log entry and `Splitter` in
  `packages/components/src/splitter.tsx`.

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

On 2026-10-29, 49 of the 64 were fixed and each file re-run alone:
`settings-memory-routines` (16 of 16 pass), `project-management-flows` (37 of 37),
`visual-entry` (11 of 11), `settings-api-protocol` (12 of 12),
`design-systems-manager` (3 of 3), `settings-design-systems` (3 of 3),
`critique-theater` (4 pass, 3 are `test.fixme`), `critical-smoke`,
`app-manual-edit` and `new-project-ds-picker-clipping`. Causes were spec drift (the
Memory page moved its add and import flows into a modal; the navigation rail,
settings menu and hand-off controls changed; onboarding opens on the local coding
agent and the plugin gallery moved from Home to the Library view; saved BYOK keys go
to the credential vault instead of local storage; "Design systems" is "Document
Styles" in Settings and "Design Jury" is "HTML Design Review (Experimental)" in
English; Brand & styles became a list with a detail panel; a first-run privacy notice
covers the bottom right of the window unless the config sets `privacyDecisionAt`),
a hydration race in the shared
`ensureRailOpen` helper, and cold `next dev` compiles; two were product bugs (the
design system dropdown clipped inside the New Project panel, and the "Memory created"
confirmation vanished with the modal). Still failing, as of the last run that
included them (a partial re-run of this list under load, so each needs its own
re-run before being believed), 15 non-AMR tests:

- `app-restoration` 4 (Browser Inspiration actions), `settings-media-providers` 2,
  `document-review` 2, `chat-todo-autoscroll` 2 (no pinned to-do), and one each in
  `app`, `change-plan`, `chat-design-system-switch`, `composer-toolbar-alignment` and
  `real-daemon-run`.
- Not investigated one by one. Several look like the same drift as the specs
  fixed; that is a guess, not a finding.

`e2e/specs` and `e2e/tests`: 10 of 207 tests failed on the first run. One was
stale (`specs/namespace`, fixed); two (`tests/dialog/*`) pass alone once the
browser build is matched; three AMR specs (`relogin-required`) pass with the AMR
flags set; four AMR specs need the Desktop credential vault and cannot pass
without it. These were not run on the commit before this series; the code they
exercise is unchanged by it.

## Open items

Newest first within each group. Remove an item when it is done.

End-to-end tests:

- Triage the 15 remaining non-AMR `e2e/ui` failures listed under Known baseline
  failures, starting with `app-restoration` (4). Fix
  the spec or the product, whichever is wrong, one file at a time, and re-run each
  file alone on a quiet machine (no second Playwright run).
- Decide what to do with the 26 AMR `e2e/ui` tests and the 4 `e2e/tests/amr`
  specs that need the Desktop credential vault: run them with the AMR flags in a
  job that has a vault stand-in, rewrite them for the local-CLI path, or delete
  them with the AMR surfaces. Today they fail on every run.

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
