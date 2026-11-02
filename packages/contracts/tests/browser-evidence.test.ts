import { describe, expect, it } from 'vitest';
import {
  BROWSER_EVIDENCE_TEXT,
  applyBrowserEvidence,
  crossCheckBrowserEvidence,
  dataTypeFamily,
  emptyBrowserEvidenceSpec,
  findSpecEndpoint,
  generalizeObservedPath,
  isApiTransaction,
  matchSpecPath,
  observedDataType,
  observedFieldsFromJson,
  type BrowserTransaction,
  type ObservedBody,
} from '../src/api/browser-evidence';
import { parseInterfaceSpecDocument, type InterfaceSpecDocument } from '../src/docs/interface-spec';

type FieldInput = { nameEn: string; dataType?: string; path?: string; parentPath?: string; required?: string };
type EndpointInput = {
  method: string;
  path: string;
  interfaceId?: string;
  note?: string;
  requestFields?: FieldInput[];
  responseFields?: FieldInput[];
};

function spec(endpoints: EndpointInput[]): InterfaceSpecDocument {
  const field = (item: FieldInput) => ({ nameKo: '', dataType: 'String', required: 'Y', ...item });
  const parsed = parseInterfaceSpecDocument({
    schemaVersion: 1,
    kind: 'interface-spec',
    cover: { brand: '', docName: 'orders', version: '1', department: '' },
    source: { codebaseName: 'orders', codebasePath: 'orders', language: 'java', framework: 'spring-boot', collector: 'agent' },
    endpoints: endpoints.map((endpoint, index) => ({
      interfaceId: `IF-${index + 1}`,
      note: '',
      ...endpoint,
      requestFields: (endpoint.requestFields ?? []).map(field),
      responseFields: (endpoint.responseFields ?? []).map(field),
    })),
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.doc;
}

function body(json: unknown, over: Partial<ObservedBody> = {}): ObservedBody {
  return { state: 'captured', mediaType: 'application/json', fields: observedFieldsFromJson(json), example: json, ...over };
}

const none: ObservedBody = { state: 'not_exposed', fields: [] };
let counter = 0;

function tx(over: Partial<BrowserTransaction> & { method: string; path: string }): BrowserTransaction {
  counter += 1;
  return {
    evidenceFile: 'evidence/capture.json',
    evidenceId: 'ev_1',
    transactionId: `request-${counter}`,
    stepIndex: 1,
    origin: 'http://localhost:4318',
    queryNames: [],
    resourceType: 'fetch',
    status: 200,
    request: none,
    response: none,
    ...over,
  };
}

describe('observed JSON fields', () => {
  it('lists dotted paths with arrays transparent and merges item types', () => {
    const fields = observedFieldsFromJson({
      id: 1,
      price: 1.5,
      tags: ['a'],
      items: [{ sku: 'x', qty: 2 }, { sku: 'y', qty: null, note: 'n' }],
      owner: { name: 'kim', address: { zip: '04524' } },
    });
    const byPath = Object.fromEntries(fields.map((field) => [field.path, field]));
    expect(byPath.id).toMatchObject({ name: 'id', depth: 0, types: ['integer'] });
    expect(byPath.price!.types).toEqual(['number']);
    expect(byPath.tags!.types).toEqual(['array']);
    expect(byPath['items.sku']).toMatchObject({ name: 'sku', parentPath: 'items', depth: 1, types: ['string'] });
    expect(byPath['items.qty']!.types).toEqual(['integer', 'null']);
    expect(byPath['items.note']!.types).toEqual(['string']);
    expect(byPath['owner.address.zip']).toMatchObject({ depth: 2, parentPath: 'owner.address' });
  });

  it('reports nothing for scalars and stops at the depth and count limits', () => {
    expect(observedFieldsFromJson('text')).toEqual([]);
    expect(observedFieldsFromJson(null)).toEqual([]);
    const deep = { a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } };
    expect(observedFieldsFromJson(deep).map((field) => field.path)).toContain('a.b.c.d.e.f.g');
    expect(observedFieldsFromJson(deep).map((field) => field.path)).not.toContain('a.b.c.d.e.f.g.h');
    const wide = Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`k${i}`, i]));
    expect(observedFieldsFromJson(wide)).toHaveLength(400);
  });
});

