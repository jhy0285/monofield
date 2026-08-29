import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";

import { app, BrowserWindow, dialog, safeStorage, type MessageBoxOptions } from "electron";
import { Client, Pool } from "pg";

const STORAGE_FILE = "database-connections.v1.enc";
const AUDIT_FILE = "database-mutations.v1.jsonl";
const MAX_SAMPLE_ROWS = 20;
const MAX_INSPECT_TABLES = 32;
const MAX_MUTATION_ROWS = 100;
const MAX_MUTATION_COLUMNS = 50;
const DEFAULT_INSPECT_CONCURRENCY = 8;
const MAX_VALUE_CHARS = 2_000;
const SENSITIVE_COLUMN = /(?:api[_-]?key|authorization|credential|passwd|password|secret|token|e-?mail|phone|mobile|address|birth|dob|ssn|national[_-]?id|passport|card[_-]?(?:number|no)|iban|bank[_-]?account|account[_-]?(?:number|no)|latitude|longitude)/i;
const READ_ONLY_CONNECTION_OPTIONS = '-c default_transaction_read_only=on -c statement_timeout=10000';
const WRITE_CONNECTION_OPTIONS = '-c statement_timeout=10000';
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;

type StoredConnection = {
  id: string;
  label: string;
  connectionString: string;
  createdAt: string;
  readApproval: 'prompt' | 'always';
  // Legacy v1 metadata is deliberately ignored. Access is governed only by
  // writePolicy so the same rules apply to every database target.
  environment?: 'development' | 'test' | 'production';
  writePolicy?: 'disabled' | 'approve-each' | 'always';
};

type StoredDocument = { version: 1; connections: StoredConnection[] };

export type DatabaseConnectionSummary = {
  id: string;
  label: string;
  host: string;
  database: string;
  createdAt: string;
  readApproval: 'prompt' | 'always';
  /** Current broker capability. Reserved unions make later guarded writes explicit. */
  accessMode: 'read-only' | 'read-write';
  writePolicy: 'disabled' | 'approve-each' | 'always';
};

export type SaveDatabaseConnectionInput = {
  label: string;
  connectionString: string;
  writePolicy?: 'disabled' | 'approve-each' | 'always';
};

export type DatabaseReadApproval = 'prompt' | 'always';
export type DatabaseWritePolicy = 'disabled' | 'approve-each' | 'always';

export type DatabaseBrokerRequest =
  | { action: "list" }
  | { action: "schemas"; connectionId: string; selectedByUser?: boolean }
  | { action: "describe"; connectionId: string; schema: string; table: string }
  | { action: "sample"; connectionId: string; schema: string; table: string; limit?: number }
  | {
      action: "inspect";
      connectionId: string;
      tables: Array<{ schema: string; table: string }>;
      limit?: number;
      concurrency?: 8 | 16 | 32;
      selectedByUser?: boolean;
    }
  | {
      action: "mutate";
      connectionId: string;
      operation: 'insert' | 'update' | 'delete';
      schema: string;
      table: string;
      values?: Record<string, string | number | boolean | null>;
      where?: Record<string, string | number | boolean | null>;
      projectId?: string;
      reason: string;
    };

function storagePath(): string {
  return join(app.getPath("userData"), STORAGE_FILE);
}

function asPostgresUrl(value: string): URL {
  const source = value.trim().replace(/^jdbc:/i, "");
  const url = new URL(source);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("Only PostgreSQL connection URLs are supported");
  }
  if (!url.hostname || !url.pathname || url.pathname === "/") {
    throw new Error("Connection URL must include a host and database name");
  }
  return url;
}

