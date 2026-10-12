# Build an ontology from existing code

An imported codebase is enough to build a technical relationship graph. No
interface specification, screen specification, Git repository, model server or
AI credential is required. Business documents are optional. This produces a
source-grounded draft, not a complete business ontology or a runtime call graph.

In a development workspace, open **Changes → Build ontology from code**, then
click **Build from code**. Select the appropriate project module first. Opening
the workspace, typing and opening the panel do not trigger analysis. Search an
entity, inspect its relationships and expand source evidence to see the original
path, line and SHA-256. Export the full JSON or prepare an investigation request;
preparing it fills the composer and does not send or execute anything.

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
| Markdown/TXT business documents | Headings and glossary entries; exact symbol/parenthesized alias associations | Paragraph semantics and the correctness of every business association |

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

The `dependencyGraph` projection uses the existing document-graph contract and
can feed deterministic change planning. The code panel currently displays and
exports these relationships; it does not automatically run a verification plan,
add Maven/Gradle checks or synthesize an interface/screen specification. The
specification-based [change planner](ontology-change-planning.md) remains a
separate entry point.

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
Unchanged builds reuse parsed facts while refreshing Git change metadata. The
UI marks reports stale after a file refresh and disables request preparation
until rebuilt. This is manual rebuilding, not continuous schema/code monitoring.

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
late watcher events. `e2e/ui/code-ontology.test.ts` exercises the actual daemon
worker and browser against a Java/Spring + Vue traffic fixture, exports JSON and
rebuilds after a service edit. It does not run Spring/Vue servers or a live DB.
