import { describe, expect, it } from 'vitest';
import { compareInterfaceSpecDocuments, InterfaceSpecDocumentSchema } from '../src/index.js';

function spec(endpoints: unknown[]) {
  return InterfaceSpecDocumentSchema.parse({ schemaVersion: 1, kind: 'interface-spec', source: { codebaseName: 'Orders' }, endpoints });
}

const createOrder = {
  method: 'POST',
  path: '/api/orders',
  interfaceId: 'IF-ORD-001',
  authRequired: true,
  requestFields: [
    { nameEn: 'memberId', dataType: 'Long', required: 'Y' },
    { nameEn: 'items', dataType: 'List<OrderItem>', required: 'Y' },
    { nameEn: 'productId', path: 'items.productId', parentPath: 'items', depth: 1, dataType: 'Long', required: 'Y' },
    { nameEn: 'memo', dataType: 'String', required: 'N', maxSize: '200' },
  ],
  responseFields: [
    { nameEn: 'orderId', dataType: 'Long', required: 'Y' },
    { nameEn: 'status', dataType: 'String', required: 'Y' },
  ],
};

function revise(mutate: (endpoint: typeof createOrder) => void) {
  const copy = structuredClone(createOrder);
  mutate(copy);
  return spec([copy]);
}

describe('interface spec compatibility', () => {
  it('reports no change for identical documents', () => {
    const report = compareInterfaceSpecDocuments(spec([createOrder]), spec([createOrder]));
    expect(report).toEqual({ level: 'none', counts: { breaking: 0, warning: 0, info: 0 }, changes: [] });
  });

  it('treats additive changes as info', () => {
    const after = revise((endpoint) => {
      endpoint.requestFields.push({ nameEn: 'deliveryMemo', dataType: 'String', required: 'N' });
      endpoint.responseFields.push({ nameEn: 'orderedAt', dataType: 'LocalDateTime', required: 'Y' });
    });
    const withCancel = spec([...after.endpoints, { method: 'POST', path: '/api/orders/{orderId}/cancel', interfaceId: 'IF-ORD-004' }]);
    const report = compareInterfaceSpecDocuments(spec([createOrder]), withCancel);
    expect(report.level).toBe('info');
    expect(report.changes.map((change) => change.code).sort()).toEqual([
      'endpoint-added', 'request-field-added-optional', 'response-field-added',
    ]);
    expect(report.changes.find((change) => change.code === 'endpoint-added')).toMatchObject({
      route: 'POST /api/orders/{orderId}/cancel', interfaceId: 'IF-ORD-004',
    });
  });

  it('flags changes that can break an existing caller', () => {
    const after = revise((endpoint) => {
      endpoint.requestFields.push({ nameEn: 'channel', dataType: 'String', required: 'Y' });
      endpoint.requestFields[3]!.required = 'Y';
      endpoint.requestFields[3]!.maxSize = '100';
      endpoint.requestFields[2]!.dataType = 'String';
      endpoint.responseFields.splice(1, 1);
    });
    const report = compareInterfaceSpecDocuments(spec([createOrder]), after);
    expect(report.level).toBe('breaking');
    expect(report.counts.breaking).toBe(5);
    expect(report.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'request-field-added-required', field: 'channel', location: 'request' }),
      expect.objectContaining({ code: 'request-field-became-required', field: 'memo', before: 'N', after: 'Y' }),
      expect.objectContaining({ code: 'request-field-max-size-reduced', field: 'memo', before: '200', after: '100' }),
      expect.objectContaining({ code: 'field-type-changed', field: 'items.productId', before: 'Long', after: 'String' }),
      expect.objectContaining({ code: 'response-field-removed', field: 'status', location: 'response' }),
    ]));
    expect(report.changes[0]?.level).toBe('breaking');
  });

  it('marks changes that need a decision as warnings', () => {
    const after = revise((endpoint) => {
      endpoint.authRequired = false;
      endpoint.requestFields.splice(3, 1);
      endpoint.requestFields.push({ nameEn: 'coupon', dataType: 'String', required: 'TBD' });
      endpoint.responseFields[1]!.required = 'N';
    });
    const report = compareInterfaceSpecDocuments(spec([createOrder]), after);
    expect(report.level).toBe('warning');
    expect(report.changes.map((change) => change.code).sort()).toEqual([
      'auth-required-removed', 'request-field-added-unresolved', 'request-field-removed', 'response-field-became-optional',
    ]);
  });

  it('matches renamed path parameters and reports a removed endpoint as breaking', () => {
    const getOrder = { method: 'GET', path: '/api/orders/{id}', interfaceId: 'IF-ORD-002' };
    const renamed = compareInterfaceSpecDocuments(spec([getOrder]), spec([{ ...getOrder, path: '/api/orders/{orderId}' }]));
    expect(renamed.level).toBe('none');

    const removed = compareInterfaceSpecDocuments(spec([createOrder, getOrder]), spec([createOrder]));
    expect(removed).toMatchObject({ level: 'breaking', counts: { breaking: 1, warning: 0, info: 0 } });
    expect(removed.changes[0]).toMatchObject({ code: 'endpoint-removed', route: 'GET /api/orders/{id}', interfaceId: 'IF-ORD-002' });
  });

  it('ignores type spelling differences and newly required auth is breaking', () => {
    const after = revise((endpoint) => {
      endpoint.requestFields[1]!.dataType = 'List< OrderItem >';
    });
    expect(compareInterfaceSpecDocuments(spec([createOrder]), after).level).toBe('none');

    const open = { ...createOrder, authRequired: false };
    const report = compareInterfaceSpecDocuments(spec([open]), spec([createOrder]));
    expect(report.changes).toEqual([expect.objectContaining({ code: 'auth-required-added', level: 'breaking' })]);
  });
});