function safeError(error: unknown): Error {
  const raw = error instanceof Error ? error.message : String(error);
  return new Error(raw
    .replace(/postgres(?:ql)?:\/\/[^\s@]+@/gi, "postgresql://[redacted]@")
    .replace(/([?&](?:password|pass|pwd|sslpassword)=)[^\s&]+/gi, "$1[redacted]")
    .replace(/(password\s*[=:]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/(user\s+)["'][^"']+["']/gi, '$1"[redacted]"'));
}

function summary(connection: StoredConnection): DatabaseConnectionSummary {
  const url = asPostgresUrl(connection.connectionString);
  const host = url.hostname.length <= 3 ? "***" : `${url.hostname.slice(0, 2)}...${url.hostname.slice(-1)}`;
  return {
    id: connection.id,
    label: connection.label,
    host,
    database: url.pathname.slice(1),
    createdAt: connection.createdAt,
    readApproval: connection.readApproval ?? 'prompt',
    accessMode: connection.writePolicy === 'disabled' || connection.writePolicy == null ? 'read-only' : 'read-write',
    writePolicy: connection.writePolicy ?? 'disabled',
  };
}

function requireMutationRecord(
  input: Record<string, unknown> | undefined,
  label: string,
  required: boolean,
): Array<[string, string | number | boolean | null]> {
  if (input == null) {
    if (required) throw new Error(`${label} is required`);
    return [];
  }
  const entries = Object.entries(input);
  if (required && entries.length === 0) throw new Error(`${label} is required`);
  if (entries.length > MAX_MUTATION_COLUMNS) throw new Error(`${label} exceeds ${MAX_MUTATION_COLUMNS} columns`);
  return entries.map(([key, value]) => {
    requireIdentifier(key, `${label} column`);
    if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new Error(`${label}.${key} must be a string, number, boolean, or null`);
    }
    if (typeof value === 'string' && value.length > MAX_VALUE_CHARS) throw new Error(`${label}.${key} is too long`);
    return [key, value];
  });
}

function requireIdentifier(value: string, label: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`${label} is not a permitted PostgreSQL identifier`);
  return value;
}

function quoteIdentifier(value: string, label: string): string {
  return `"${requireIdentifier(value, label)}"`;
}

function redactValue(key: string, value: unknown): unknown {
  if (SENSITIVE_COLUMN.test(key)) return "[redacted]";
  if (typeof value === "string" && value.length > MAX_VALUE_CHARS) return `${value.slice(0, MAX_VALUE_CHARS)}...`;
  return value;
}

