import type { DocumentEvidence } from '../docs/evidence.js';
import type { InterfaceEndpoint, InterfaceFieldSpec, InterfaceSpecDocument } from '../docs/interface-spec.js';

/**
 * Browser evidence cross-check: what a recorded browser scenario (REA
 * `rea.browser-scenario-capture`) actually sent and received, compared with
 * what an interface specification says.
 *
 * The daemon decodes the evidence file (base64 bodies, SHA-256 check, JSON
 * parse) into {@link BrowserTransaction}s; everything here is pure, so the web
 * editor and the CLI apply the same rules. Observations follow REA's own
 * limits: a body that was not captured establishes nothing, and a field missing
 * from the captured samples is reported as "not observed", never as absent.
 */
export type ObservedJsonType = 'string' | 'integer' | 'number' | 'boolean' | 'null' | 'object' | 'array';

export interface ObservedField {
  /** Dot path with arrays transparent (`items.id`), the interface-spec `path` convention. */
  path: string;
  name: string;
  parentPath?: string;
  depth: number;
  types: ObservedJsonType[];
}

/** REA body states plus the checks the daemon adds while decoding. */
export type ObservedBodyState =
  | 'captured' | 'not_requested' | 'not_exposed' | 'unavailable' | 'missing'
  | 'not-json' | 'integrity-failed';

export interface ObservedBody {
  state: ObservedBodyState;
  mediaType?: string | null;
  sha256?: string;
  bytes?: number;
  redacted?: boolean;
  /** REA's reason when the body is unavailable (size limit, timeout...). */
  reason?: string;
  fields: ObservedField[];
  /** The parsed JSON when it is at most {@link BROWSER_EXAMPLE_MAX_BYTES}. */
  example?: unknown;
}

export const BROWSER_EXAMPLE_MAX_BYTES = 8 * 1024;

export interface BrowserTransaction {
  /** Project-relative path of the evidence file. */
  evidenceFile: string;
  evidenceId: string;
  transactionId: string;
  stepIndex: number;
  stepId?: string;
  method: string;
  origin: string | null;
  /** URL path without origin and query. */
  path: string;
  queryNames: string[];
  resourceType: string;
  status: number | null;
  failure?: string;
  request: ObservedBody;
  response: ObservedBody;
}

export interface BrowserEvidenceSource {
  file: string;
  evidenceId: string;
  origin: string | null;
  steps: number;
  completedSteps: number;
  transactions: number;
  apiTransactions: number;
  droppedEvents: number;
  completeness: { status: string; missingSections: string[]; truncatedSections: string[] };
  /** What the scenario asked REA to retain. */
  captured: { requestBodies: boolean; responseBodies: boolean };
  limitations: string[];
}

export type BrowserEvidenceFindingKind =
  | 'integrity-failed'
  | 'undocumented-endpoint'
  | 'undocumented-field'
  | 'name-mismatch'
  | 'type-mismatch'
  | 'failed-request'
  | 'undocumented-error'
  | 'unobserved-field'
  | 'body-unavailable'
  | 'unexercised-endpoint';

export type BrowserEvidenceSeverity = 'error' | 'warning' | 'info';

export interface BrowserEvidenceFinding {
  /** Stable for a document and evidence set; used to select findings to apply. */
  id: string;
  kind: BrowserEvidenceFindingKind;
  severity: BrowserEvidenceSeverity;
  /** `index` is the spec endpoint; null for an endpoint the spec does not have. */
  endpoint: { method: string; path: string; interfaceId: string; index: number | null };
  side?: 'request' | 'response';
  /** Observed field path, or the documented one for unobserved/name-mismatch. */
  field?: string;
  /** name-mismatch: the documented name the observed key most likely is. */
  documentedField?: string;
  observedTypes?: ObservedJsonType[];
  documentedType?: string;
  statuses: number[];
  /** Error codes seen in non-2xx bodies (`code=ALREADY_SETTLED`). */
  details?: string[];
  /** `${evidenceId}#${transactionId}` */
  transactions: string[];
  /** Whether {@link applyBrowserEvidence} can write this into the document. */
  applicable: boolean;
}

export interface BrowserEndpointCoverage {
  index: number;
  method: string;
  path: string;
  interfaceId: string;
  observed: number;
  statuses: number[];
  response: { documented: number; confirmed: number; bodies: number };
  request: { documented: number; confirmed: number; bodies: number };
}

