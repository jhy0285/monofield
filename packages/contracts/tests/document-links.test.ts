import { describe, expect, it } from 'vitest';
import { DocumentEvidenceSchema, InterfaceSpecDocumentSchema, ScreenSpecDocumentSchema,
  DatabaseSchemaSnapshotSchema, DatabaseSchemaWatchConfigSchema } from '../src/index.js';

describe('document and database dependency contracts', () => {
  it('preserves exact DB targets through API document parsing', () => {
    const ref = { kind: 'database', ref: 'public.orders.id', database: { connectionId: 'db', schema: 'public', table: 'orders', column: 'id' } };
    const doc = InterfaceSpecDocumentSchema.parse({ schemaVersion: 1, kind: 'interface-spec', source: { codebaseName: 'Orders' },
      endpoints: [{ method: 'GET', path: '/orders', responseFields: [{ nameEn: 'id', evidenceRefs: [ref] }] }],
    });
    expect(doc.endpoints[0]?.responseFields[0]?.evidenceRefs).toEqual([ref]);
  });
  it('preserves screen and callout links without changing legacy documents', () => {
    const ref = { kind: 'requirement', ref: 'Orders API', document: { path: 'docs/api.json', itemId: 'IF-1' } };
    const doc = ScreenSpecDocumentSchema.parse({ schemaVersion: 1, kind: 'screen-spec', name: 'Orders', screens: [
      { id: 'SCR-1', evidenceRefs: [ref], callouts: [{ no: 1, position: { x: 0, y: 0 }, evidenceRefs: [ref] }] },
    ] });
    expect(doc.screens[0]?.evidenceRefs).toEqual([ref]);
    expect(doc.screens[0]?.callouts[0]?.evidenceRefs).toEqual([ref]);
    expect(DocumentEvidenceSchema.parse({ kind: 'code', ref: 'api.ts' })).toEqual({ kind: 'code', ref: 'api.ts' });
  });
  it('rejects external and traversal document links', () => {
    for (const file of ['../api.json', '/outside.json', 'C:\\outside.json', 'https://example.invalid/api.json']) {
      expect(DocumentEvidenceSchema.safeParse({ kind: 'requirement', ref: 'API', document: { path: file } }).success).toBe(false);
    }
  });
  it('accepts metadata hashes and refuses credential-bearing watch configuration', () => {
    expect(DatabaseSchemaSnapshotSchema.parse({ tables: [{ schema: 'public', table: 'orders', columns: [], structureSha256: 'a'.repeat(64) }] }).tables[0]?.structureSha256).toBe('a'.repeat(64));
    expect(DatabaseSchemaWatchConfigSchema.safeParse({ enabled: true, intervalSeconds: 60, connectionString: 'postgresql://user:pass@host/db' }).success).toBe(false);
  });
});