describe('path generalization and matching', () => {
  it('replaces identifiers and numbers repeated ones', () => {
    expect(generalizeObservedPath('/api/orders/1001/settle')).toBe('/api/orders/{id}/settle');
    expect(generalizeObservedPath('/api/members/3f2b8c1e-1111-4a2b-9c3d-0123456789ab/orders/42')).toBe('/api/members/{id}/orders/{id2}');
    expect(generalizeObservedPath('/api/orders')).toBe('/api/orders');
    expect(generalizeObservedPath('/')).toBe('/');
  });

  it('matches path parameters in all four notations', () => {
    expect(matchSpecPath('/api/orders/{id}', '/api/orders/7')).toBeGreaterThanOrEqual(0);
    expect(matchSpecPath('/api/orders/:id', '/api/orders/7')).toBeGreaterThanOrEqual(0);
    expect(matchSpecPath('/api/orders/[id]', '/api/orders/7')).toBeGreaterThanOrEqual(0);
    expect(matchSpecPath('/api/orders/<id>', '/api/orders/7')).toBeGreaterThanOrEqual(0);
    expect(matchSpecPath('/api/orders/{id}', '/api/members/7')).toBe(-1);
    expect(matchSpecPath('/api/orders/{id}', '/api/orders')).toBe(-1);
  });

  it('lets a spec path omit a deployment prefix but never match on parameters alone', () => {
    expect(matchSpecPath('/api/orders', '/app/api/orders')).toBeGreaterThanOrEqual(0);
    expect(matchSpecPath('/api/orders/{id}', '/app/api/orders/9')).toBeGreaterThanOrEqual(0);
    // `/{id}` has no literal segment, so it would otherwise match every one-segment tail.
    expect(matchSpecPath('/{id}', '/api/orders')).toBe(-1);
    // An exact match scores higher than a prefixed one with the same literals.
    expect(matchSpecPath('/api/orders', '/api/orders')).toBeGreaterThan(matchSpecPath('/api/orders', '/app/api/orders'));
  });

  it('decodes percent-encoded segments before comparing', () => {
    expect(matchSpecPath('/api/주문', '/api/%EC%A3%BC%EB%AC%B8')).toBeGreaterThanOrEqual(0);
    expect(matchSpecPath('/api/orders', '/api/%E0%A4%A')).toBe(-1);
  });

  it('chooses the endpoint with the most literal segments and respects the method', () => {
    const doc = spec([
      { method: 'GET', path: '/api/orders/{id}' },
      { method: 'GET', path: '/api/orders/search' },
      { method: 'POST', path: '/api/orders/{id}' },
    ]);
    expect(findSpecEndpoint(doc, 'get', '/api/orders/search')).toBe(1);
    expect(findSpecEndpoint(doc, 'GET', '/api/orders/55')).toBe(0);
    expect(findSpecEndpoint(doc, 'POST', '/api/orders/55')).toBe(2);
    expect(findSpecEndpoint(doc, 'DELETE', '/api/orders/55')).toBeNull();
    expect(findSpecEndpoint(doc, 'GET', '/api/members')).toBeNull();
  });
});

