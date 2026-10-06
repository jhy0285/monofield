import { describe, expect, it } from 'vitest';
import { InterfaceSpecDocumentSchema, ScreenSpecDocumentSchema, type DatabaseSchemaWatchState } from '@open-design/contracts';
import { buildDocumentGraph } from '../../src/services/document-graph.js';

const api = () => InterfaceSpecDocumentSchema.parse({ schemaVersion: 1, kind: 'interface-spec', source: { codebaseName: 'Orders' }, endpoints: [
  { method: 'GET', path: '/orders', interfaceId: 'IF-1', sourceFile: 'orders.ts', responseFields: [
    { nameEn: 'id', evidenceRefs: [{ kind: 'database', ref: 'Orders ID', database: { connectionId: 'db', schema: 'public', table: 'orders', column: 'id' } }] },
  ] }, { method: 'GET', path: '/unknown', interfaceId: 'IF-2' },
] });
const screen = () => ScreenSpecDocumentSchema.parse({ schemaVersion: 1, kind: 'screen-spec', name: 'Orders', screens: [
  { id: 'SCR-1', evidenceRefs: [{ kind: 'requirement', ref: 'Orders response', document: { path: 'api.json', itemId: 'IF-1' } }] },
] });
const watch = (column = 'id'): DatabaseSchemaWatchState => ({ projectId: 'p', workspacePath: '.', connectionId: 'db', enabled: true, intervalSeconds: 10,
  status: 'changed', checkedAt: null, baselineSha256: null, latestSha256: null, baseline: null, latest: null, error: null,
  changes: [{ schema: 'public', table: 'orders', column, kind: 'column-changed' }],
});
describe('screen/API/database dependency graph', () => {
  it('propagates an exact DB column change through an API to its screen and preserves the path', () => {
    const result = buildDocumentGraph({ documents: [{ file: 'api.json', doc: api() }, { file: 'screen.json', doc: screen() }], schemaWatch: watch() });
    const impacted = result.impacts.map((impact) => result.nodes.find((node) => node.id === impact.nodeId));
    expect(impacted.map((node) => node?.itemId)).toEqual(['IF-1', 'SCR-1']);
    expect(result.impacts[1]?.path).toHaveLength(3);
    expect(result.unlinkedNodeIds.map((id) => result.nodes.find((node) => node.id === id)?.itemId)).toEqual(['IF-2']);
    expect(buildDocumentGraph({ documents: [{ file: 'api.json', doc: api() }], schemaWatch: watch('other') }).impacts).toEqual([]);
  });
  it('follows code changes transitively and terminates for document cycles', () => {
    const document = api();
    document.endpoints[0]!.evidenceRefs = [{ kind: 'requirement', ref: 'Screen cycle', document: { path: 'screen.json', itemId: 'SCR-1' } }];
    const result = buildDocumentGraph({ documents: [{ file: 'api.json', doc: document }, { file: 'screen.json', doc: screen() }], changedFiles: ['orders.ts'] });
    expect(result.impacts).toHaveLength(2);
    expect(new Set(result.impacts.map((item) => item.nodeId)).size).toBe(2);
  });
  it('reports missing targets and opaque legacy DB refs rather than assuming coverage', () => {
    const document = api();
    document.endpoints[0]!.responseFields[0]!.evidenceRefs = [{ kind: 'database', ref: 'legacy.orders.id' }];
    const result = buildDocumentGraph({ documents: [{ file: 'api.json', doc: document }, { file: 'other.json', doc: screen() }] });
    expect(result.warnings.some((warning) => warning.includes('structured target'))).toBe(true);
    const missing = screen(); missing.screens[0]!.evidenceRefs![0]!.document!.itemId = 'missing';
    expect(buildDocumentGraph({ documents: [{ file: 'api.json', doc: document }, { file: 'screen.json', doc: missing }] }).warnings.some((warning) => warning.includes('Unresolved'))).toBe(true);
  });
  it('does not treat failed schema monitoring as a current source of change evidence', () => {
    const state = { ...watch(), status: 'error' as const };
    const result = buildDocumentGraph({ documents: [{ file: 'api.json', doc: api() }], schemaWatch: state });
    expect(result.impacts).toEqual([]); expect(result.warnings.join()).toContain('unknown');
  });
});
