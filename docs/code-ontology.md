# Build an ontology from existing code

An imported codebase is enough to build a technical relationship graph. No
interface specification, screen specification, Git repository, model server or
AI credential is required. Business documents are optional. This produces a
source-grounded draft, not a complete business ontology or a runtime call graph.
The panel explicitly distinguishes code-only evidence from document candidates;
neither state marks business rules as verified.

In a development workspace, open **Changes → Build ontology from code**, then
click **Build from code**. Select the appropriate project module first. Opening
the workspace, typing and opening the panel do not trigger analysis. Search an
entity, inspect its relationships and expand source evidence to see the original
path, line and SHA-256. Export the full JSON or prepare an investigation request;
preparing it fills the composer and does not send or execute anything.
The first panel opening offers a five-step illustrative walkthrough. Close or
Escape dismisses it for that window; **Do not show again** persists the choice.
**Watch ontology walkthrough** replays it. The walkthrough itself never analyzes
the project, changes files or calls a model.

For separate `backend` and `frontend` folders, select **Include the full imported
codebase (frontend/backend)**. This analyzes their common imported root even
without a root build manifest or Git, while leaving the active command module
unchanged. Business paths are relative to that root in this mode. The CLI/API
equivalent is `projectPath: "."` / `--project-path .`; narrower modules keep the
existing discovered-project boundary.

## Current extraction scope

| Input | Extracted information | Requires review |
| --- | --- | --- |
| Java | Packages, imports, classes/interfaces/records/enums, fields and methods | Inheritance, generics, overloads, reflection and runtime DI |
| Spring MVC | Directly imported or qualified controller and mapping annotations with literal paths/methods | Constants, composed annotations, expressions and server context paths |
| JPA | Explicit `@Table` mappings from source | Actual DB schema, inferred names, column mappings and live DB connections |
| Vue SFC | Scripts, screen identity, component references and supported HTTP requests | Runtime props, generated templates and dynamic component resolution |
| JavaScript/TypeScript/JSX | Imports, declarations, local call candidates, Express routes, fetch/axios requests and JSX screen candidates | Full type resolution, arbitrary framework conventions and runtime targets |
| Markdown/TXT business documents | Headings, glossary entries, exact symbol/parenthesized alias associations and bounded rule-like lines | Meaning, scope, exceptions, currency, implementation consistency and every business association |

For example, a Vue axios request to `/api/intersections/${id}/signals` can be
paired with a unique Spring `GET /api/intersections/{id}/signals` mapping. A
controller's service call can be paired with a uniquely resolved Java method.
Both are static candidates. Two matching APIs or an overloaded method retain an
unresolved issue instead of receiving an arbitrary target. A JPA entity mapped
to `intersections` supplies a source mapping, not evidence that a database exists.

Optional documents must be selected explicitly as visible module-relative
`.md`/`.txt` paths. A heading such as `# 교차로 (Intersection)` can become a concept
and association candidates for matching source classes. Arbitrary prose,
PDF and Word extraction are not implemented. Document text is treated as data,
including headings that contain commands; it cannot grant execution permissions.
Rule-like lines retain their original text, path, line and hash. Words such as
“must”, “minimum”, “최소”, “필수” and “예외” identify candidates, not executable
constraints. Similar wording with different numeric literals produces a possible
conflict group. Different scopes may legitimately use different values. Every
candidate remains unreviewed; the builder does not choose which rule is correct.

## API and CLI

`POST /api/projects/:id/ontology/build` accepts:

```json
{
  "projectPath": ".",
  "businessFiles": ["docs/business.md"],
  "request": "Investigate signal-cycle changes"
}
```

All fields are optional. An empty object builds from the selected imported
project/module without business documents.

```sh
monofield docs build-ontology --project PROJECT_ID --json
monofield docs build-ontology --project PROJECT_ID --project-path backend --documents-file documents.json --prompt-file request.txt --json
```

`documents.json` contains an array of module-relative document paths. Either
`--documents-file -` or `--prompt-file -` accepts stdin, but not both together.
CLI file/stdin input is bounded to 32 KiB. `--daemon-url` selects the local daemon.
The response contains typed nodes and edges, syntax/candidate provenance, source
evidence, coverage, unresolved issues, a snapshot digest, cache status and a
bounded investigation draft. Opaque graph IDs are deterministic content hashes.

The `dependencyGraph` projection uses the existing document-graph contract.
**Build code and document change plan** combines source relationships with saved
API/screen specifications, Git changes and current verification receipts through
`POST /api/projects/:id/ontology/plan` / `monofield docs plan-code`. Maven checks
can be discovered without executing them. This does not synthesize missing
specifications, overwrite documents or automatically run checks. The
[change planner](ontology-change-planning.md) explains verification obligations.

### Inspect impact before editing

After building, select a class, method, API or screen and choose **Preview impact
before editing**. The selected item's source file becomes a hypothetical change
seed. The plan follows its recorded consumers into API/screen specifications and
lists required checks and manual reviews. No Git edit is required. Symbols are
conservatively expanded to their **whole file**, not a precise runtime slice.
Unrelated observed Git changes do not become simulation seeds. Previous passing
checks are not credited in a hypothetical plan; no command or source edit runs.

**Open source** opens the selected item's file in the existing workspace editor.
**Open document** opens a document requiring review. Building a normal code and
document change plan returns to observed Git changes. A stale report must be
rebuilt before starting a simulation; an observed missing/out-of-scope source is
rejected. Automatic refresh retains the chosen simulation files until a normal
build/plan or module/input change clears them.

The same plan endpoint accepts `simulateFiles`, an array of 1–32 source paths
relative to the **imported workspace root**, even when analyzing a child module:

