# Local ontology graph engine

## Choice (2026-10-15)

MonoField now uses **Graphology 0.26.0**, **graphology-traversal 0.3.1** and
**graphology-types 0.24.8**, pinned in the daemon package and lockfile. These are
MIT-licensed packages. Their distributed license notices remain in the runtime
dependencies. Graphology is a JavaScript/TypeScript graph library, also used as
Sigma.js's graph backend; it is not a graph database or an OWL reasoner.

The decision was based on the existing desktop architecture and bounded local
queries. Only Graphology was installed and executed in this comparison; the
other candidates were assessed through their primary documentation and licenses.

| Candidate | Fit for MonoField |
| --- | --- |
| [Graphology](https://graphology.github.io/) · [MIT license](https://github.com/graphology/graphology/blob/master/LICENSE.txt) | Selected: local typed directed multigraphs and traversal, no server, account, native binary or model process |
| [Memgraph](https://github.com/memgraph/memgraph) · [license](https://github.com/memgraph/memgraph/blob/master/LICENSE) | Valuable for shared persistent Cypher queries. A separate DB lifecycle and BSL/MEL terms add deployment and distribution considerations; not included in the default desktop runtime |
| [Neo4j Community](https://github.com/neo4j/neo4j) · [terms](https://neo4j.com/legal-terms/) | Established persistent graph DB, with Community GPLv3 licensing. Its server lifecycle and redistribution boundary require a separate integration decision |
| [N3.js](https://github.com/rdfjs/N3.js) · MIT | Useful for RDF/JS storage and Turtle/TriG interoperability. MonoField currently uses evidence-linked property graphs and fixed typed rules; RDF import/export is not implemented |

These choices do not establish that Graphology is faster than the databases.
No cross-database performance comparison was performed.

## Where it runs

The daemon builds an in-memory, request-scoped directed multigraph from the
current code/document snapshot. Source → consumer edges retain the original
document and evidence reference. Parallel evidence is retained. The shared index
serves specification dependency impact, code/document change planning, and the
reachability check that distinguishes missing coverage from no recorded impact.
The combined planner reuses one index for its plan and document review.

Multi-source breadth-first traversal retains one shortest recorded explanation
per affected item, terminates cycles/self loops and excludes unrelated items.
Missing endpoints or change seeds produce an error rather than a false claim of
no impact. Internal key encoding protects reserved JavaScript property names;
the returned user IDs and evidence are unchanged. No persistent Graphology
daemon, background poller, cloud request, API key or account is introduced.

Limits are 20,000 nodes / 50,000 edges per index, 1,000 affected items per change
plan, and 100,000 total explanation path entries. Specification impact also
shares that explanation budget across its changed sources. Oversized requests
ask the user to select a smaller module. Reachability uses predecessor IDs
without materializing all paths, avoiding quadratic explanation memory.

Existing UI/API/CLI entrypoints are retained:

- **Changes → Build ontology from code → Build code and document change plan**
- `POST /api/projects/:id/ontology/plan`
- `monofield docs plan-code --project PROJECT_ID --project-path . --json`
- Specification dependency analysis and `monofield docs plan` use the same index.

The existing parser layer still extracts supported code syntax and static
relationship candidates. Graphology does not discover business meaning, prove
dynamic calls, capture a live DB schema or automatically complete human reviews.
Optional Laya/JEV suggestions remain separate; graph planning makes no model
calls. Saved snapshots and receipts follow the
[root data-directory contract](../AGENTS.md#daemon-data-directory-contract).

## Measured evidence

The local Java/Spring + Vue fixture's **projected change graph** has 23 nodes and
32 edges with three changed sources. This is distinct from the richer code
ontology's 114 entities / 131 relationships. After integration, affected paths
were equal to the prior adjacency implementation. Pure graph construction plus
path traversal had a warm median of about **0.01 ms before / 0.10 ms after**
(51 sequential samples). This is a maintenance/representation improvement,
not a speed improvement. End-to-end parsing, Git hashing and command execution
must be measured separately.

The installed package files, including maps/types and transitive dependencies,
total about **3.2 MiB uncompressed**. This is not an installer-size measurement.
A synthetic 20,000-node / 50,000-edge graph had equal reachability to the old
implementation: index construction plus reachability had an approximately
165 ms median (11 samples), versus approximately 7 ms for the old loop. One
retained index added approximately 20.6 MiB of heap after GC. These are synthetic
graph observations, not total application memory or a customer-scale benchmark.
There is no new idle process. Request-scoped objects become collectible after
analysis. The full local report retains the individual measured summaries.

Focused tests exercise consumer direction, multiple changed sources, shortest
paths, diamonds, cycles, self loops, parallel evidence, malformed snapshots,
reserved IDs, bounded explanation memory and reuse after a traversal error.
Existing source-freshness, receipt, ambiguity and unknown-coverage tests remain
required. See [the all-in-one evidence report](testing/all-in-one-2026-10-13.md)
for actual Java, Maven, debugger, ontology and screen captures.