export interface BrowserEvidenceSummary {
  documentedEndpoints: number;
  exercisedEndpoints: number;
  undocumentedEndpoints: number;
  observedApiCalls: number;
  confirmedFields: number;
  documentedFields: number;
  errors: number;
  warnings: number;
  info: number;
}

export interface BrowserEvidenceCrossCheckResponse {
  ok: true;
  inputFile: string;
  contentSha256: string;
  sources: BrowserEvidenceSource[];
  transactions: BrowserTransaction[];
  coverage: BrowserEndpointCoverage[];
  findings: BrowserEvidenceFinding[];
  summary: BrowserEvidenceSummary;
}

export interface BrowserEvidenceListEntry {
  file: string;
  size: number;
  mtime: number;
}

export interface BrowserEvidenceListResponse {
  files: BrowserEvidenceListEntry[];
}

export interface BrowserEvidenceCrossCheckRequest {
  /** Interface spec to compare. Omit to draft a new one from the evidence. */
  inputFile?: string;
  evidenceFiles: string[];
}

export interface BrowserEvidenceApplyRequest extends BrowserEvidenceCrossCheckRequest {
  /** Findings to write; omit for every applicable finding. */
  findingIds?: string[];
  attachEvidence?: boolean;
  /** Copy captured JSON bodies (≤ 8 KB) into examples. They are real application data. */
  includeExamples?: boolean;
  /** Write the result to `outputFile` (or `inputFile`); otherwise only return it. */
  write?: boolean;
  outputFile?: string;
  /** Required with `write` on an existing file: the content the caller reviewed. */
  baseContentSha256?: string;
  noteLanguage?: BrowserEvidenceNoteLanguage;
}

export interface BrowserEvidenceApplyChanges {
  endpointsAdded: number;
  fieldsAdded: number;
  fieldsRenamed: number;
  typesChanged: number;
  notesAdded: number;
  evidenceAttached: number;
  examplesAdded: number;
}

export interface BrowserEvidenceApplyResponse {
  ok: true;
  doc: InterfaceSpecDocument;
  changes: BrowserEvidenceApplyChanges;
  written?: { file: string; contentSha256: string };
}

/** Text written into the document. `errorResponses` contains `{lines}`. */
export interface BrowserEvidenceApplyText {
  addedField: string;
  addedEndpoint: string;
  queryParameter: string;
  errorResponses: string;
}

export type BrowserEvidenceNoteLanguage = 'ko' | 'en';

/** Interface specifications are Korean SI deliverables, so notes default to Korean. */
export const BROWSER_EVIDENCE_TEXT: Record<BrowserEvidenceNoteLanguage, BrowserEvidenceApplyText> = {
  ko: {
    addedField: '브라우저 실행 기록(REA)의 응답에서 관찰해 추가. 필수 여부·전체 스키마는 미확인.',
    addedEndpoint: '브라우저 실행 기록(REA)에서 관찰해 추가한 초안. 일반화한 경로와 업무 목적은 검토 필요.',
    queryParameter: '브라우저 실행 기록(REA)의 요청에서 관찰한 쿼리 파라미터.',
    errorResponses: '관찰된 오류 응답: {lines}',
  },
  en: {
    addedField: 'Added from a recorded browser response (REA); required flag and general schema not confirmed.',
    addedEndpoint: 'Added from a recorded browser scenario (REA); generalized path and purpose need review.',
    queryParameter: 'Query parameter observed in a recorded browser request (REA).',
    errorResponses: 'Observed error responses: {lines}',
  },
};

const MAX_FIELDS = 400;
const MAX_DEPTH = 6;

function jsonType(value: unknown): ObservedJsonType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return 'string';
  return 'object';
}

/** Field paths and types in a JSON body; array items are merged and arrays stay transparent in paths. */
export function observedFieldsFromJson(value: unknown): ObservedField[] {
  const fields = new Map<string, ObservedField>();
  const visit = (node: unknown, parent: string | undefined, depth: number) => {
    if (fields.size >= MAX_FIELDS || depth > MAX_DEPTH) return;
    if (Array.isArray(node)) { for (const item of node.slice(0, 50)) visit(item, parent, depth); return; }
    if (!node || typeof node !== 'object') return;
    for (const [name, child] of Object.entries(node as Record<string, unknown>)) {
      const path = parent ? `${parent}.${name}` : name;
      // The cap holds inside one wide object too, not only between objects.
      if (fields.size >= MAX_FIELDS && !fields.has(path)) return;
      const types = new Set(fields.get(path)?.types ?? []);
      types.add(jsonType(child));
      // An array of scalars is reported by its item type ("array" plus e.g. "string" is noise).
      fields.set(path, { path, name, ...(parent ? { parentPath: parent } : {}), depth, types: [...types].sort() });
      if (child && typeof child === 'object') visit(child, path, depth + 1);
    }
  };
  visit(value, undefined, 0);
  return [...fields.values()];
}