```json
{"projectPath":"backend","simulateFiles":["backend/src/SignalService.java"]}
```

```sh
monofield docs plan-code --project PROJECT_ID --project-path . --simulate-file sources.json --prompt-file change.txt --json
```

`sources.json` contains source paths, not opaque graph IDs. `--simulate-file -`
accepts stdin, subject to the existing single-stdin/32 KiB limit. The separate
specification planner's `docs plan --simulate-file` continues to accept node IDs.
The response identifies simulation files and file granularity in `simulation`.

## Focused evidence for an AI request

**Prepare focused AI evidence** selects source anchors and up to two graph hops
for a question, rather than copying the full graph. Select an entity or business
rule to make it an explicit anchor. The default **References only** prompt holds
paths, line ranges and SHA-256 hashes; the agent must read those current files
later. **Include excerpts** embeds bounded source windows and candidate links.
Both modes verify selected file bytes against the graph snapshot and reject an
observed concurrent edit. Missing matches and omitted evidence remain visible.

`POST /api/projects/:id/ontology/context` accepts the build's `projectPath` and
`businessFiles`, a required `request`, `maxBytes` (2,048–24,000, default 4,096),
up to eight `focusNodeIds`, optional `localJudge` (default false), and
`evidenceMode: "references" | "excerpts"` (default references).

```sh
monofield docs context-code --project PROJECT_ID --project-path . --prompt-file question.txt --documents-file documents.json --max-bytes 4096 --evidence-mode references --json
```

`--focus-file ids.json` supplies node IDs. At most one input file may use stdin.
The response contains evidence, unreviewed rule candidates, warnings, a bounded
prompt, both full-graph and existing-draft byte baselines, and `tokenUsage: null`.
Preparing or exporting evidence does not send it to a coding agent.

Bytes are not provider tokens. The existing draft is already bounded, so focused
evidence can be larger than that draft. Reference mode moves source reads to a
later agent step; those tool messages and tokens are additional costs. The core
builder already uses zero model calls. No end-to-end provider token saving is
claimed from byte counts.

Optional `--local-judge` uses only an already configured local Laya/JEV-compatible
backend. It orders ambiguous candidate labels; it cannot establish business
truth or grant execution. Explicit anchors and strong lexical matches skip it.
One attempt has a two-second deadline. Failure or an uncertain answer preserves
deterministic selection; successful and uncertain results are cached for five
minutes by source snapshot, question, candidates and model configuration.
No model server is started or installed by this control. See the
[measured workflow report](testing/ontology-context-2026-10-15.md) before enabling it.

## Bounds, cache and extensions

Analysis runs on demand in an isolated worker; parser packages load there rather
than during daemon startup. At most two builds run at once, with a 256 MiB V8 old
generation limit per worker and a 30-second overall deadline. Workers terminate
after each build. These limits are not a promise of total process RSS.

The scanner skips dependencies, generated/build trees, hidden paths and
symlinks. Bounds are 2,000 source files, 20,000 directory entries, 32 MiB total
inputs, 512 KiB per file, depth 32, 20,000 nodes, 50,000 edges and a 10 MiB JSON
artifact. Exclusions, unsupported languages, syntax errors and truncation remain
visible. `inventoryComplete` describes the bounded inventory, not semantic or
runtime completeness. Select a smaller imported module when a limit is reached.

Code/document hashes, input selection and the trusted analyzer implementation
identify reusable results. Included files and the inventory are verified again
before a response; an observed concurrent edit fails with a rebuild request.
Unchanged builds reuse the complete graph while refreshing Git change metadata.
Changed builds can reuse per-file parsed facts when the file hash and analyzer
fingerprint match, then reassemble cross-file relationships. Deleting a method
cannot preserve a cached link to that method. Invalid acceleration caches fall
back to parsing. `reusedParsedFiles` and `parsedNowFiles` expose the work done.
Only derived parse facts are cached; source contents are not copied into this
acceleration cache. Runtime storage follows the contract linked below.

The UI marks reports stale after a file refresh. Optional refresh after saving
rebuilds while the panel is open and the agent is idle; it does not run checks or
rewrite documents. This is bounded source refresh, not continuous live DB schema
observation. Manual rebuilding remains available.

Runtime artifact storage follows the repository's
[daemon data directory contract](../AGENTS.md#daemon-data-directory-contract).
The scanner does not execute project source, install dependencies, load
project-supplied analyzers or send code/documents to a model. A later agent
request is a separate user action.

New languages implement `OntologyAnalyzer` in the daemon's trusted registry and
return the same evidence-bearing graph representation. Framework recognition
and cross-language resolution need corresponding rules and tests. Python, Go,
Rust, Kotlin and other discovered but unimplemented languages are explicitly
reported as unsupported; this registry does not mean every language works today.

Direct parser dependencies are `java-parser` (Apache-2.0), `@babel/parser` (MIT)
and `@vue/compiler-sfc` (MIT). They replace guesses based on comments or text
search with real syntax trees. This source change has not been packaged into a
new Windows installer, and installer size/idle Electron RSS are not measured.

## Verification

The daemon suite covers code-only construction, API/CLI parity, ambiguity,
comments/custom annotations, ORM source mappings, optional business candidates,
file boundaries, invalid syntax, graph size, cache reuse and edit invalidation.
The web suite covers manual invocation, source evidence, stale reports and
late watcher events, tutorial preferences and focused-context cancellation.
`e2e/ui/code-ontology.test.ts` exercises the actual daemon
worker and browser against a Java/Spring + Vue traffic fixture, exports JSON and
rebuilds after a service edit. It also checks walkthrough replay, rule candidates
and focused-context preparation. It does not run Spring/Vue servers or a live DB.