describe('documented and observed types', () => {
  it('tells the JSON family a documented type implies', () => {
    expect(dataTypeFamily('Long')).toBe('number');
    expect(dataTypeFamily('Integer (observed)')).toBe('number');
    expect(dataTypeFamily('BigDecimal')).toBe('number');
    expect(dataTypeFamily('LocalDateTime')).toBe('string');
    expect(dataTypeFamily('VARCHAR2(20)')).toBe('string');
    expect(dataTypeFamily('boolean')).toBe('boolean');
    expect(dataTypeFamily('List<OrderDto>')).toBe('array');
    expect(dataTypeFamily('OrderDto[]')).toBe('array');
    expect(dataTypeFamily('Map')).toBe('object');
    // Application types and unknowns establish nothing, so they never produce a mismatch.
    expect(dataTypeFamily('OrderDto')).toBeNull();
    expect(dataTypeFamily('unknown')).toBeNull();
    expect(dataTypeFamily('')).toBeNull();
  });

  it('writes the documented type for an observed one', () => {
    expect(observedDataType(['integer'])).toBe('Integer');
    expect(observedDataType(['string', 'null'])).toBe('String');
    expect(observedDataType(['integer', 'string'])).toBe('Integer | String');
    expect(observedDataType(['null'])).toBe('unknown');
    expect(observedDataType([])).toBe('unknown');
  });

  it('treats fetch and xhr calls and JSON responses as API calls, not documents and assets', () => {
    expect(isApiTransaction(tx({ method: 'GET', path: '/a', resourceType: 'fetch' }))).toBe(true);
    expect(isApiTransaction(tx({ method: 'GET', path: '/a', resourceType: 'xhr' }))).toBe(true);
    expect(isApiTransaction(tx({ method: 'GET', path: '/a', resourceType: 'other', response: body({ a: 1 }) }))).toBe(true);
    expect(isApiTransaction(tx({ method: 'GET', path: '/', resourceType: 'document', response: body({ a: 1 }) }))).toBe(false);
    expect(isApiTransaction(tx({ method: 'GET', path: '/app.js', resourceType: 'script' }))).toBe(false);
  });
});

