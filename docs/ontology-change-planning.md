# Ontology and deterministic change planning

MonoField can turn recorded code, API, screen and database dependencies into a
change plan. Open an interface or screen specification, then **Screen, API and
database dependencies → Change impact and verification plan**. Click **Build
change plan**; opening the panel or typing does not analyze anything.

The same capability is available through
`POST /api/projects/:id/documents/plan` and the CLI:

```sh
monofield docs plan --project PROJECT_ID --inputs-file documents.json --rules-file change-policy.json --prompt-file request.txt --json
```

`documents.json` is a JSON array of project-relative specification paths.
`--prompt-file -` accepts stdin. `--simulate-file` accepts a JSON array of IDs
from the returned graph. Only one CLI input can use stdin. All output is JSON.
The policy path is relative to the imported project, not the CLI's cwd.

## What the ontology records

Nodes have explicit kinds: code, API, screen, database and registered check.
`depends-on` edges come from structured specification evidence. `verified-by`
edges come from explicit project bindings, with provenance identifying them as
declarations rather than inspected test assertions. Stable item IDs distinguish
interfaces and screens. Database targets include connection, schema, table and
optional column; credentials and row data are not included.

The plan follows reverse dependency edges to find affected consumers. It retains
one shortest recorded explanation path per affected item, terminates cycles and
leaves unrelated items out. Changed specification documents are also seeds.
Files without recorded links and unresolved references retain unknown coverage.
No import/call graph is automatically inferred in this version.

## Rules are data

Optional project policy example:

```json
{
  "schemaVersion": 1,
  "bindings": [
    {
      "target": {"kind": "api", "documentFile": "api.json", "itemId": "PRICE"},
      "checkIds": ["node:test"]
    }
  ],
  "rules": [
    {
      "id": "storefront-design",
      "when": {"kind": "screen", "itemId": "SHOP"},
      "require": {"checkIds": [], "reviews": ["contrast"]}
    },
    {
      "id": "payment-tests",
      "when": {"kind": "code", "pathPrefix": "src/payments"},
      "require": {"checkIds": ["node:test"], "reviews": []}
    }
  ]
}
```

Every populated selector condition must match. A path prefix matches complete
segments: `src/payments` matches descendants but not `src/payments-old`.
Kinds, item IDs and document paths are exact. Rules are cumulative; one rule
cannot waive another requirement. No JavaScript, shell commands, regexes or
expression language is accepted. Checks must already exist in the selected
project's registered catalog. Watch/fix/write scripts require separate manual
selection and are excluded from this planner.

Built-in conditions:

| If | Then |
| --- | --- |
| An API is affected | Require registered test and type checks; show missing checks explicitly |
| Code is affected | Require a registered test check |
| A screen is affected | Require browser, keyboard and responsive review |
| A DB target is affected | Require current-schema and consumer compatibility review |
| A recorded DB change may break compatibility | Also require migration and rollback review |
| An affected code/API/screen has no explicit check binding | Report unknown assertion coverage |
| A custom selector matches | Add its exact checks and manual reviews |
| Source or a command changes after a receipt | Withhold the previous passing command |
| A hypothetical source is selected | Follow its consumers; withhold all existing passing receipts |

Each obligation includes the fired rule ID, condition, target and explanation
path. The graph and complete obligations are exported alongside a bounded
development-request draft. The draft includes the requested change, evidence
paths, unresolved work and counts of omitted entries. Commands, scripts, code
contents and verification logs are not copied into it. Labels and policy values
are explicitly treated as data. Preparing a draft does not send it or execute it.

## Evidence and practical limits

A `passed-current` obligation means the same registered command passed in a
completed, stable run on the measured current source. It does not prove that the
command's assertions exercise the referenced item. Manual reviews remain
outstanding. Simulation never modifies code or a database, and ignores actual
change seeds while traversing the selected hypothetical seeds.

The runner's source boundary remains Git-visible files; ignored data, runtime
dependencies and live DB contents are not attested. A plan's freshness is an
observation at its recorded time, not a continuous guarantee. Reanalyze before
acting. Runtime data follows the [root daemon data-directory contract](../AGENTS.md#daemon-data-directory-contract).

No new runtime dependency, graph server or model process is introduced. Planning
makes zero model requests. It still reads project documents, runs read-only Git
queries and fingerprints source before/after analysis; those costs must be
measured separately from pure graph traversal. Limits include 200 documents,
2 MiB per document, 20 MiB total, 32 simulation seeds, 1000 affected items, 256
bindings, 64 custom rules and 10000 obligations. The UI previews at most 200
obligations; the JSON API retains the complete bounded result.

## Research and expansion choices

Primary-source review on 2026-10-10 compared several independent approaches:

| Approach | Product value | Decision |
| --- | --- | --- |
| [W3C SHACL](https://www.w3.org/TR/shacl/) | Graph constraints produce focus-node, path and rule explanations | Adopt the constraint/explanation pattern; this implementation is not an RDF/SHACL engine |
| [OPA/Rego](https://www.openpolicyagent.org/docs/philosophy) | Separate structured facts from deterministic policy decisions | Use bounded typed conditions now; an external policy runtime is not needed for this fixed vocabulary |
| [Ladybug embedded graphs](https://docs.ladybugdb.com/get-started/) | Persistent graph queries without operating a separate DB server | Candidate when measured project size/query requirements exceed the current bounded adjacency maps; no native DB package shipped here |
| [JEV skill suggestion](https://docs.typesafe.ai/cookbooks/skill_suggestion) | Rank closed candidates and permit rejection instead of invented choices | Keep the existing optional check advisor; deterministic graph facts do not need model classification |
| [SCIP](https://scip-code.org/) | Semantic symbol definitions and references can populate code relationships | Future importer for actual language-indexer output; no regex-based claim of complete dependency coverage |
| [Joern code property graph](https://docs.joern.io/code-property-graph/) | Rich syntax/control/data relationships for deep code investigation | Useful optional analysis backend for complex repositories; not a mandatory installation for every app user |
| [Stryker mutation testing](https://stryker-mutator.io/docs/) | Reveal tests that pass while missing important failures | Future isolated targeted test-strength probe; never mutate the user's working source in place |

Other product directions considered, but not implemented in this change:

1. **Design-token blast radius:** token → component → screen links, followed by
   browser captures at chosen viewport sizes. Requires actual token consumption
   and browser evidence, rather than assuming a passing unit test proves design.
2. **Contract compatibility:** compare captured API/DB field changes, nullability
   and consumers against explicit project invariants. Distinguish incompatible
   schemas from legitimately optional fields and unknown business intent.
3. **Decision replay:** rerun recorded rules against before/after snapshots to
   explain why a plan changed; source-linked receipts already provide part of
   this evidence boundary.
4. **Regression budgets:** project-defined time/memory/UI interaction limits,
   evaluated against repeated actual measurements rather than model estimates.
5. **Test-strength probes:** combine semantic changed-symbol scope with isolated
   mutations so a green suite can expose ineffective assertions.

The useful distinction is project relationships plus inspectable verification
evidence. No benchmark in this change establishes faster overall development
than a standalone coding agent or improved local Laya inference quality.
