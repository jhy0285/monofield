import { readFile } from "node:fs/promises";

export async function runDatabaseCli(args: string[], helpers: {
  baseUrl: (flags: Record<string, unknown>) => Promise<string>;
  parseFlags: (args: string[], options: { string: Set<string>; boolean: Set<string> }) => Record<string, unknown>;
  positionalArgs: (args: string[], stringFlags: Set<string>) => string[];
}): Promise<void> {
  const subcommand = args[0];
  if (!subcommand || subcommand === "help" || args.includes("--help") || args.includes("-h")) {
    console.log(`Usage:
  monofield database list [--json] [--daemon-url <url>]
  monofield database schemas [connection-id] [--json] [--daemon-url <url>]
  monofield database describe [connection-id] <schema> <table> [--json] [--daemon-url <url>]
  monofield database sample [connection-id] <schema> <table> [--limit <1-20>] [--json] [--daemon-url <url>]
  monofield database inspect [connection-id] --tables-file <path> [--limit <1-20>] [--concurrency <8|16|32>] [--json] [--daemon-url <url>]
  monofield database mutate [connection-id] --request-file <path> [--json] [--daemon-url <url>]
  monofield database candidates <project-id> [--schema <schema>] [--json] [--daemon-url <url>]

Agent runtime form:
  "$MONOFIELD_NODE_BIN" "$MONOFIELD_BIN" database <command> ...

Connection credentials are configured only in the MonoField desktop app.
When MONOFIELD_PROJECT_DATABASE_ID is present, the connection id may be omitted.
Reads follow the saved read policy. Structured INSERT, UPDATE, and DELETE
follow the selected access policy: read only, approve each write, or always
allow structured writes. UPDATE/DELETE require equality filters and are capped
at 100 rows. DDL and arbitrary SQL are never accepted.`);
    return;
  }
  const stringFlags = new Set(["daemon-url", "limit", "concurrency", "tables-file", "tables", "schema", "request-file"]);
  const flags = helpers.parseFlags(args.slice(1), { string: stringFlags, boolean: new Set(["json", "help", "h"]) });
  const values = helpers.positionalArgs(args.slice(1), stringFlags);
  const base = (await helpers.baseUrl(flags)).replace(/\/$/, "");
  let path: string;
  let init: RequestInit | undefined;
  const defaultConnectionId = (
    process.env.MONOFIELD_PROJECT_DATABASE_ID
      ?? process.env.OD_PROJECT_DATABASE_ID
  )?.trim() ?? "";
  const usesDefault = Boolean(defaultConnectionId) && (
    (subcommand === 'schemas' && values.length === 0)
    || ((subcommand === 'describe' || subcommand === 'sample') && values.length === 2)
    || ((subcommand === 'inspect' || subcommand === 'mutate') && values.length === 0)
  );
  const connectionId = usesDefault ? defaultConnectionId : (values[0] ?? "");
  const schema = usesDefault ? (values[0] ?? "") : (values[1] ?? "");
  const table = usesDefault ? (values[1] ?? "") : (values[2] ?? "");
  if (subcommand === "list") path = "/api/database/connections";
  else if (subcommand === "candidates" && values[0]) {
    const schema = typeof flags.schema === "string" ? `?schemas=${encodeURIComponent(flags.schema)}` : "";
    path = `/api/projects/${encodeURIComponent(values[0])}/database/candidates${schema}`;
  }
  else if (subcommand === "schemas" && connectionId) path = `/api/database/connections/${encodeURIComponent(connectionId)}/schemas`;
  else if (subcommand === "describe" && connectionId && schema && table) path = `/api/database/connections/${encodeURIComponent(connectionId)}/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`;
  else if (subcommand === "sample" && connectionId && schema && table) {
    const limit = flags.limit == null ? "" : `?limit=${encodeURIComponent(String(flags.limit))}`;
    path = `/api/database/connections/${encodeURIComponent(connectionId)}/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/sample${limit}`;
  } else if (subcommand === "inspect" && connectionId) {
    const tablesFile = typeof flags["tables-file"] === "string" ? flags["tables-file"] : "";
    const tablesJson = typeof flags.tables === "string"
      ? flags.tables
      : tablesFile
        ? await readFile(tablesFile, "utf-8")
        : "";
    let tables: unknown;
    try { tables = JSON.parse(tablesJson); }
    catch { throw new Error("inspect requires --tables-file <path> or --tables <json-array>"); }
    if (!Array.isArray(tables) || tables.length < 1) {
      throw new Error("inspect requires at least one table");
    }
    path = `/api/database/connections/${encodeURIComponent(connectionId)}/inspect`;
    init = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tables,
        ...(flags.limit == null ? {} : { limit: Number(flags.limit) }),
        ...(flags.concurrency == null ? {} : { concurrency: Number(flags.concurrency) }),
      }),
    };
  } else if (subcommand === 'mutate' && connectionId) {
    const requestFile = typeof flags['request-file'] === 'string' ? flags['request-file'] : '';
    if (!requestFile) throw new Error('mutate requires --request-file <path>');
    let request: unknown;
    try { request = JSON.parse(await readFile(requestFile, 'utf8')); }
    catch { throw new Error('mutation request file must contain valid JSON'); }
    if (request == null || typeof request !== 'object' || Array.isArray(request)) throw new Error('mutation request must be a JSON object');
    path = `/api/database/connections/${encodeURIComponent(connectionId)}/mutations`;
    const token = (process.env.MONOFIELD_TOOL_TOKEN ?? process.env.OD_TOOL_TOKEN)?.trim();
    if (!token) throw new Error('mutate is available only inside an active MonoField project run');
    init = {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(request),
    };
  } else {
    throw new Error(`invalid database command; run \`monofield database help\``);
  }
  if (subcommand !== 'candidates') {
    const token = (process.env.MONOFIELD_TOOL_TOKEN ?? process.env.OD_TOOL_TOKEN)?.trim();
    if (!token) throw new Error('database access is available only inside an active MonoField project run');
    init = {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        authorization: `Bearer ${token}`,
      },
    };
  }
  const response = await fetch(`${base}${path}`, init);
  const payload: any = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message ?? `database request failed: HTTP ${response.status}`);
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}
