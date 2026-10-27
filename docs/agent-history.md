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

As of 2026-10-27.

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
- Local verification status: `pnpm guard` and `pnpm typecheck` pass; web unit
  tests for the Design Files and File Workspace components pass (89 tests).

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

### Known baseline failures

Run on 2026-10-27 against the commit before the multi-project fix, with one
Playwright worker. These nine fail without any change from the agent; their
causes are not investigated. (`e2e/ui/development-focus.test.ts` also failed in
that run, but only because `node-pty` was not built yet; it passes once built.)

- `e2e/ui/app-design-files.test.ts`: "python-source-preview" and "file
  workspace restores HTML preview after switching through a source file".
- `e2e/ui/workspace-keyboard-flows.test.ts`: seven quick-switcher and
  tab-launcher tests (lines 13, 77, 105, 260, 294, 329, 363). Locators match
  duplicate options (strict-mode violations, 7 options where 3 are expected),
  which points to test drift.

## Open items

Newest first within each group. Remove an item when it is done.

Multi-project workspaces:

- Opening a folder with about 54,000 files requests `GET /api/projects/:id/files`
  twice (about 13 MB each) and takes 11–15 seconds to settle. `listFiles` in
  `apps/daemon/src/projects.ts` has no cap on the number of files. Find why the
  second request happens and consider a cap or a scoped listing.
- Maven or Gradle submodules declared inside a nested Git root (a child project
  with its own `.git`) are not offered in the module selector, because workspace
  manifests are expanded only at the workspace root
  (`explicitWorkspacePaths` in `apps/daemon/src/development-projects.ts`). This
  is deliberate IntelliJ-style module-boundary behavior; decide whether it is
  right for SI projects before changing it.
- A workspace root with no project marker (no `.git`, `package.json`, `pom.xml`,
  and so on) is not in the module list returned by
  `GET /api/projects/:id/development/configs`, so the module selector cannot
  select the root itself. Whether terminal and Git need the root is not checked.

Repository direction (from `docs/adr/0002-upstream-maintenance.md`, phases B–E
not started):

- Hide media providers and AMR from onboarding and Settings unless enabled.
- Move media templates, most design systems, and design-only skills into an
  optional bundle.
- Mark non-Codex, non-Claude adapters as community and unverified.
- Rename `@open-design/*` packages and remaining `od` naming to MonoField.

Code health:

- Split `apps/daemon/src/server.ts`, `apps/daemon/src/cli.ts`, and the large web
  components listed above. Do it as mechanical moves in their own PRs, not mixed
  with behavior changes.
- Database access supports PostgreSQL only; Oracle and Tibero need the broker
  work described in `docs/adr/0003-oracle-tibero-metadata-access.md`
  (phase 1 only is implemented).

## Log

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
