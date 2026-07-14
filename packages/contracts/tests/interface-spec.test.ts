import { describe, expect, it } from 'vitest';
import {
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
});
