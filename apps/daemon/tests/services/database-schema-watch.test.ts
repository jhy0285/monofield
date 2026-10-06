import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSchemaSnapshot } from '@open-design/contracts';
import { DatabaseSchemaWatchService, diffSchemaSnapshots, normalizeSchemaSnapshot, schemaSnapshotHash } from '../../src/services/database-schema-watch.js';

const schema = (type = 'integer'): DatabaseSchemaSnapshot => ({ tables: [{ schema: 'public', table: 'orders', columns: [{ name: 'id', type, nullable: 'NO' }] }] });
describe('database schema monitoring', () => {
  let root: string, service: DatabaseSchemaWatchService;
  beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'schema-watch-')); });
  afterEach(async () => { await service?.stop(); await rm(root, { recursive: true, force: true }); });
  it('normalizes ordering without retaining row values and detects full type modifiers', () => {
    const a = { tables: [{ schema: 'public', table: 'orders', columns: [{ name: 'id', type: 'character varying(10)', nullable: 'NO', secret: 'discard' }], rows: [{ password: 'discard' }] }] };
    expect(JSON.stringify(normalizeSchemaSnapshot(a))).not.toContain('discard');
    expect(diffSchemaSnapshots(normalizeSchemaSnapshot(a), schema('character varying(20)'))).toEqual([
      { schema: 'public', table: 'orders', column: 'id', kind: 'column-changed', before: { type: 'character varying(10)', nullable: 'NO' }, after: { type: 'character varying(20)', nullable: 'NO' } },
    ]);
    expect(schemaSnapshotHash(schema())).toBe(schemaSnapshotHash(schema()));
    expect(() => normalizeSchemaSnapshot({ tables: [...schema().tables, ...schema().tables] })).toThrow('Duplicate');
  });
  it('detects added and removed tables/columns plus nullability changes', () => {
    const old = { tables: [...schema().tables, { schema: 'public', table: 'removed', columns: [] }] };
    const next = { tables: [{ schema: 'public', table: 'orders', columns: [{ name: 'id', type: 'integer', nullable: 'YES' }, { name: 'status', type: 'text', nullable: 'YES' }] }, { schema: 'public', table: 'added', columns: [] }] };
    expect(diffSchemaSnapshots(old, next).map((change) => change.kind)).toEqual(['table-removed', 'column-changed', 'column-added', 'table-added']);
    expect(diffSchemaSnapshots(next, schema()).some((change) => change.kind === 'column-removed')).toBe(true);
    expect(diffSchemaSnapshots({ tables: [{ ...schema().tables[0]!, structureSha256: 'a'.repeat(64) }] },
      { tables: [{ ...schema().tables[0]!, structureSha256: 'b'.repeat(64) }] })).toMatchObject([{ kind: 'table-changed' }]);
  });
  it('retains changes until explicit acknowledgement, rejects stale hashes, and persists across restart', async () => {
    let snapshot = schema();
    const broker = vi.fn(async () => snapshot);
    const options = { dataRoot: root, binding: () => ({ connectionId: 'db-1', workspacePath: '.' }), broker };
    service = new DatabaseSchemaWatchService(options);
    await service.start();
    await service.configure('p1', { enabled: true, intervalSeconds: 10 });
    const baseline = await service.check('p1');
    expect(baseline?.status).toBe('current');
    expect(broker).toHaveBeenCalledWith({ action: 'schema-snapshot', connectionId: 'db-1', background: true });
    snapshot = schema('text');
    const changed = await service.check('p1');
    expect(changed?.changes).toHaveLength(1);
    expect((await service.check('p1'))?.changes).toHaveLength(1);
    await expect(service.acknowledge('p1', baseline!.latestSha256!)).rejects.toThrow('changed');
    await service.stop();
    service = new DatabaseSchemaWatchService(options); await service.start();
    expect(service.get('p1')?.changes).toHaveLength(1);
    expect((await service.acknowledge('p1', changed!.latestSha256!))?.changes).toEqual([]);
  });
  it('polls due enabled watches and never overlaps a project capture', async () => {
    const broker = vi.fn(async () => schema());
    service = new DatabaseSchemaWatchService({ dataRoot: root, binding: () => ({ connectionId: 'db', workspacePath: '.' }), broker });
    await service.configure('p', { enabled: true, intervalSeconds: 60 });
    await Promise.all([service.tick(), service.tick()]);
    expect(broker).toHaveBeenCalledTimes(1);
    await service.tick(); expect(broker).toHaveBeenCalledTimes(1);
    await service.tick(Date.now() + 61000); expect(broker).toHaveBeenCalledTimes(2);
    await service.configure('p', { enabled: false, intervalSeconds: 60 });
    await service.tick(Date.now() + 120000); expect(broker).toHaveBeenCalledTimes(2);
  });
  it('fails visibly without advancing the baseline and does not expose broker errors', async () => {
    const broker = vi.fn().mockResolvedValueOnce(schema()).mockRejectedValue(new Error('postgres://user:password@host'));
    service = new DatabaseSchemaWatchService({ dataRoot: root, binding: () => ({ connectionId: 'db', workspacePath: '.' }), broker });
    await service.configure('p', { enabled: true, intervalSeconds: 10 });
    const baseline = await service.check('p');
    const failed = await service.check('p');
    expect(failed?.status).toBe('error'); expect(failed?.baselineSha256).toBe(baseline?.baselineSha256);
    expect(JSON.stringify(failed)).not.toContain('password');
  });
  it('rechecks the active module binding and redacts prior snapshots after selection changes', async () => {
    let binding: { connectionId: string; workspacePath: string } | null = { connectionId: 'db', workspacePath: 'module-a' };
    const broker = vi.fn(async () => schema());
    service = new DatabaseSchemaWatchService({ dataRoot: root, binding: () => binding, broker });
    await service.configure('p', { enabled: true, intervalSeconds: 10 }); await service.check('p');
    binding = { connectionId: 'db', workspacePath: 'module-b' };
    expect(service.get('p')).toMatchObject({ status: 'error', latest: null, baseline: null, changes: [] });
    await service.check('p'); expect(broker).toHaveBeenCalledTimes(1);
    binding = null;
    await expect(service.configure('p', { enabled: true, intervalSeconds: 10 })).rejects.toThrow('Select');
    await expect(service.configure('p', { enabled: false, intervalSeconds: 1 })).rejects.toThrow();
  });
});
