import { describe, expect, it } from 'vitest';
import { InterfaceSpecDocumentSchema } from '@open-design/contracts';
import { compareInterfaceDocuments } from '../../src/components/document-spec/document-changes';

describe('document proposal comparison', () => {
  function document() {
    return InterfaceSpecDocumentSchema.parse({ schemaVersion: 1, kind: 'interface-spec', source: { codebaseName: 'Orders' },
      endpoints: [
        { method: 'GET', path: '/orders', interfaceId: 'IF-001', responseFields: [{ nameEn: 'id', dataType: 'Number', required: 'Y' }] },
        { method: 'POST', path: '/orders', interfaceId: 'IF-002' },
      ],
    });
  }
  it('finds a field change despite endpoint reordering', () => {
    const before = document(); const after = document(); after.endpoints.reverse();
    after.endpoints[1]!.responseFields[0]!.dataType = 'String';
    expect(compareInterfaceDocuments(before, after)).toEqual([{ target: 'IF-001 / RESPONSE / id / dataType', before: 'Number', after: 'String' }]);
  });
  it('makes deleted fields and removed evidence visible for review', () => {
    const before = document(); const after = document();
    before.endpoints[0]!.responseFields[0]!.evidence = 'Approved requirement';
    after.endpoints[0]!.responseFields = [];
    expect(compareInterfaceDocuments(before, after)).toEqual(expect.arrayContaining([
      { target: 'IF-001 / RESPONSE / id / nameEn', before: 'id', after: '—' },
      { target: 'IF-001 / RESPONSE / id / evidence', before: 'Approved requirement', after: '—' },
    ]));
  });
  it('shows changes to every occurrence of a repeated legacy field name', () => {
    const before = document(); const after = document();
    before.endpoints[0]!.responseFields.push({ ...before.endpoints[0]!.responseFields[0]!, dataType: 'String' });
    after.endpoints[0]!.responseFields.push({ ...after.endpoints[0]!.responseFields[0]!, dataType: 'String' });
    after.endpoints[0]!.responseFields[0]!.dataType = 'Boolean';
    expect(compareInterfaceDocuments(before, after)).toEqual([
      { target: 'IF-001 / RESPONSE / id [1] / dataType', before: 'Number', after: 'Boolean' },
    ]);
  });
});