function mergeFields(lists: ObservedField[][]): ObservedField[] {
  const merged = new Map<string, ObservedField>();
  for (const field of lists.flat()) {
    const current = merged.get(field.path);
    merged.set(field.path, current ? { ...current, types: [...new Set([...current.types, ...field.types])].sort() } : field);
  }
  return [...merged.values()];
}

const PARAM_SEGMENT = /^(?:\{[^/{}]+\}|:[A-Za-z_][\w-]*|\[[^/[\]]+\]|<[^/<>]+>)$/;
const ID_SEGMENT = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|[0-9A-HJKMNP-TV-Z]{26})$/i;

function segments(path: string): string[] {
  return path.split('?')[0]!.split('/').filter(Boolean);
}

/** Generalize identifiers in an observed path (`/orders/1001/settle` → `/orders/{id}/settle`). */
export function generalizeObservedPath(path: string): string {
  let count = 0;
  const parts = segments(path).map((part) => {
    if (!ID_SEGMENT.test(part)) return part;
    count += 1;
    return count === 1 ? '{id}' : `{id${count}}`;
  });
  return `/${parts.join('/')}`;
}

/**
 * Whether an observed path matches a spec path template. A spec path may omit
 * a deployment prefix (`/app` + `/api/orders`), so the template may match the
 * observed path's tail on a segment boundary. Returns the number of literal
 * segments matched, or -1.
 */
export function matchSpecPath(template: string, observed: string): number {
  const spec = segments(template);
  const seen = segments(observed);
  if (spec.length > seen.length || (spec.length === 0 && seen.length !== 0)) return -1;
  const offset = seen.length - spec.length;
  let literal = 0;
  for (let i = 0; i < spec.length; i += 1) {
    const expected = spec[i]!;
    if (PARAM_SEGMENT.test(expected)) continue;
    if (decodeURIComponentSafe(expected) !== decodeURIComponentSafe(seen[i + offset]!)) return -1;
    literal += 1;
  }
  // A prefix match must keep at least one literal segment, or `/{id}` would match anything.
  if (offset > 0 && literal === 0) return -1;
  return literal * 2 + (offset === 0 ? 1 : 0);
}

