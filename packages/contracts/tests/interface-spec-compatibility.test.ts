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

  // Found on a real eGovFrame commit: `int length` became `Integer length`; the wire value is the same number.
  it('treats a Java primitive and its boxed type as the same type', () => {
    const boxed = revise((endpoint) => {
      endpoint.requestFields[0]!.dataType = 'long';
    });
    expect(compareInterfaceSpecDocuments(spec([createOrder]), boxed).level).toBe('none');
    const counts = spec([{ ...createOrder, requestFields: [{ nameEn: 'count', dataType: 'int', required: 'N' }] }]);
    const boxedCounts = spec([{ ...createOrder, requestFields: [{ nameEn: 'count', dataType: 'Integer', required: 'N' }] }]);
    expect(compareInterfaceSpecDocuments(counts, boxedCounts).level).toBe('none');
    const text = spec([{ ...createOrder, requestFields: [{ nameEn: 'count', dataType: 'String', required: 'N' }] }]);
    expect(compareInterfaceSpecDocuments(counts, text).changes).toEqual([expect.objectContaining({ code: 'field-type-changed' })]);
  });

  // ABT scenarios B2/B3: a value added to an enum a response returns can break a client that switches over every value;
  // the same addition on a request only widens what callers may send.
  it('classifies enum value changes by which side of the call sees them', () => {
    const withEnums = (status: string[], reason: string[]) => spec([{
      ...createOrder,
      requestFields: [{ nameEn: 'reason', dataType: 'RefundReason', required: 'Y', enumValues: reason }],
      responseFields: [{ nameEn: 'status', dataType: 'PaymentStatus', required: 'Y', enumValues: status }],
    }]);
    const before = withEnums(['PAID', 'REFUNDED'], ['CUSTOMER', 'DUPLICATE']);

    const added = compareInterfaceSpecDocuments(before, withEnums(['PAID', 'REFUNDED', 'PARTIAL_REFUND'], ['CUSTOMER', 'DUPLICATE', 'SYSTEM_ERROR']));
    expect(added.changes).toEqual([
      expect.objectContaining({ code: 'response-enum-value-added', level: 'warning', location: 'response', field: 'status', after: 'PARTIAL_REFUND' }),
      expect.objectContaining({ code: 'request-enum-value-added', level: 'info', location: 'request', field: 'reason', after: 'SYSTEM_ERROR' }),
    ]);

    const removed = compareInterfaceSpecDocuments(before, withEnums(['PAID'], ['CUSTOMER']));
    expect(removed.changes).toEqual([
      expect.objectContaining({ code: 'request-enum-value-removed', level: 'breaking', field: 'reason', before: 'DUPLICATE' }),
      expect.objectContaining({ code: 'response-enum-value-removed', level: 'info', field: 'status', before: 'REFUNDED' }),
    ]);

    // Order is not a change, and a side without recorded values is not compared (an older scan recorded none).
    expect(compareInterfaceSpecDocuments(before, withEnums(['REFUNDED', 'PAID'], ['DUPLICATE', 'CUSTOMER'])).level).toBe('none');
    const unrecorded = spec([{ ...createOrder, requestFields: [{ nameEn: 'reason', dataType: 'RefundReason', required: 'Y' }],
      responseFields: [{ nameEn: 'status', dataType: 'PaymentStatus', required: 'Y' }] }]);
    expect(compareInterfaceSpecDocuments(unrecorded, before).level).toBe('none');
  });

  // ABT scenario B4 (`size = 20` → `50`) and eGovFrame e4823589 (`defaultValue = "5"` removed).
  it('reports a changed or removed request default as a warning and a new default as info', () => {
    const page = (size?: string) => spec([{ ...createOrder, method: 'GET', path: '/api/orders',
      requestFields: [{ nameEn: 'size', dataType: 'Integer', required: 'N', ...(size === undefined ? {} : { defaultValue: size }) }] }]);
    expect(compareInterfaceSpecDocuments(page('20'), page('50')).changes).toEqual([
      expect.objectContaining({ code: 'request-default-changed', level: 'warning', field: 'size', before: '20', after: '50' }),
    ]);
    expect(compareInterfaceSpecDocuments(page('5'), page()).changes).toEqual([
      expect.objectContaining({ code: 'request-default-changed', level: 'warning', before: '5', after: undefined }),
    ]);
    expect(compareInterfaceSpecDocuments(page(), page('20')).changes).toEqual([
      expect.objectContaining({ code: 'request-default-changed', level: 'info', after: '20' }),
    ]);
    expect(compareInterfaceSpecDocuments(page('20'), page('20')).level).toBe('none');
  });

  // ABT scenario B1: `hasAuthority('SCOPE_blacklist.read')` → `hasAuthority('SCOPE_blacklist.admin')`.
  it('treats losing an authority that used to grant access as breaking and widening as info', () => {
    const guarded = (authorities?: string[], accessRule?: string) => spec([{ ...createOrder,
      ...(authorities ? { authorities } : {}), ...(accessRule ? { accessRule } : {}) }]);

    expect(compareInterfaceSpecDocuments(guarded(['SCOPE_blacklist.read']), guarded(['SCOPE_blacklist.admin'])).changes).toEqual([
      expect.objectContaining({ code: 'auth-authorities-narrowed', level: 'breaking', before: 'SCOPE_blacklist.read', after: 'SCOPE_blacklist.admin' }),
    ]);
    // Any authenticated caller before, only some after.
    expect(compareInterfaceSpecDocuments(guarded(), guarded(['ROLE_ADMIN'])).changes).toEqual([
      expect.objectContaining({ code: 'auth-authorities-narrowed', level: 'breaking', after: 'ROLE_ADMIN' }),
    ]);
    expect(compareInterfaceSpecDocuments(guarded(['ROLE_ADMIN']), guarded(['ROLE_ADMIN', 'ROLE_MANAGER'])).changes).toEqual([
      expect.objectContaining({ code: 'auth-authorities-widened', level: 'info', after: 'ROLE_ADMIN, ROLE_MANAGER' }),
    ]);
    expect(compareInterfaceSpecDocuments(guarded(['ROLE_ADMIN']), guarded()).changes).toEqual([
      expect.objectContaining({ code: 'auth-authorities-widened', level: 'info', before: 'ROLE_ADMIN' }),
    ]);
    expect(compareInterfaceSpecDocuments(guarded(['ROLE_A', 'ROLE_B']), guarded(['ROLE_B', 'ROLE_A'])).level).toBe('none');
    // A rule the scanner could not reduce to a list of authorities is compared as text and needs a decision.
    expect(compareInterfaceSpecDocuments(
      guarded(undefined, "hasRole('ADMIN') and #id == principal.id"),
      guarded(undefined, "hasRole('ADMIN')"),
    ).changes).toEqual([
      expect.objectContaining({ code: 'auth-rule-changed', level: 'warning', before: "hasRole('ADMIN') and #id == principal.id", after: "hasRole('ADMIN')" }),
    ]);
  });
});
