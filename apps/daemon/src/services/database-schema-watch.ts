import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSchemaSnapshotSchema as snapshotSchema, DatabaseSchemaWatchConfigSchema as configSchema,
  DatabaseSchemaWatchStateSchema as stateSchema } from '@open-design/contracts';
import type { DatabaseSchemaSnapshot, DatabaseSchemaChange, DatabaseSchemaWatchState, DatabaseSchemaWatchConfig } from '@open-design/contracts';
import type { DesktopDatabaseRequest } from '@open-design/sidecar-proto';

export function normalizeSchemaSnapshot(value: unknown): DatabaseSchemaSnapshot {
  const parsed = snapshotSchema.parse(value);
  const tableKeys = new Set<string>();
  let totalColumns = 0;
  for (const table of parsed.tables) {
    const key = JSON.stringify([table.schema, table.table]);
    if (tableKeys.has(key)) throw new Error('Duplicate schema table');
    tableKeys.add(key);
    const names = new Set(table.columns.map((column) => column.name));
    if (names.size !== table.columns.length) throw new Error('Duplicate schema column');
    totalColumns += table.columns.length;
    table.columns.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  }
  if (totalColumns > 50000) throw new Error('Schema monitoring limit exceeded');
  parsed.tables.sort((a, b) => JSON.stringify([a.schema, a.table]).localeCompare(JSON.stringify([b.schema, b.table]), 'en'));
  return parsed;
}

export function schemaSnapshotHash(snapshot: DatabaseSchemaSnapshot): string {
  return createHash('sha256').update(JSON.stringify(normalizeSchemaSnapshot(snapshot))).digest('hex');
}

export function diffSchemaSnapshots(before: DatabaseSchemaSnapshot, after: DatabaseSchemaSnapshot): DatabaseSchemaChange[] {
  const key = (table: DatabaseSchemaSnapshot['tables'][number]) => JSON.stringify([table.schema, table.table]);
  const oldTables = new Map(before.tables.map((table) => [key(table), table]));
  const newTables = new Map(after.tables.map((table) => [key(table), table]));
  const changes: DatabaseSchemaChange[] = [];
  for (const [id, table] of oldTables) {
    if (!newTables.has(id)) changes.push({ schema: table.schema, table: table.table, kind: 'table-removed' });
  }
  for (const [id, table] of newTables) {
    const old = oldTables.get(id);
    if (!old) { changes.push({ schema: table.schema, table: table.table, kind: 'table-added' }); continue; }
    if (old.structureSha256 !== table.structureSha256) changes.push({ schema: table.schema, table: table.table, kind: 'table-changed' });
    const oldColumns = new Map(old.columns.map((column) => [column.name, column]));
    const newColumns = new Map(table.columns.map((column) => [column.name, column]));
    for (const [name, column] of oldColumns) {
      if (!newColumns.has(name)) changes.push({ schema: table.schema, table: table.table, column: name, kind: 'column-removed', before: { type: column.type, nullable: column.nullable } });
    }
    for (const [name, column] of newColumns) {
      const previous = oldColumns.get(name);
      const afterValue = { type: column.type, nullable: column.nullable };
      if (!previous) changes.push({ schema: table.schema, table: table.table, column: name, kind: 'column-added', after: afterValue });
      else if (previous.type !== column.type || previous.nullable !== column.nullable) changes.push({ schema: table.schema, table: table.table, column: name, kind: 'column-changed', before: { type: previous.type, nullable: previous.nullable }, after: afterValue });
    }
  }
  return changes;
}

export type SchemaWatchBinding = { connectionId: string; workspacePath: string };
export class SchemaWatchConflict extends Error {}

/** Metadata polling through the existing encrypted Desktop broker; never SQL/credentials. */
export class DatabaseSchemaWatchService {
  private readonly directory: string;
  private readonly states = new Map<string, DatabaseSchemaWatchState>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;
  constructor(private readonly options: {
    dataRoot: string;
    binding: (projectId: string) => SchemaWatchBinding | null;
    broker: ((request: DesktopDatabaseRequest) => Promise<unknown>) | null;
  }) { this.directory = path.join(options.dataRoot, 'database-schema-watches'); }