describe('cross-check findings', () => {
  const doc = spec([{
    method: 'POST',
    path: '/api/orders/{id}/settle',
    responseFields: [
      { nameEn: 'settlement_id', dataType: 'Integer' },
      { nameEn: 'fee_amount', dataType: 'Integer' },
      { nameEn: 'netAmount', dataType: 'Integer' },
    ],
  }]);
  const settled = tx({
    method: 'POST', path: '/api/orders/1001/settle', status: 201,
    response: body({ settlement_id: 7, fee_amount: 30, net_amount: 970, region: 'KR' }),
  });

  it('reports a field the spec lacks, a renamed one and an extra endpoint', () => {
    const extra = tx({ method: 'GET', path: '/api/settlements', response: body([{ id: 1 }]) });
    const { findings, summary, coverage } = crossCheckBrowserEvidence(doc, [settled, extra]);
    expect(findings.map((finding) => `${finding.kind}:${finding.field ?? ''}`).sort()).toEqual([
      'name-mismatch:net_amount',
      'undocumented-endpoint:',
      'undocumented-field:region',
    ]);
    const renamed = findings.find((finding) => finding.kind === 'name-mismatch')!;
    expect(renamed).toMatchObject({ documentedField: 'netAmount', side: 'response', applicable: true, severity: 'warning' });
    expect(renamed.id).toBe('name-mismatch|POST|/api/orders/{id}/settle|response|net_amount');
    expect(findings.find((finding) => finding.kind === 'undocumented-endpoint')!.endpoint).toMatchObject({ method: 'GET', path: '/api/settlements', index: null });
    expect(summary).toMatchObject({ documentedEndpoints: 1, exercisedEndpoints: 1, undocumentedEndpoints: 1, observedApiCalls: 2, warnings: 3, errors: 0 });
    expect(coverage[0]).toMatchObject({ observed: 1, statuses: [201], response: { documented: 3, confirmed: 2, bodies: 1 } });
  });

  it('generalizes the path of an undocumented endpoint and groups its calls', () => {
    const a = tx({ method: 'GET', path: '/api/members/10/orders', response: body({ id: 1 }) });
    const b = tx({ method: 'GET', path: '/api/members/11/orders', response: body({ id: 2 }) });
    const findings = crossCheckBrowserEvidence(doc, [a, b]).findings.filter((item) => item.kind === 'undocumented-endpoint');
    const [finding] = findings;
    expect(findings).toHaveLength(1);
    expect(finding).toMatchObject({ kind: 'undocumented-endpoint', endpoint: { path: '/api/members/{id}/orders' } });
    expect(finding!.transactions).toEqual([`ev_1#${a.transactionId}`, `ev_1#${b.transactionId}`]);
  });

  it('reports a type that disagrees with the documented one, but not an unknown one', () => {
    const typed = spec([{ method: 'GET', path: '/api/orders', responseFields: [
      { nameEn: 'id', dataType: 'String' }, { nameEn: 'dto', dataType: 'OrderDto' }, { nameEn: 'flag', dataType: 'boolean' },
    ] }]);
    const call = tx({ method: 'GET', path: '/api/orders', response: body({ id: 1, dto: { a: 1 }, flag: true }) });
    const mismatches = crossCheckBrowserEvidence(typed, [call]).findings.filter((finding) => finding.kind === 'type-mismatch');
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toMatchObject({ field: 'id', documentedType: 'String', observedTypes: ['integer'], applicable: true });
  });

  it('does not call a null-valued field a type mismatch', () => {
    const typed = spec([{ method: 'GET', path: '/api/orders', responseFields: [{ nameEn: 'settledAt', dataType: 'String' }] }]);
    const call = tx({ method: 'GET', path: '/api/orders', response: body({ settledAt: null }) });
    expect(crossCheckBrowserEvidence(typed, [call]).findings).toEqual([]);
  });

  it('treats a documented parent as covering the child objects it lists', () => {
    const nested = spec([{ method: 'GET', path: '/api/orders', responseFields: [
      { nameEn: 'owner', dataType: 'Object' }, { nameEn: 'name', path: 'owner.name', parentPath: 'owner' },
    ] }]);
    const call = tx({ method: 'GET', path: '/api/orders', response: body({ owner: { name: 'kim' } }) });
    expect(crossCheckBrowserEvidence(nested, [call]).findings).toEqual([]);
  });

  it('summarizes observed error codes, once, and stays quiet when the note already has them', () => {
    const conflict = tx({ method: 'POST', path: '/api/orders/1002/settle', status: 409, response: body({ code: 'ALREADY_SETTLED' }) });
    const conflictAgain = tx({ method: 'POST', path: '/api/orders/1003/settle', status: 409, response: body({ code: 'ALREADY_SETTLED' }) });
    const pending = tx({ method: 'POST', path: '/api/orders/1004/settle', status: 409, response: body({ code: 'ORDER_NOT_PAID', status: 'PENDING' }) });
    const { findings } = crossCheckBrowserEvidence(doc, [settled, conflict, conflictAgain, pending]);
    const errors = findings.filter((finding) => finding.kind === 'undocumented-error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ severity: 'info', statuses: [409], details: ['409 code=ALREADY_SETTLED', '409 code=ORDER_NOT_PAID, status=PENDING'], applicable: true });
    const documented = spec([{ method: 'POST', path: '/api/orders/{id}/settle', note: '409 code=ALREADY_SETTLED; 409 code=ORDER_NOT_PAID, status=PENDING' }]);
    expect(crossCheckBrowserEvidence(documented, [conflict, conflictAgain, pending]).findings.filter((f) => f.kind === 'undocumented-error')).toEqual([]);
  });

  it('compares fields only on successful bodies, never on error bodies', () => {
    const conflict = tx({ method: 'POST', path: '/api/orders/1/settle', status: 409, response: body({ code: 'X', brandNewField: 1 }) });
    const kinds = crossCheckBrowserEvidence(doc, [conflict]).findings.map((finding) => finding.kind);
    expect(kinds).not.toContain('undocumented-field');
    expect(kinds).toContain('undocumented-error');
  });

  it('reports a failed request, an unavailable body and an unexercised endpoint', () => {
    const two = spec([{ method: 'GET', path: '/api/a' }, { method: 'GET', path: '/api/b' }]);
    const failed = tx({ method: 'GET', path: '/api/a', status: null, failure: 'net::ERR_CONNECTION_RESET' });
    const empty = tx({ method: 'GET', path: '/api/a', response: { state: 'unavailable', reason: 'body-size-limit', fields: [] } });
    const kinds = Object.fromEntries(crossCheckBrowserEvidence(two, [failed, empty]).findings.map((finding) => [finding.kind, finding]));
    expect(kinds['failed-request']).toMatchObject({ details: ['net::ERR_CONNECTION_RESET'], applicable: false });
    expect(kinds['body-unavailable']).toMatchObject({ severity: 'info', details: ['body-size-limit'], applicable: false });
    expect(kinds['unexercised-endpoint']).toMatchObject({ endpoint: { path: '/api/b', index: 1 }, applicable: false });
  });

  it('reports documented fields never seen as info, and a request field only when it is required', () => {
    const wide = spec([{ method: 'POST', path: '/api/orders', requestFields: [
      { nameEn: 'memberId', required: 'Y' }, { nameEn: 'memo', required: 'N' },
    ], responseFields: [{ nameEn: 'id' }, { nameEn: 'legacyFlag' }] }]);
    const call = tx({ method: 'POST', path: '/api/orders', status: 201, request: body({ other: 1 }), response: body({ id: 1 }) });
    const unobserved = crossCheckBrowserEvidence(wide, [call]).findings.filter((finding) => finding.kind === 'unobserved-field');
    expect(unobserved.map((finding) => `${finding.side}:${finding.field}`).sort()).toEqual(['request:memberId', 'response:legacyFlag']);
    expect(unobserved.every((finding) => finding.severity === 'info' && !finding.applicable)).toBe(true);
  });

  it('does not report a path parameter as an unsent request field', () => {
    const withParam = spec([{ method: 'POST', path: '/api/orders/{id}/settle', requestFields: [{ nameEn: 'id', required: 'Y' }] }]);
    const call = tx({ method: 'POST', path: '/api/orders/5/settle', status: 201, request: body({ note: 'x' }) });
    expect(crossCheckBrowserEvidence(withParam, [call]).findings.filter((f) => f.kind === 'unobserved-field')).toEqual([]);
  });

  it('flags a body whose hash no longer matches as an error and ignores its fields', () => {
    const broken = tx({ method: 'GET', path: '/api/orders', response: { state: 'integrity-failed', fields: [] } });
    const { findings, summary } = crossCheckBrowserEvidence(doc, [broken]);
    expect(findings[0]).toMatchObject({ kind: 'integrity-failed', severity: 'error', side: 'response', applicable: false });
    expect(summary.errors).toBe(1);
    // Errors sort first.
    expect(findings.map((finding) => finding.severity)[0]).toBe('error');
  });

  it('counts query parameters as observed request fields', () => {
    const search = spec([{ method: 'GET', path: '/api/orders', requestFields: [{ nameEn: 'status', required: 'N' }] }]);
    const call = tx({ method: 'GET', path: '/api/orders', queryNames: ['status', 'page'], response: body([{ id: 1 }]) });
    const { findings, coverage } = crossCheckBrowserEvidence(search, [call]);
    expect(findings.filter((finding) => finding.kind === 'undocumented-field' && finding.side === 'request').map((finding) => finding.field)).toEqual(['page']);
    expect(coverage[0]!.request).toMatchObject({ documented: 1, confirmed: 1 });
  });

  it('matches a spec path that omits the deployment prefix', () => {
    const prefixed = tx({ method: 'POST', path: '/app/api/orders/9/settle', status: 201, response: body({ settlement_id: 1, fee_amount: 1, netAmount: 1 }) });
    const { findings, summary } = crossCheckBrowserEvidence(doc, [prefixed]);
    expect(summary).toMatchObject({ exercisedEndpoints: 1, undocumentedEndpoints: 0 });
    expect(findings.filter((finding) => finding.kind === 'undocumented-endpoint')).toEqual([]);
  });
});

describe('applying findings', () => {
  const drifted = spec([{
    method: 'POST',
    path: '/api/orders/{id}/settle',
    note: 'Settles an order.',
    responseFields: [
      { nameEn: 'settlement_id', dataType: 'Integer' },
      { nameEn: 'net', dataType: 'String' },
      { nameEn: 'netAmount', dataType: 'Integer' },
    ],
  }]);
  const settle = tx({
    method: 'POST', path: '/api/orders/1001/settle', status: 201,
    response: body({ settlement_id: 7, net: 3, fee_amount: 30, net_amount: 970, owner: { name: 'kim' } }),
  });
  const conflict = tx({ method: 'POST', path: '/api/orders/1001/settle', status: 409, response: body({ code: 'ALREADY_SETTLED' }) });
  const list = tx({ method: 'GET', path: '/api/settlements', queryNames: ['page'], response: body({ items: [{ id: 1, total: 10 }] }) });
  const evidence = [settle, conflict, list];

  it('adds unreviewed rows with empty Korean labels, follows the wire names and keeps what it did not touch', () => {
    const { doc, changes } = applyBrowserEvidence(drifted, evidence);
    expect(changes).toMatchObject({ endpointsAdded: 1, fieldsRenamed: 1, typesChanged: 1, notesAdded: 1 });
    const settleEndpoint = doc.endpoints[0]!;
    // The renamed row keeps its position; added fields come after, a nested field after its parent.
    expect(settleEndpoint.responseFields.map((field) => field.nameEn)).toEqual(['settlement_id', 'net', 'net_amount', 'fee_amount', 'owner', 'name']);
    expect(settleEndpoint.responseFields.find((field) => field.nameEn === 'net')).toMatchObject({ dataType: 'Integer', reviewStatus: 'unreviewed' });
    const added = settleEndpoint.responseFields.find((field) => field.nameEn === 'fee_amount')!;
    expect(added).toMatchObject({ nameKo: '', dataType: 'Integer', required: 'TBD', reviewStatus: 'unreviewed', note: BROWSER_EVIDENCE_TEXT.ko.addedField });
    expect(added.evidenceRefs?.[0]).toMatchObject({ kind: 'browser', ref: 'evidence/capture.json', symbol: `ev_1#${settle.transactionId}` });
    expect(settleEndpoint.responseFields.find((field) => field.nameEn === 'name')).toMatchObject({ path: 'owner.name', parentPath: 'owner', depth: 1 });
    expect(settleEndpoint.note).toBe('Settles an order. 관찰된 오류 응답: 409 code=ALREADY_SETTLED');
    // The input document is never modified.
    expect(drifted.endpoints[0]!.responseFields).toHaveLength(3);
    expect(drifted.endpoints).toHaveLength(1);
  });

  it('drafts an endpoint for an undocumented call with its query parameter and fields', () => {
    const { doc } = applyBrowserEvidence(drifted, evidence);
    const added = doc.endpoints.find((endpoint) => endpoint.path === '/api/settlements')!;
    expect(added).toMatchObject({ method: 'GET', interfaceId: '', interfaceName: '', note: BROWSER_EVIDENCE_TEXT.ko.addedEndpoint });
    expect(added.requestFields.map((field) => [field.nameEn, field.note])).toEqual([['page', BROWSER_EVIDENCE_TEXT.ko.queryParameter]]);
    expect(added.responseFields.map((field) => field.nameEn)).toEqual(['items', 'id', 'total']);
    expect(added.responseFields.every((field) => field.nameKo === '' && field.reviewStatus === 'unreviewed')).toBe(true);
    expect(added.evidenceRefs?.[0]?.summary).toBe('GET /api/settlements → 200');
  });

  it('is idempotent, and a second check has no warnings left', () => {
    const first = applyBrowserEvidence(drifted, evidence);
    const second = applyBrowserEvidence(first.doc, evidence);
    expect(second.changes).toEqual({ endpointsAdded: 0, fieldsAdded: 0, fieldsRenamed: 0, typesChanged: 0, notesAdded: 0, evidenceAttached: 0, examplesAdded: 0 });
    expect(second.doc).toEqual(first.doc);
    const after = crossCheckBrowserEvidence(first.doc, evidence);
    expect(after.summary.warnings).toBe(0);
    expect(after.findings.filter((finding) => finding.applicable)).toEqual([]);
  });

  it('writes only the selected findings and nothing that is not applicable', () => {
    const { findings } = crossCheckBrowserEvidence(drifted, evidence);
    const onlyRename = findings.find((finding) => finding.kind === 'name-mismatch')!;
    const { doc, changes } = applyBrowserEvidence(drifted, evidence, { findingIds: [onlyRename.id], attachEvidence: false });
    expect(changes).toEqual({ endpointsAdded: 0, fieldsAdded: 0, fieldsRenamed: 1, typesChanged: 0, notesAdded: 0, evidenceAttached: 0, examplesAdded: 0 });
    expect(doc.endpoints).toHaveLength(1);
    expect(applyBrowserEvidence(drifted, evidence, { findingIds: [], attachEvidence: false }).doc).toEqual(drifted);
    // A finding that cannot be applied is ignored even when it is selected by ID.
    const unobservedOnly = tx({ method: 'GET', path: '/api/unused', response: { state: 'integrity-failed', fields: [] } });
    const integrity = crossCheckBrowserEvidence(drifted, [unobservedOnly]).findings[0]!;
    expect(integrity.applicable).toBe(false);
    expect(applyBrowserEvidence(drifted, [unobservedOnly], { findingIds: [integrity.id], attachEvidence: false }).doc).toEqual(drifted);
  });

  it('attaches browser evidence to exercised endpoints once, up to five references', () => {
    const calls = Array.from({ length: 7 }, (_, i) => tx({ method: 'POST', path: `/api/orders/${2000 + i}/settle`, status: 201, response: body({ settlement_id: i }) }));
    const first = applyBrowserEvidence(drifted, calls, { findingIds: [] });
    expect(first.changes.evidenceAttached).toBe(5);
    expect(first.doc.endpoints[0]!.evidenceRefs).toHaveLength(5);
    expect(applyBrowserEvidence(first.doc, calls, { findingIds: [] }).changes.evidenceAttached).toBe(0);
  });

  it('copies captured bodies into examples only when asked, as live-probe data', () => {
    const without = applyBrowserEvidence(drifted, evidence);
    expect(without.changes.examplesAdded).toBe(0);
    expect(without.doc.endpoints.every((endpoint) => endpoint.responseExample === undefined)).toBe(true);
    const withExamples = applyBrowserEvidence(drifted, evidence, { includeExamples: true });
    const added = withExamples.doc.endpoints.find((endpoint) => endpoint.path === '/api/settlements')!;
    expect(added.responseExample).toEqual({ items: [{ id: 1, total: 10 }] });
    expect(added.exampleSource).toBe('live-probe');
    expect(withExamples.doc.endpoints[0]!.responseExample).toMatchObject({ settlement_id: 7 });
    expect(withExamples.changes.examplesAdded).toBe(2);
  });

  it('writes the notes in English on request', () => {
    const { doc } = applyBrowserEvidence(drifted, evidence, { text: BROWSER_EVIDENCE_TEXT.en });
    expect(doc.endpoints[0]!.note).toBe('Settles an order. Observed error responses: 409 code=ALREADY_SETTLED');
    expect(doc.endpoints.find((endpoint) => endpoint.path === '/api/settlements')!.note).toBe(BROWSER_EVIDENCE_TEXT.en.addedEndpoint);
  });

  it('drafts a specification from evidence alone', () => {
    const blank = emptyBrowserEvidenceSpec('observed', 'http://localhost:4318', '2026-11-02T00:00:00.000Z');
    expect(blank).toMatchObject({ kind: 'interface-spec', endpoints: [], source: { collector: 'rea-browser', codebaseName: 'http://localhost:4318' } });
    const { doc, changes } = applyBrowserEvidence(blank, evidence);
    expect(changes.endpointsAdded).toBe(2);
    expect(doc.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`)).toEqual(['POST /api/orders/{id}/settle', 'GET /api/settlements']);
    expect(crossCheckBrowserEvidence(doc, evidence).summary.warnings).toBe(0);
  });
});
