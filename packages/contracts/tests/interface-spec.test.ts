import { describe, expect, it } from 'vitest';
import {
  createInterfaceSpecDocumentFromManualDraft,
  INTERFACE_SPEC_SCHEMA_VERSION,
  parseInterfaceSpecDocument,
  validateInterfaceSpecDocument,
} from '../src/docs/interface-spec';

function minimalDocument(): unknown {
  return {
    schemaVersion: INTERFACE_SPEC_SCHEMA_VERSION,
    kind: 'interface-spec',
    source: { codebaseName: 'aapserver' },
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/users',
        interfaceId: 'IF-USR-001',
        interfaceName: '사용자 조회',
        requestFields: [],
        responseFields: [{ nameEn: 'resultCode', dataType: 'Integer', required: 'Y' }],
      },
    ],
  };
}

describe('interface-spec document contract', () => {
  it('parses a minimal agent-produced document and fills defaults', () => {
    const result = parseInterfaceSpecDocument(minimalDocument());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.cover.brand).toBe('');
    expect(result.doc.source.collector).toBe('agent');
    expect(result.doc.source.mode).toBe('codebase');
    expect(result.doc.templatePreset).toBe('si-standard');
    expect(result.doc.endpoints[0]!.responseFields[0]!.nameKo).toBe('');
    expect(result.issues).toEqual([]);
  });

  it('rejects a document missing required shape and reports agent-feedable errors', () => {
    const result = parseInterfaceSpecDocument({
      schemaVersion: INTERFACE_SPEC_SCHEMA_VERSION,
      kind: 'interface-spec',
      source: {},
      endpoints: [{ method: 'GET' }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('source.codebaseName');
    expect(result.error).toContain('endpoints.0.path');
  });

  it('flags duplicate METHOD+URL keys as fatal, mirroring the legacy generator', () => {
    const parsed = parseInterfaceSpecDocument(minimalDocument());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const doc = {
      ...parsed.doc,
      endpoints: [parsed.doc.endpoints[0]!, { ...parsed.doc.endpoints[0]! }],
    };
    const issues = validateInterfaceSpecDocument(doc);
    expect(issues.some((i) => i.severity === 'fatal' && i.code === 'duplicate-endpoint-key')).toBe(
      true,
    );
    expect(issues.find((i) => i.code === 'duplicate-endpoint-key')?.endpointIndex).toBe(1);
  });

  it('warns on endpoints with no fields and on orphan parent paths', () => {
    const result = parseInterfaceSpecDocument({
      schemaVersion: INTERFACE_SPEC_SCHEMA_VERSION,
      kind: 'interface-spec',
      source: { codebaseName: 'svc' },
      endpoints: [
        { method: 'POST', path: '/a' },
        {
          method: 'POST',
          path: '/b',
          responseFields: [
            { nameEn: 'items', path: 'result.items', parentPath: 'result', depth: 1 },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain('empty-endpoint-fields');
    expect(codes).toContain('orphan-parent-path');
    expect(result.issues.every((i) => i.severity === 'warning')).toBe(true);
  });

  it('deterministically converts a reviewed no-codebase draft', () => {
    const result = createInterfaceSpecDocumentFromManualDraft({
      documentName: '주문 API 인터페이스 명세서',
      version: '1.0',
      templatePreset: 'review',
      endpoints: [{
        interfaceName: '주문 생성',
        interfaceId: 'if-ord-001',
        method: 'post',
        path: '/api/orders',
        auth: 'bearer',
        requestFields: [{ nameEn: 'customerId', minSize: '1', maxSize: '36', required: 'TBD' }],
        responseFields: [{ nameEn: 'orderId', dataType: 'String', required: 'Y' }],
      }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc).toMatchObject({
      source: { collector: 'manual', mode: 'manual', codebasePath: '' },
      templatePreset: 'review',
      endpoints: [{
        interfaceId: 'IF-ORD-001', method: 'POST', authRequired: true,
        auth: { type: 'bearer' }, requestFields: [{ nameEn: 'customerId', minSize: '1', maxSize: '36', required: 'TBD' }],
      }],
    });
  });

  it('drops hidden fields when a manual section is explicitly marked none', () => {
    const result = createInterfaceSpecDocumentFromManualDraft({
      documentName: 'Health API',
      endpoints: [{
        interfaceName: '상태 확인',
        method: 'GET',
        path: '/health',
        requestMode: 'none',
        responseMode: 'manual',
        requestFields: [{ nameEn: 'hiddenDraftValue' }],
        responseFields: [{ nameEn: 'status', dataType: 'String' }],
      }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.endpoints[0]?.requestFields).toEqual([]);
    expect(result.doc.endpoints[0]?.responseFields[0]).toMatchObject({ nameEn: 'status' });
  });

  it('rejects duplicate manual METHOD + path pairs before writing an artifact', () => {
    const endpoint = { interfaceName: '주문 생성', method: 'POST', path: '/api/orders' };
    const result = createInterfaceSpecDocumentFromManualDraft({
      documentName: 'Orders',
      endpoints: [endpoint, endpoint],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Duplicate endpoint key');
  });

  it('blocks missing endpoint documents and duplicate interface IDs', () => {
    const empty = parseInterfaceSpecDocument({
      schemaVersion: INTERFACE_SPEC_SCHEMA_VERSION,
      kind: 'interface-spec',
      source: { codebaseName: 'svc' },
      endpoints: [],
    });
    expect(empty.ok).toBe(true);
    if (!empty.ok) return;
    expect(empty.issues).toContainEqual(expect.objectContaining({ code: 'missing-endpoint', severity: 'fatal' }));

    const parsed = parseInterfaceSpecDocument(minimalDocument());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const duplicate = validateInterfaceSpecDocument({
      ...parsed.doc,
      endpoints: [
        parsed.doc.endpoints[0]!,
        { ...parsed.doc.endpoints[0]!, method: 'POST', interfaceId: 'if-usr-001' },
      ],
    });
    expect(duplicate).toContainEqual(expect.objectContaining({ code: 'duplicate-interface-id', severity: 'fatal' }));
  });

  it('warns when field definitions are unresolved or duplicated', () => {
    const result = parseInterfaceSpecDocument({
      schemaVersion: INTERFACE_SPEC_SCHEMA_VERSION,
      kind: 'interface-spec',
      source: { codebaseName: 'svc' },
      endpoints: [{
        method: 'POST', path: '/orders', interfaceId: 'IF-ORD-001',
        requestFields: [
          { nameEn: 'customerId', dataType: '', required: 'TBD' },
          { nameEn: 'customerId', dataType: 'String', required: 'Y' },
        ],
      }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unresolved-field-definition' }),
      expect.objectContaining({ code: 'duplicate-field-name' }),
    ]));
  });
});
