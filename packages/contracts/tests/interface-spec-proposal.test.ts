import { describe, expect, it } from 'vitest';
import { applyInterfaceSpecProposal, InterfaceSpecDocumentSchema } from '../src/index.js';

const hash = 'a'.repeat(64);
function document() {
  return InterfaceSpecDocumentSchema.parse({ schemaVersion: 1, kind: 'interface-spec', source: { codebaseName: 'Orders' },
    endpoints: [{ method: 'GET', path: '/orders', interfaceId: 'IF-001', responseFields: [
      { nameEn: 'id', dataType: 'Number', evidence: 'Approved contract', reviewStatus: 'edited' },
    ] }, { method: 'GET', path: '/users', interfaceId: 'IF-002' }],
  });
}
function proposal(changes: unknown[]) { return { schemaVersion: 1, kind: 'interface-spec-proposal', baseContentSha256: hash, changes }; }

describe('incremental interface proposals', () => {
  it('changes a field without rewriting other endpoints or the human evidence', () => {
    const original = document();
    const result = applyInterfaceSpecProposal(original, hash, proposal([
      { op: 'test', path: '/endpoints/0/interfaceId', value: 'IF-001' },
      { op: 'replace', path: '/endpoints/0/responseFields/0/dataType', value: 'String' },
      { op: 'add', path: '/endpoints/0/responseFields/0/evidenceRefs', value: [{ kind: 'code', ref: 'orders.ts', line: 1 }] },
    ]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changesApplied).toBe(2);
    expect(result.doc.endpoints[1]).toEqual(original.endpoints[1]);
    expect(result.doc.endpoints[0]?.responseFields[0]).toMatchObject({ dataType: 'String', reviewStatus: 'edited', evidence: 'Approved contract' });
    expect(original.endpoints[0]?.responseFields[0]?.dataType).toBe('Number');
  });
  it('supports append and removal with validated array boundaries', () => {
    const result = applyInterfaceSpecProposal(document(), hash, proposal([
      { op: 'add', path: '/endpoints/0/responseFields/-', value: { nameEn: 'total', dataType: 'Number' } },
      { op: 'remove', path: '/endpoints/0/responseFields/0' },
    ]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc.endpoints[0]?.responseFields.map((field) => field.nameEn)).toEqual(['total']);
  });
  it.each([
    [{ op: 'test', path: '/endpoints/0/interfaceId', value: 'WRONG-ID' }],
    [{ op: 'replace', path: '/endpoints/99/path', value: '/bad' }],
    [{ op: 'add', path: '/__proto__/polluted', value: true }],
    [{ op: 'replace', path: '/schemaVersion', value: 2 }],
    [{ op: 'replace', path: '/endpoints/0/method', value: 42 }],
    [{ op: 'replace', path: '/endpoints/1/interfaceId', value: 'IF-001' }],
    [{ op: 'replace', path: '', value: {} }],
    [{ op: 'add', path: '/endpoints/0/responseFields/01', value: { nameEn: 'bad' } }],
    [{ op: 'add', path: '/unknownDocumentProperty', value: 'silently ignored' }],
  ].map((changes) => ({ changes })))('rejects invalid operations atomically: %j', ({ changes }) => {
    const original = document(); const before = JSON.stringify(original);
    expect(applyInterfaceSpecProposal(original, hash, proposal(changes)).ok).toBe(false);
    expect(JSON.stringify(original)).toBe(before);
  });
  it('rejects a stale source hash before applying changes', () => {
    expect(applyInterfaceSpecProposal(document(), 'b'.repeat(64), proposal([
      { op: 'replace', path: '/endpoints/0/path', value: '/new' },
    ]))).toMatchObject({ ok: false, error: expect.stringContaining('different document revision') });
  });
});