export class DatabaseBroker {
  private async read(): Promise<StoredDocument> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("OS credential encryption is unavailable; database connections cannot be stored");
    }
    try {
      const encrypted = await fs.readFile(storagePath());
      const plaintext = safeStorage.decryptString(encrypted);
      const document = JSON.parse(plaintext) as StoredDocument;
      if (document.version !== 1 || !Array.isArray(document.connections)) throw new Error("invalid database connection store");
      return document;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, connections: [] };
      throw safeError(error);
    }
  }

  private async write(document: StoredDocument): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("OS credential encryption is unavailable; database connections cannot be stored");
    }
    const path = storagePath();
    const temporary = `${path}.${randomUUID()}.tmp`;
    await fs.mkdir(app.getPath("userData"), { recursive: true });
    await fs.writeFile(temporary, safeStorage.encryptString(JSON.stringify(document)), { mode: 0o600 });
    await fs.rename(temporary, path);
  }

  async list(): Promise<DatabaseConnectionSummary[]> {
    return (await this.read()).connections.map(summary);
  }

  async save(input: SaveDatabaseConnectionInput): Promise<DatabaseConnectionSummary> {
    const label = input.label.trim();
    if (!label) throw new Error("Connection name is required");
    const url = asPostgresUrl(input.connectionString);
    if (input.writePolicy != null && input.writePolicy !== 'disabled' && input.writePolicy !== 'approve-each' && input.writePolicy !== 'always') {
      throw new Error('Invalid database write policy');
    }
    const document = await this.read();
    const existing = document.connections.find((connection) => connection.label === label);
    const sameTarget = existing?.connectionString === url.toString();
    const connection: StoredConnection = {
      // A connection id is the project-facing identity of one exact target.
      // Replacing the URL under the same id would silently retarget every
      // linked project, so issue a new id and force those projects to relink.
      id: sameTarget ? existing.id : randomUUID(),
      label,
      connectionString: url.toString(),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      // A saved approval belongs to the exact encrypted connection target.
      // Reusing a label for another host/database must not carry it over.
      readApproval: sameTarget
        ? (existing.readApproval ?? 'prompt')
        : 'prompt',
      // Access approvals belong to the encrypted connection target, not its
      // display label. Reusing a label for a different host/database must not
      // silently grant the new target the prior target's write capability.
      writePolicy: input.writePolicy ?? (sameTarget ? existing?.writePolicy : undefined) ?? 'disabled',
    };
    if (connection.writePolicy === 'always'
      && (!sameTarget || existing?.writePolicy !== 'always')
      && !await this.confirmAlwaysWrite(connection.label)) {
      throw new Error('Always allow writes was not approved');
    }
    document.connections = [
      ...document.connections.filter((item) => item.id !== connection.id && item.id !== existing?.id),
      connection,
    ];
    await this.write(document);
    return summary(connection);
  }

  async setReadApproval(connectionId: string, readApproval: DatabaseReadApproval): Promise<DatabaseConnectionSummary> {
    if (readApproval !== 'prompt' && readApproval !== 'always') throw new Error('Invalid database read approval');
    const document = await this.read();
    const connection = document.connections.find((item) => item.id === connectionId);
    if (!connection) throw new Error('Database connection was not found');
    connection.readApproval = readApproval;
    await this.write(document);
    return summary(connection);
  }

  async setAccessPolicy(connectionId: string, writePolicy: DatabaseWritePolicy): Promise<DatabaseConnectionSummary> {
    if (writePolicy !== 'disabled' && writePolicy !== 'approve-each' && writePolicy !== 'always') throw new Error('Invalid database write policy');
    const document = await this.read();
    const connection = document.connections.find((item) => item.id === connectionId);
    if (!connection) throw new Error('Database connection was not found');
    if (writePolicy === 'always' && connection.writePolicy !== 'always' && !await this.confirmAlwaysWrite(connection.label)) {
      throw new Error('Always allow writes was not approved');
    }
    connection.writePolicy = writePolicy;
    await this.write(document);
    return summary(connection);
  }

  async remove(connectionId: string): Promise<void> {
    const document = await this.read();
    const connections = document.connections.filter((connection) => connection.id !== connectionId);
    if (connections.length === document.connections.length) throw new Error("Database connection was not found");
    await this.write({ ...document, connections });
  }

  async test(input: SaveDatabaseConnectionInput): Promise<void> {
    const url = asPostgresUrl(input.connectionString);
    const client = new Client({
      connectionString: url.toString(),
      connectionTimeoutMillis: 10_000,
      query_timeout: 10_000,
      options: READ_ONLY_CONNECTION_OPTIONS,
    });
    try {
      await client.connect();
      await client.query("SELECT 1");
    } catch (error) {
      throw safeError(error);
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  private async inspect(connectionString: string, request: Extract<DatabaseBrokerRequest, { action: "inspect" }>): Promise<unknown> {
    if (request.tables.length > MAX_INSPECT_TABLES) {
      throw new Error(`At most ${MAX_INSPECT_TABLES} tables may be inspected in one request`);
    }
    const limit = Math.min(Math.max(Math.floor(request.limit ?? 5), 1), MAX_SAMPLE_ROWS);
    const concurrency = request.concurrency ?? DEFAULT_INSPECT_CONCURRENCY;
    const pool = new Pool({
      connectionString,
      connectionTimeoutMillis: 10_000,
      query_timeout: 10_000,
      max: Math.min(concurrency, request.tables.length),
      options: READ_ONLY_CONNECTION_OPTIONS,
    });
    try {
      // Column metadata is identical in shape for every selected table, so
      // fetch it in one parameterized query before sampling table rows.
      const values = request.tables.flatMap((selection) => [selection.schema, selection.table]);
      const valuePairs = request.tables
        .map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`)
        .join(", ");
      const columnResult = await pool.query<{
        schema: string;
        tableName: string;
        name: string;
        type: string;
        nullable: string;
      }>(
        `WITH requested(schema_name, table_name) AS (VALUES ${valuePairs})
         SELECT c.table_schema AS schema, c.table_name AS "tableName", c.column_name AS name,
                c.data_type AS type, c.is_nullable AS nullable
         FROM information_schema.columns c
         JOIN requested r ON r.schema_name = c.table_schema AND r.table_name = c.table_name
         ORDER BY c.table_schema, c.table_name, c.ordinal_position`,
        values,
      );
      const columnsByTable = new Map<string, unknown[]>();
      for (const row of columnResult.rows) {
        const key = `${row.schema}.${row.tableName}`;
        const columns = columnsByTable.get(key) ?? [];
        columns.push({ name: row.name, type: row.type, nullable: row.nullable });
        columnsByTable.set(key, columns);
      }
      const tables: Array<{
        schema: string;
        table: string;
        columns: unknown[];
        sampleRows: Array<Record<string, unknown>>;
        error?: string;
      }> = [];
      for (let offset = 0; offset < request.tables.length; offset += concurrency) {
        const batch = request.tables.slice(offset, offset + concurrency);
        const results = await Promise.all(batch.map(async (selection) => {
          try {
            const selectedSchema = quoteIdentifier(selection.schema, "schema");
            const selectedTable = quoteIdentifier(selection.table, "table");
            const sample = await pool.query(`SELECT * FROM ${selectedSchema}.${selectedTable} LIMIT $1`, [limit]);
            return {
              schema: selection.schema,
              table: selection.table,
              columns: columnsByTable.get(`${selection.schema}.${selection.table}`) ?? [],
              sampleRows: sample.rows.map((row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, redactValue(key, value)]))),
            };
          } catch (error) {
            return {
              schema: selection.schema,
              table: selection.table,
              columns: [],
              sampleRows: [],
              error: safeError(error).message,
            };
          }
        }));
        tables.push(...results);
      }
      return { tables };
    } finally {
      await pool.end().catch(() => undefined);
    }
  }

  private async approved(connection: StoredConnection, request: DatabaseBrokerRequest): Promise<boolean> {
    if (request.action === 'list') return true;
    if (request.action === 'mutate') return await this.approveMutation(connection, request);
    if (connection.readApproval === 'always') return true;
    const detail = request.action === "schemas"
      ? "Read database schemas and table names."
      : request.action === "describe"
        ? `Read column metadata for ${request.schema}.${request.table}.`
        : request.action === "inspect"
          ? `Read column metadata and up to ${Math.min(Math.max(request.limit ?? 5, 1), MAX_SAMPLE_ROWS)} redacted sample rows from ${request.tables.length} selected tables in one batch using up to ${request.concurrency ?? DEFAULT_INSPECT_CONCURRENCY} connections. Tables: ${request.tables.slice(0, 12).map((item) => `${item.schema}.${item.table}`).join(", ")}${request.tables.length > 12 ? ", ..." : ""}.`
        : `Read up to ${Math.min(Math.max(request.limit ?? 5, 1), MAX_SAMPLE_ROWS)} rows from ${request.schema}.${request.table}. Sensitive-looking columns are redacted.`;
    const options: MessageBoxOptions = {
      buttons: ["Approve", "Cancel"],
      cancelId: 1,
      defaultId: 1,
      detail,
      message: "Allow MonoField database read?",
      noLink: true,
      type: "warning",
    };
    const parent = BrowserWindow.getFocusedWindow();
    const result = parent == null ? await dialog.showMessageBox(options) : await dialog.showMessageBox(parent, options);
    return result.response === 0;
  }

  private async approveMutation(
    connection: StoredConnection,
    request: Extract<DatabaseBrokerRequest, { action: 'mutate' }>,
  ): Promise<boolean> {
    const writePolicy = connection.writePolicy ?? 'disabled';
    if (writePolicy === 'disabled') {
      throw new Error('Database writes are disabled for this connection');
    }
    const values = requireMutationRecord(request.values, 'values', request.operation !== 'delete');
    const where = requireMutationRecord(request.where, 'where', request.operation !== 'insert');
    const operation = request.operation.toUpperCase();
    const detail = [
      `${operation} on ${request.schema}.${request.table}`,
      values.length > 0 ? `Columns: ${values.map(([key]) => key).join(', ')}` : null,
      where.length > 0 ? `Filter columns: ${where.map(([key]) => key).join(', ')}` : null,
      `Access policy: ${writePolicy === 'always' ? 'Always allow structured writes' : 'Approve each write'}`,
      `Reason: ${request.reason.trim().slice(0, 240) || 'No reason supplied'}`,
      request.operation === 'insert'
        ? 'At most one row will be inserted.'
        : `The operation is canceled if more than ${MAX_MUTATION_ROWS} rows match.`,
    ].filter(Boolean).join('\n');
    if (writePolicy === 'always') return true;
    const options: MessageBoxOptions = {
      buttons: ['Approve once', 'Cancel'],
      cancelId: 1,
      defaultId: 1,
      detail,
      message: 'Allow MonoField database write?',
      noLink: true,
      type: 'warning',
    };
    const parent = BrowserWindow.getFocusedWindow();
    const result = parent == null ? await dialog.showMessageBox(options) : await dialog.showMessageBox(parent, options);
    return result.response === 0;
  }

  private async confirmAlwaysWrite(label: string): Promise<boolean> {
    const options: MessageBoxOptions = {
      buttons: ['Enable always allow', 'Cancel'],
      cancelId: 1,
      defaultId: 1,
      detail: [
        `Connection: ${label}`,
        'MonoField may run structured INSERT, UPDATE, and DELETE without asking again for each operation.',
        `UPDATE and DELETE still require equality filters and stop above ${MAX_MUTATION_ROWS} matching rows.`,
        'Arbitrary SQL and DDL remain unavailable. Every mutation is written to the local audit log.',
      ].join('\n'),
      message: 'Enable always allow database writes?',
      noLink: true,
      type: 'warning',
    };
    const parent = BrowserWindow.getFocusedWindow();
    const result = parent == null ? await dialog.showMessageBox(options) : await dialog.showMessageBox(parent, options);
    return result.response === 0;
  }

  private async mutate(
    connection: StoredConnection,
    request: Extract<DatabaseBrokerRequest, { action: 'mutate' }>,
  ): Promise<unknown> {
    requireIdentifier(request.schema, 'schema');
    requireIdentifier(request.table, 'table');
    const values = requireMutationRecord(request.values, 'values', request.operation !== 'delete');
    const where = requireMutationRecord(request.where, 'where', request.operation !== 'insert');
    const schema = quoteIdentifier(request.schema, 'schema');
    const table = quoteIdentifier(request.table, 'table');
    const client = new Client({
      connectionString: connection.connectionString,
      connectionTimeoutMillis: 10_000,
      query_timeout: 10_000,
      // Mutation connections must not inherit the read-only startup option
      // used by schema/sample reads. The structured broker policy, bounded
      // statements, and explicit transaction remain the write safety boundary.
      options: WRITE_CONNECTION_OPTIONS,
    });
    try {
      await client.connect();
      await client.query('BEGIN');
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await client.query("SET LOCAL statement_timeout = '10s'");
      let result: { rowCount: number | null };
      if (request.operation === 'insert') {
        const columns = values.map(([key]) => quoteIdentifier(key, 'value column')).join(', ');
        const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
        result = await client.query(`INSERT INTO ${schema}.${table} (${columns}) VALUES (${placeholders})`, values.map(([, value]) => value));
      } else {
        const whereClause = where.map(([key], index) => `${quoteIdentifier(key, 'where column')} IS NOT DISTINCT FROM $${index + 1}`).join(' AND ');
        const whereValues = where.map(([, value]) => value);
        const matches = await client.query(`SELECT 1 FROM ${schema}.${table} WHERE ${whereClause} LIMIT ${MAX_MUTATION_ROWS + 1} FOR UPDATE`, whereValues);
        if (matches.rowCount != null && matches.rowCount > MAX_MUTATION_ROWS) {
          throw new Error(`Database mutation matched more than ${MAX_MUTATION_ROWS} rows`);
        }
        if (request.operation === 'delete') {
          result = await client.query(`DELETE FROM ${schema}.${table} WHERE ${whereClause}`, whereValues);
        } else {
          const assignments = values.map(([key], index) => `${quoteIdentifier(key, 'value column')} = $${index + 1}`).join(', ');
          const shiftedWhere = where.map(([key], index) => `${quoteIdentifier(key, 'where column')} IS NOT DISTINCT FROM $${values.length + index + 1}`).join(' AND ');
          result = await client.query(`UPDATE ${schema}.${table} SET ${assignments} WHERE ${shiftedWhere}`, [...values.map(([, value]) => value), ...whereValues]);
        }
      }
      await client.query('COMMIT');
      const auditId = randomUUID();
      const audit = {
        auditId,
        at: new Date().toISOString(),
        connectionId: connection.id,
        connectionLabel: connection.label,
        projectId: request.projectId ?? null,
        operation: request.operation,
        schema: request.schema,
        table: request.table,
        affectedRows: result.rowCount ?? 0,
        reason: request.reason.trim().slice(0, 240),
      };
      let auditRecorded = true;
      try {
        await fs.appendFile(join(app.getPath('userData'), AUDIT_FILE), `${JSON.stringify(audit)}\n`, { encoding: 'utf8', mode: 0o600 });
      } catch {
        // COMMIT has already succeeded. Returning a failed mutation here invites
        // an agent or user to retry an operation that was actually applied.
        // Preserve the committed result and make the degraded audit state
        // explicit without exposing local filesystem details.
        auditRecorded = false;
      }
      return {
        approved: true,
        affectedRows: result.rowCount ?? 0,
        operation: request.operation,
        schema: request.schema,
        table: request.table,
        auditId,
        auditRecorded,
        ...(auditRecorded ? {} : {
          auditWarning: 'The database mutation committed, but the local audit log could not be written.',
        }),
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw safeError(error);
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  async execute(request: DatabaseBrokerRequest): Promise<unknown> {
    if (request.action === "list") return { connections: await this.list() };
    const connection = (await this.read()).connections.find((item) => item.id === request.connectionId);
    if (!connection) throw new Error("Database connection was not found");
    if (!await this.approved(connection, request)) throw new Error(request.action === 'mutate' ? 'Database write was not approved' : 'Database read was not approved');
    if (request.action === 'mutate') return await this.mutate(connection, request);
    if (request.action === "inspect") return await this.inspect(connection.connectionString, request);
    const client = new Client({
      connectionString: connection.connectionString,
      connectionTimeoutMillis: 10_000,
      query_timeout: 10_000,
      options: READ_ONLY_CONNECTION_OPTIONS,
    });
    try {
      await client.connect();
      if (request.action === "schemas") {
        const result = await client.query<{ schema: string; table: string }>(
          "SELECT table_schema AS schema, table_name AS table FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('information_schema', 'pg_catalog') ORDER BY table_schema, table_name",
        );
        return { tables: result.rows };
      }
      if (request.action === "describe") {
        const result = await client.query(
          "SELECT column_name AS name, data_type AS type, is_nullable AS nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
          [request.schema, request.table],
        );
        return { columns: result.rows };
      }
      const schema = quoteIdentifier(request.schema, "schema");
      const table = quoteIdentifier(request.table, "table");
      const limit = Math.min(Math.max(Math.floor(request.limit ?? 5), 1), MAX_SAMPLE_ROWS);
      const result = await client.query(`SELECT * FROM ${schema}.${table} LIMIT $1`, [limit]);
      return { rows: result.rows.map((row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, redactValue(key, value)]))) };
    } catch (error) {
      throw safeError(error);
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}
