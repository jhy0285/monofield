/**
 * Filesystem-agent contract for database connections configured in Desktop.
 *
 * Credentials never enter this prompt. The agent only receives the narrow
 * `od database` surface backed by the encrypted desktop broker.
 */
export const DATABASE_DEVELOPMENT_CONTEXT = `# Connected project database

MonoField Desktop can expose user-configured PostgreSQL connections through a narrow, structured CLI. Treat this as optional project context for ordinary development work, not as a database that must be queried on every turn. When \`OD_PROJECT_DATABASE_ID\` is set, that encrypted connection is the project's selected database and read commands may omit its id.

Use it when the user explicitly says to consult the connected database, or when a backend/API/migration/test task genuinely depends on the persisted schema or representative data. Do not query it for unrelated UI styling, copy edits, or other work that can be completed from the selected Working folder alone.

Safe workflow for filesystem-capable runs:
1. If \`OD_PROJECT_DATABASE_ID\` is set, use that project connection. Otherwise list credential-free summaries with \`"$OD_NODE_BIN" "$OD_BIN" database list --json\` and resolve by label. Ask only if more than one connection is equally plausible.
2. Inspect schemas and column metadata before requesting sample rows. Read only the tables relevant to the task and keep sample limits small.
3. Use the results to implement or verify code in the selected Working folder. Never copy credentials, connection URLs, tokens, or unredacted sensitive values into source files, prompts, logs, or generated artifacts.

The broker provides list, schemas, describe, sample, batch inspect, and structured mutation operations; it never exposes credentials or arbitrary SQL. A connection set to “Ask every time” shows a Desktop approval dialog before each direct read; “Always allow read-only” skips that repeated dialog for the same encrypted target.

Connection access has three levels: “Read only” blocks writes, “Approve each write” opens a Desktop confirmation for every INSERT/UPDATE/DELETE, and “Always allow” runs those structured mutations without a per-operation dialog after a one-time warning. UPDATE and DELETE require non-empty equality filters and are canceled above 100 matching rows in either writable mode. DDL, raw SQL, credential fields, and token or approval bypasses remain prohibited. Create a short project-local JSON request with \`operation\`, \`schema\`, \`table\`, \`values\` and/or \`where\`, \`projectId\`, and \`reason\`, then call \`database mutate --request-file <path>\`. Delete that temporary request after the operation unless the user asked to retain it.

Interface-spec exception: an explicit no-codebase/manual/new-design interface specification must not inspect files or database connections. Follow the manual collector workflow instead. Codebase-derived interface specifications continue to follow their dedicated source-folder and database-context gates.`;