function decodeURIComponentSafe(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

/** The spec endpoint an observed call belongs to: same method, best path match. */
export function findSpecEndpoint(doc: InterfaceSpecDocument, method: string, path: string): number | null {
  let best: { index: number; score: number } | null = null;
  doc.endpoints.forEach((endpoint, index) => {
    if (endpoint.method.toUpperCase() !== method.toUpperCase()) return;
    const score = matchSpecPath(endpoint.path, path);
    if (score >= 0 && (!best || score > best.score)) best = { index, score };
  });
  return (best as { index: number } | null)?.index ?? null;
}

type TypeFamily = 'string' | 'number' | 'boolean' | 'array' | 'object';

/** The JSON family a documented data type implies, or null when it cannot be told (`OrderDto`, `unknown`). */
export function dataTypeFamily(dataType: string): TypeFamily | null {
  const value = dataType.toLowerCase().replace(/\(.*?\)/g, '').trim();
  if (!value) return null;
  if (/\[\]$|^(?:list|array|set|collection|arraylist|iterable|page)\b/.test(value)) return 'array';
  if (/^(?:bool|boolean)$/.test(value)) return 'boolean';
  if (/^(?:int|integer|long|short|byte|bigint|biginteger|number|numeric|double|float|decimal|bigdecimal|int32|int64|float32|float64)$/.test(value)) return 'number';
  if (/^(?:string|str|text|char|character|varchar|varchar2|clob|date|datetime|localdate|localdatetime|localtime|time|timestamp|instant|zoneddatetime|offsetdatetime|uuid|email|url|uri)$/.test(value)) return 'string';
  if (/^(?:object|map|hashmap|json|jsonobject|record)\b/.test(value)) return 'object';
  return null;
}

function familyOf(type: ObservedJsonType): TypeFamily | null {
  if (type === 'integer' || type === 'number') return 'number';
  if (type === 'null') return null;
  return type;
}

/** The documented data type MonoField writes for an observed field. */
export function observedDataType(types: ObservedJsonType[]): string {
  const real = types.filter((type) => type !== 'null');
  if (real.length !== 1) return real.length === 0 ? 'unknown' : real.map((type) => observedDataType([type])).join(' | ');
  return { string: 'String', integer: 'Integer', number: 'Number', boolean: 'Boolean', object: 'Object', array: 'Array', null: 'unknown' }[real[0]!];
}

function fieldKey(field: InterfaceFieldSpec): string {
  return field.path ?? (field.parentPath ? `${field.parentPath}.${field.nameEn}` : field.nameEn);
}

function flatName(field: InterfaceFieldSpec): boolean {
  return !field.path && !field.parentPath;
}

const normalizedName = (name: string) => name.replace(/[_\-\s]/g, '').toLowerCase();

function pathParams(template: string): Set<string> {
  return new Set(segments(template).filter((part) => PARAM_SEGMENT.test(part)).map((part) => part.replace(/^[{:[<]|[}\]>]$/g, '')));
}

const transactionRef = (tx: BrowserTransaction) => `${tx.evidenceId}#${tx.transactionId}`;
const ok = (status: number | null) => status !== null && status >= 200 && status < 300;

/** The documented field an observed one matches: same path, or the same name on a flat (path-less) spec field. */
function documentedMatch(fields: InterfaceFieldSpec[], observed: ObservedField): InterfaceFieldSpec | undefined {
  return fields.find((field) => fieldKey(field) === observed.path)
    ?? fields.find((field) => flatName(field) && field.nameEn === observed.name);
}

function errorDetails(txs: BrowserTransaction[]): { statuses: number[]; lines: string[] } {
  const statuses = new Set<number>();
  const lines = new Set<string>();
  for (const tx of txs) {
    if (tx.status === null || ok(tx.status) || tx.status < 400) continue;
    statuses.add(tx.status);
    const example = tx.response.example;
    const codes = example && typeof example === 'object' && !Array.isArray(example)
      ? Object.entries(example as Record<string, unknown>)
        .filter(([key, value]) => /^(?:code|error|errorcode|error_code|status|reason)$/i.test(key) && (typeof value === 'string' || typeof value === 'number') && String(value).length <= 60)
        .map(([key, value]) => `${key}=${String(value)}`)
      : [];
    lines.add(`${tx.status}${codes.length ? ` ${codes.join(', ')}` : ''}`);
  }
  return { statuses: [...statuses].sort((a, b) => a - b), lines: [...lines].sort() };
}

/** API calls: fetch/XHR, or anything whose captured body is JSON. Documents, scripts and assets are not. */
export function isApiTransaction(tx: BrowserTransaction): boolean {
  if (tx.resourceType === 'fetch' || tx.resourceType === 'xhr') return true;
  const media = `${tx.response.mediaType ?? ''} ${tx.request.mediaType ?? ''}`.toLowerCase();
  return /json/.test(media) && !['document', 'script', 'stylesheet', 'image', 'font', 'media'].includes(tx.resourceType);
}

export function crossCheckBrowserEvidence(doc: InterfaceSpecDocument, transactions: BrowserTransaction[]): {
  coverage: BrowserEndpointCoverage[]; findings: BrowserEvidenceFinding[]; summary: BrowserEvidenceSummary;
} {
  const api = transactions.filter(isApiTransaction);
  const findings: BrowserEvidenceFinding[] = [];
  const byEndpoint = new Map<number, BrowserTransaction[]>();
  const unmatched = new Map<string, BrowserTransaction[]>();
  for (const tx of api) {
    const index = findSpecEndpoint(doc, tx.method, tx.path);
    if (index === null) {
      const key = `${tx.method.toUpperCase()} ${generalizeObservedPath(tx.path)}`;
      unmatched.set(key, [...(unmatched.get(key) ?? []), tx]);
    } else byEndpoint.set(index, [...(byEndpoint.get(index) ?? []), tx]);
  }
  const push = (finding: Omit<BrowserEvidenceFinding, 'id'>) => {
    const id = [finding.kind, finding.endpoint.method, finding.endpoint.path, finding.side ?? '', finding.field ?? ''].join('|');
    findings.push({ id, ...finding });
  };

  for (const tx of api) {
    for (const side of ['request', 'response'] as const) {
      if (tx[side].state !== 'integrity-failed') continue;
      push({ kind: 'integrity-failed', severity: 'error', endpoint: { method: tx.method, path: tx.path, interfaceId: '', index: null }, side,
        field: tx.transactionId, statuses: tx.status === null ? [] : [tx.status], transactions: [transactionRef(tx)], applicable: false });
    }
  }

  for (const [key, txs] of unmatched) {
    const [method, path] = [key.slice(0, key.indexOf(' ')), key.slice(key.indexOf(' ') + 1)];
    push({ kind: 'undocumented-endpoint', severity: 'warning', endpoint: { method, path, interfaceId: '', index: null },
      statuses: [...new Set(txs.map((tx) => tx.status).filter((s): s is number => s !== null))].sort((a, b) => a - b),
      transactions: txs.map(transactionRef), applicable: true });
  }

  const coverage: BrowserEndpointCoverage[] = [];
  let confirmedFields = 0;
  let documentedFields = 0;
  doc.endpoints.forEach((endpoint, index) => {
    const txs = byEndpoint.get(index) ?? [];
    const target = { method: endpoint.method, path: endpoint.path, interfaceId: endpoint.interfaceId, index };
    const statuses = [...new Set(txs.map((tx) => tx.status).filter((s): s is number => s !== null))].sort((a, b) => a - b);
    const okBodies = txs.filter((tx) => ok(tx.status) && tx.response.state === 'captured');
    const responseObserved = mergeFields(okBodies.map((tx) => tx.response.fields));
    const requestBodies = txs.filter((tx) => tx.request.state === 'captured');
    const params = pathParams(endpoint.path);
    const requestObserved = mergeFields([
      ...requestBodies.map((tx) => tx.request.fields),
      ...txs.map((tx) => tx.queryNames.map((name): ObservedField => ({ path: name, name, depth: 0, types: ['string'] }))),
    ]);
    const confirm = (fields: InterfaceFieldSpec[], observed: ObservedField[]) =>
      fields.filter((field) => observed.some((item) => documentedMatch([field], item))).length;
    const responseConfirmed = confirm(endpoint.responseFields, responseObserved);
    const requestConfirmed = confirm(endpoint.requestFields, requestObserved);
    documentedFields += endpoint.responseFields.length + endpoint.requestFields.length;
    confirmedFields += responseConfirmed + requestConfirmed;
    coverage.push({ index, method: endpoint.method, path: endpoint.path, interfaceId: endpoint.interfaceId, observed: txs.length, statuses,
      response: { documented: endpoint.responseFields.length, confirmed: responseConfirmed, bodies: okBodies.length },
      request: { documented: endpoint.requestFields.length, confirmed: requestConfirmed, bodies: requestBodies.length } });

    if (txs.length === 0) {
      push({ kind: 'unexercised-endpoint', severity: 'info', endpoint: target, statuses: [], transactions: [], applicable: false });
      return;
    }
    for (const tx of txs.filter((item) => item.failure)) {
      push({ kind: 'failed-request', severity: 'warning', endpoint: target, field: tx.transactionId, details: [tx.failure!], statuses: [],
        transactions: [transactionRef(tx)], applicable: false });
    }
    const errors = errorDetails(txs);
    if (errors.lines.length && !errors.lines.every((line) => endpoint.note.includes(line))) {
      push({ kind: 'undocumented-error', severity: 'info', endpoint: target, statuses: errors.statuses, details: errors.lines,
        transactions: txs.filter((tx) => tx.status !== null && tx.status >= 400).map(transactionRef), applicable: true });
    }
    if (okBodies.length === 0 && txs.some((tx) => ok(tx.status))) {
      const states = [...new Set(txs.filter((tx) => ok(tx.status)).map((tx) => tx.response.reason ?? tx.response.state))];
      push({ kind: 'body-unavailable', severity: 'info', endpoint: target, side: 'response', details: states, statuses,
        transactions: txs.filter((tx) => ok(tx.status)).map(transactionRef), applicable: false });
    }

    for (const side of ['response', 'request'] as const) {
      const documented = side === 'response' ? endpoint.responseFields : endpoint.requestFields;
      const observed = side === 'response' ? responseObserved : requestObserved;
      const sideTxs = side === 'response' ? okBodies : txs;
      if (side === 'response' ? okBodies.length === 0 : requestBodies.length === 0 && requestObserved.length === 0) continue;
      const sources = (path: string) => sideTxs.filter((tx) => (side === 'response' ? tx.response.fields : [...tx.request.fields,
        ...tx.queryNames.map((name) => ({ path: name }))]).some((field) => field.path === path)).map(transactionRef);
      const undocumented: ObservedField[] = [];
      for (const field of observed) {
        const match = documentedMatch(documented, field);
        if (match) {
          const family = dataTypeFamily(match.dataType);
          const families = new Set(field.types.map(familyOf).filter((f): f is TypeFamily => f !== null));
          if (family && families.size > 0 && !families.has(family)) {
            push({ kind: 'type-mismatch', severity: 'warning', endpoint: target, side, field: field.path, documentedField: fieldKey(match),
              observedTypes: field.types, documentedType: match.dataType, statuses, transactions: sources(field.path), applicable: true });
          }
          continue;
        }
        // A container whose children are documented is documented by them.
        const prefix = `${field.path}.`;
        if ((field.types.includes('object') || field.types.includes('array'))
          && documented.some((item) => fieldKey(item).startsWith(prefix) || observed.some((o) => o.path.startsWith(prefix) && documentedMatch(documented, o)))) continue;
        undocumented.push(field);
      }
      const unobserved = documented.filter((field) => !observed.some((item) => documentedMatch([field], item))
        && !(side === 'request' && (params.has(field.nameEn) || /path/i.test(field.dataType))));
      const paired = new Set<string>();
      for (const field of undocumented) {
        const twin = unobserved.find((item) => !paired.has(fieldKey(item)) && normalizedName(item.nameEn) === normalizedName(field.name)
          && (flatName(item) || (item.parentPath ?? '') === (field.parentPath ?? '')));
        if (twin) {
          paired.add(fieldKey(twin));
          push({ kind: 'name-mismatch', severity: 'warning', endpoint: target, side, field: field.path, documentedField: fieldKey(twin),
            observedTypes: field.types, documentedType: twin.dataType, statuses, transactions: sources(field.path), applicable: true });
        } else {
          push({ kind: 'undocumented-field', severity: 'warning', endpoint: target, side, field: field.path, observedTypes: field.types,
            statuses, transactions: sources(field.path), applicable: true });
        }
      }
      // A documented optional request field that was not sent is normal; only required ones are reported.
      for (const field of unobserved) {
        if (paired.has(fieldKey(field)) || (side === 'request' && field.required !== 'Y')) continue;
        push({ kind: 'unobserved-field', severity: 'info', endpoint: target, side, field: fieldKey(field), documentedType: field.dataType,
          statuses, transactions: sideTxs.map(transactionRef), applicable: false });
      }
    }
  });

  const order: Record<BrowserEvidenceSeverity, number> = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  const count = (severity: BrowserEvidenceSeverity) => findings.filter((f) => f.severity === severity).length;
  return {
    coverage,
    findings,
    summary: {
      documentedEndpoints: doc.endpoints.length,
      exercisedEndpoints: coverage.filter((c) => c.observed > 0).length,
      undocumentedEndpoints: unmatched.size,
      observedApiCalls: api.length,
      confirmedFields,
      documentedFields,
      errors: count('error'),
      warnings: count('warning'),
      info: count('info'),
    },
  };
}

function evidenceRef(tx: BrowserTransaction, side: 'request' | 'response' = 'response'): DocumentEvidence {
  const body = tx[side];
  return {
    kind: 'browser',
    ref: tx.evidenceFile,
    symbol: transactionRef(tx),
    ...(body.state === 'captured' && body.sha256 ? { sha256: body.sha256 } : {}),
    summary: `${tx.method.toUpperCase()} ${tx.path} → ${tx.status ?? tx.failure ?? 'no response'}${tx.stepId ? ` (step ${tx.stepId})` : ''}`,
  };
}

function addRefs(existing: DocumentEvidence[] | undefined, refs: DocumentEvidence[], limit = 5): { refs: DocumentEvidence[]; added: number } {
  const out = [...(existing ?? [])];
  let added = 0;
  for (const ref of refs) {
    if (out.filter((item) => item.kind === 'browser').length >= limit) break;
    if (out.some((item) => item.ref === ref.ref && item.symbol === ref.symbol)) continue;
    out.push(ref);
    added += 1;
  }
  return { refs: out, added };
}

function newField(field: ObservedField, txs: BrowserTransaction[], side: 'request' | 'response', note: string): InterfaceFieldSpec {
  const sources = txs.filter((tx) => tx[side].fields.some((item) => item.path === field.path) || (side === 'request' && tx.queryNames.includes(field.path)));
  return {
    nameEn: field.name,
    nameKo: '',
    dataType: observedDataType(field.types),
    required: 'TBD',
    minSize: '',
    maxSize: '',
    note,
    ...(field.depth > 0 ? { path: field.path, parentPath: field.parentPath } : {}),
    depth: field.depth,
    evidenceRefs: sources.slice(0, 3).map((tx) => evidenceRef(tx, side)),
    reviewStatus: 'unreviewed',
  };
}

/** Insert a field after its parent's last descendant so nested rows stay grouped. */
function insertField(fields: InterfaceFieldSpec[], field: InterfaceFieldSpec): InterfaceFieldSpec[] {
  if (!field.parentPath) return [...fields, field];
  let at = -1;
  fields.forEach((item, index) => {
    const key = fieldKey(item);
    if (key === field.parentPath || key.startsWith(`${field.parentPath}.`)) at = index;
  });
  return at < 0 ? [...fields, field] : [...fields.slice(0, at + 1), field, ...fields.slice(at + 1)];
}

/**
 * Write selected findings into a copy of the document: undocumented endpoints
 * and fields are added as unreviewed rows with empty Korean labels (so the
 * judgment check asks for them), names and types follow the wire, observed
 * error codes go to the endpoint note, and every exercised endpoint gets
 * browser evidence references. Nothing is removed.
 */
export function applyBrowserEvidence(doc: InterfaceSpecDocument, transactions: BrowserTransaction[], options: {
  findingIds?: string[]; attachEvidence?: boolean; includeExamples?: boolean; text?: BrowserEvidenceApplyText;
} = {}): { doc: InterfaceSpecDocument; changes: BrowserEvidenceApplyChanges } {
  const text = options.text ?? BROWSER_EVIDENCE_TEXT.ko;
  const errorNote = (lines: string[]) => text.errorResponses.replace('{lines}', lines.join('; '));
  const { findings } = crossCheckBrowserEvidence(doc, transactions);
  const selected = findings.filter((finding) => finding.applicable && (!options.findingIds || options.findingIds.includes(finding.id)));
  const next: InterfaceSpecDocument = JSON.parse(JSON.stringify(doc));
  const changes: BrowserEvidenceApplyChanges = { endpointsAdded: 0, fieldsAdded: 0, fieldsRenamed: 0, typesChanged: 0, notesAdded: 0, evidenceAttached: 0, examplesAdded: 0 };
  const api = transactions.filter(isApiTransaction);
  const txsOf = (finding: BrowserEvidenceFinding) => api.filter((tx) => finding.transactions.includes(transactionRef(tx)));
  const allTxsOf = (index: number) => api.filter((tx) => findSpecEndpoint(doc, tx.method, tx.path) === index);
  const example = (txs: BrowserTransaction[], side: 'request' | 'response') =>
    txs.find((tx) => (side === 'request' || ok(tx.status)) && tx[side].state === 'captured' && tx[side].example !== undefined)?.[side].example;

  for (const finding of selected) {
    const index = finding.endpoint.index;
    const endpoint = index === null ? undefined : next.endpoints[index];
    if (finding.kind === 'undocumented-endpoint') {
      const txs = txsOf(finding);
      const okTxs = txs.filter((tx) => ok(tx.status) && tx.response.state === 'captured');
      const response = mergeFields(okTxs.map((tx) => tx.response.fields));
      const request = mergeFields([...txs.filter((tx) => tx.request.state === 'captured').map((tx) => tx.request.fields),
        ...txs.map((tx) => tx.queryNames.map((name): ObservedField => ({ path: name, name, depth: 0, types: ['string'] })))]);
      const queryNames = new Set(txs.flatMap((tx) => tx.queryNames));
      const errors = errorDetails(txs);
      const added: InterfaceEndpoint = {
        method: finding.endpoint.method,
        path: finding.endpoint.path,
        interfaceId: '',
        interfaceName: '',
        businessCode: '', channel: '', owner: '',
        note: [text.addedEndpoint, ...(errors.lines.length ? [errorNote(errors.lines)] : [])].join(' '),
        moduleName: '', serviceName: '', handlerName: '', sourceFile: '',
        authRequired: false,
        requestFields: request.reduce((fields, field) => insertField(fields, newField(field, txs, 'request',
          queryNames.has(field.path) && field.depth === 0 ? text.queryParameter : text.addedField)), [] as InterfaceFieldSpec[]),
        responseFields: response.reduce((fields, field) => insertField(fields, newField(field, okTxs, 'response', text.addedField)), [] as InterfaceFieldSpec[]),
        evidenceRefs: txs.slice(0, 5).map((tx) => evidenceRef(tx)),
      };
      if (options.includeExamples) {
        const responseExample = example(txs, 'response');
        const requestExample = example(txs, 'request');
        if (responseExample !== undefined) added.responseExample = responseExample;
        if (requestExample !== undefined) added.requestExample = requestExample;
        if (responseExample !== undefined || requestExample !== undefined) { added.exampleSource = 'live-probe'; changes.examplesAdded += 1; }
      }
      next.endpoints.push(added);
      changes.endpointsAdded += 1;
      changes.fieldsAdded += added.requestFields.length + added.responseFields.length;
      continue;
    }
    if (!endpoint || index === null) continue;
    const key = finding.side === 'request' ? 'requestFields' : 'responseFields';
    if (finding.kind === 'undocumented-field' && finding.field) {
      const txs = txsOf(finding);
      const observed = mergeFields(txs.map((tx) => finding.side === 'request'
        ? [...tx.request.fields, ...tx.queryNames.map((name): ObservedField => ({ path: name, name, depth: 0, types: ['string'] }))]
        : tx.response.fields)).find((field) => field.path === finding.field);
      if (!observed || endpoint[key].some((field) => fieldKey(field) === observed.path)) continue;
      const isQuery = finding.side === 'request' && txs.some((tx) => tx.queryNames.includes(observed.path));
      endpoint[key] = insertField(endpoint[key], newField(observed, txs, finding.side ?? 'response', isQuery ? text.queryParameter : text.addedField));
      changes.fieldsAdded += 1;
    } else if (finding.kind === 'name-mismatch' && finding.field && finding.documentedField) {
      const field = endpoint[key].find((item) => fieldKey(item) === finding.documentedField);
      if (!field) continue;
      const leaf = finding.field.split('.').at(-1)!;
      field.nameEn = leaf;
      if (field.path) field.path = finding.field;
      field.reviewStatus = 'unreviewed';
      field.evidenceRefs = addRefs(field.evidenceRefs, txsOf(finding).slice(0, 3).map((tx) => evidenceRef(tx, finding.side))).refs;
      changes.fieldsRenamed += 1;
    } else if (finding.kind === 'type-mismatch' && finding.documentedField && finding.observedTypes) {
      const field = endpoint[key].find((item) => fieldKey(item) === finding.documentedField);
      if (!field) continue;
      field.dataType = observedDataType(finding.observedTypes);
      field.reviewStatus = 'unreviewed';
      field.evidenceRefs = addRefs(field.evidenceRefs, txsOf(finding).slice(0, 3).map((tx) => evidenceRef(tx, finding.side))).refs;
      changes.typesChanged += 1;
    } else if (finding.kind === 'undocumented-error' && finding.details?.length) {
      const missing = finding.details.filter((line) => !endpoint.note.includes(line));
      if (!missing.length) continue;
      endpoint.note = [endpoint.note, errorNote(missing)].filter(Boolean).join(' ');
      changes.notesAdded += 1;
    }
  }

  if (options.attachEvidence !== false) {
    doc.endpoints.forEach((_endpoint, index) => {
      const txs = allTxsOf(index);
      const target = next.endpoints[index];
      if (!txs.length || !target) return;
      const result = addRefs(target.evidenceRefs, txs.map((tx) => evidenceRef(tx)));
      if (result.added) { target.evidenceRefs = result.refs; changes.evidenceAttached += result.added; }
      if (options.includeExamples && target.responseExample === undefined) {
        const responseExample = example(txs, 'response');
        if (responseExample !== undefined && (!target.exampleSource || target.exampleSource === 'live-probe')) {
          target.responseExample = responseExample;
          target.exampleSource = 'live-probe';
          changes.examplesAdded += 1;
        }
      }
    });
  }
  return { doc: next, changes };
}

/** An empty document to draft an interface specification from browser evidence alone. */
export function emptyBrowserEvidenceSpec(name: string, origin: string | null, collectedAt: string): InterfaceSpecDocument {
  return {
    schemaVersion: 1,
    kind: 'interface-spec',
    cover: { brand: '', docName: name, version: '0.1', department: '' },
    source: { codebaseName: origin ?? name, codebasePath: '', language: '', framework: '', collector: 'rea-browser', mode: 'codebase', collectedAt },
    templatePreset: 'si-standard',
    auth: { type: 'undecided' },
    endpoints: [],
  };
}