  private file(projectId: string) { return path.join(this.directory, `${createHash('sha256').update(projectId).digest('hex')}.json`); }
  private matches(state: DatabaseSchemaWatchState) {
    const binding = this.options.binding(state.projectId);
    return binding?.connectionId === state.connectionId && binding.workspacePath === state.workspacePath;
  }
  get(projectId: string): DatabaseSchemaWatchState | null {
    const state = this.states.get(projectId);
    if (!state) return null;
    if (!this.matches(state)) return { ...state, status: 'error', baseline: null, latest: null, changes: [],
      baselineSha256: null, latestSha256: null, error: 'The selected project database changed. Configure monitoring again.' };
    return structuredClone(state);
  }
  private async save(state: DatabaseSchemaWatchState) {
    await mkdir(this.directory, { recursive: true });
    const destination = this.file(state.projectId), temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, destination);
    this.states.set(state.projectId, state);
  }
  private async serial<T>(projectId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(projectId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(action);
    this.locks.set(projectId, next);
    try { return await next; } finally { if (this.locks.get(projectId) === next) this.locks.delete(projectId); }
  }
  async start() {
    const files = await readdir(this.directory).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
    for (const file of files.filter((name) => /^[a-f0-9]{64}\.json$/.test(name))) {
      try {
        const text = await readFile(path.join(this.directory, file), 'utf8');
        if (text.length > 16 * 1024 * 1024) continue;
        const state = stateSchema.parse(JSON.parse(text));
        if (path.basename(this.file(state.projectId)) !== file) continue;
        this.states.set(state.projectId, state);
      } catch { console.warn('[monofield] Ignored an invalid schema monitoring state file.'); }
    }
    this.stopped = false;
    this.timer = setInterval(() => { void this.tick().catch(() => console.warn('[monofield] Schema monitoring persistence failed.')); }, 5000);
    this.timer.unref();
  }
  async stop() { this.stopped = true; clearInterval(this.timer); this.timer = undefined; await Promise.allSettled([...this.locks.values()]); }
  async tick(now = Date.now()) {
    if (this.stopped) return;
    await Promise.allSettled([...this.states.values()].filter((state) => state.enabled && !this.locks.has(state.projectId)
      && (!state.checkedAt || now - Date.parse(state.checkedAt) >= state.intervalSeconds * 1000))
      .map((state) => this.check(state.projectId)));
  }
  async configure(projectId: string, input: DatabaseSchemaWatchConfig) {
    const parsed = configSchema.safeParse(input);
    if (!parsed.success) throw new Error('Choose whether monitoring is enabled and an interval between 10 and 86400 seconds.');
    const config = parsed.data;
    return this.serial(projectId, async () => {
      const binding = this.options.binding(projectId);
      if (config.enabled && !binding) throw new Error('Select and enable a project database first.');
      const old = this.states.get(projectId);
      const same = old && binding && this.matches(old);
      const state: DatabaseSchemaWatchState = same ? { ...old, ...config, status: config.enabled ? old.status : 'disabled', error: null }
        : { ...config, projectId, connectionId: binding?.connectionId ?? '', workspacePath: binding?.workspacePath ?? '.',
          status: config.enabled ? 'pending' : 'disabled', checkedAt: null, baselineSha256: null, latestSha256: null,
          baseline: null, latest: null, changes: [], error: null };
      if (config.enabled && state.status === 'disabled') state.status = state.changes.length ? 'changed' : state.latest ? 'current' : 'pending';
      await this.save(state); return this.get(projectId);
    });
  }
  async check(projectId: string) {
    return this.serial(projectId, async () => {
      const state = this.states.get(projectId);
      if (!state?.enabled) throw new Error('Schema monitoring is not enabled.');
      try {
        if (!this.matches(state)) throw new Error('Binding changed');
        if (!this.options.broker) throw new Error('Desktop unavailable');
        const latest = normalizeSchemaSnapshot(await this.options.broker({ action: 'schema-snapshot', connectionId: state.connectionId, background: true }));
        if (!this.matches(state)) throw new Error('Binding changed during capture');
        const latestSha256 = schemaSnapshotHash(latest);
        const baseline = state.baseline ?? latest;
        const changes = diffSchemaSnapshots(baseline, latest);
        await this.save({ ...state, latest, latestSha256, baseline, baselineSha256: state.baselineSha256 ?? latestSha256,
          changes, status: changes.length ? 'changed' : 'current', checkedAt: new Date().toISOString(), error: null });
      } catch {
        await this.save({ ...state, status: 'error', checkedAt: new Date().toISOString(),
          error: 'Schema capture failed. Check the selected project database, Desktop connection and saved read approval.' });
      }
      return this.get(projectId);
    });
  }
  async acknowledge(projectId: string, expectedSha256: string) {
    return this.serial(projectId, async () => {
      const state = this.states.get(projectId);
      if (!state || !this.matches(state) || state.status === 'error' || !state.latest || !state.latestSha256
        || state.latestSha256 !== expectedSha256) throw new SchemaWatchConflict('The captured schema changed. Check again before acknowledging.');
      await this.save({ ...state, baseline: state.latest, baselineSha256: state.latestSha256, changes: [], status: state.enabled ? 'current' : 'disabled' });
      return this.get(projectId);
    });
  }
}
