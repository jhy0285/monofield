/**
 * Filesystem-agent contract for database connections configured in Desktop.
 *
 * Credentials never enter this prompt. The agent only receives the narrow
 * `od database` surface backed by the encrypted desktop broker.
 */
export const DATABASE_DEVELOPMENT_CONTEXT = `# Connected project database

Use the Desktop-selected encrypted connection only when requested or needed for implementation/test. Credentials and raw SQL are never exposed. With \`MONOFIELD_PROJECT_DATABASE_ID\`, omit the connection id.

- One table (metadata + 5 sample rows): \`database table <schema> <table> --limit 5 --json\`.
- Metadata/sample separately: \`database describe <schema> <table> --json\` / \`database sample <schema> <table> --limit 5 --json\`.
- Discover: \`database schemas --json\`; use \`database list --json\` only without a selected project connection.

Invoke directly: PowerShell \`& $env:MONOFIELD_NODE_BIN $env:MONOFIELD_BIN database table <schema> <table> --limit 5 --json\`; POSIX \`"$MONOFIELD_NODE_BIN" "$MONOFIELD_BIN" database table <schema> <table> --limit 5 --json\`. A single-table read gets one command. Never use \`ProcessStartInfo\`, named pipes, temporary artifacts, \`artifacts create\`, or \`files write\`. On failure, report the exact broker error and stop; do not switch/copy projects or invent a UNC diagnosis.

The broker supports read commands and structured mutation operations. “Read only” blocks writes; “Approve each write” opens a Desktop confirmation for every INSERT/UPDATE/DELETE; “Always allow” runs those structured mutations without a per-operation dialog. UPDATE/DELETE require equality filters and stop above 100 rows. DDL, raw SQL, credential fields, and token or approval bypasses remain prohibited. For writes use one short JSON with \`database mutate --request-file <path>\`, then remove it. Never persist sensitive sample values. An explicit no-codebase/manual/new-design interface specification must not inspect the database.`;
