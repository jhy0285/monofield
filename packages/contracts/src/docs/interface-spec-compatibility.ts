import type { InterfaceEndpoint, InterfaceFieldSpec, InterfaceSpecDocument } from './interface-spec.js';

/**
 * Client compatibility of an interface-spec revision, in the spirit of
 * OpenAPI diff tools: `breaking` changes can break an existing caller,
 * `warning` changes might (and need a human decision), `info` changes are
 * additive. The comparison is structural and deterministic; it never calls
 * a model and never reads source code.
 */
export type InterfaceSpecChangeLevel = 'breaking' | 'warning' | 'info';

export type InterfaceSpecChangeCode =
  | 'endpoint-removed'
  | 'endpoint-added'
  | 'auth-required-added'
  | 'auth-required-removed'
  | 'request-field-added-required'
  | 'request-field-added-unresolved'
  | 'request-field-added-optional'
  | 'request-field-removed'
  | 'request-field-became-required'
  | 'request-field-became-optional'
  | 'request-field-max-size-reduced'
  | 'response-field-removed'
  | 'response-field-added'
  | 'response-field-became-optional'
  | 'field-type-changed';

export interface InterfaceSpecCompatibilityChange {
  level: InterfaceSpecChangeLevel;
  code: InterfaceSpecChangeCode;
  /** `METHOD /path` of the revised document (or the original when removed). */
  route: string;
  interfaceId: string;
  location?: 'request' | 'response';
  /** Field dot path (`path`, falling back to `nameEn`). */
  field?: string;
  before?: string;
  after?: string;
}

export interface InterfaceSpecCompatibilityReport {
  /** Highest level among the changes, or `none` when nothing client-visible changed. */
  level: InterfaceSpecChangeLevel | 'none';
  counts: Record<InterfaceSpecChangeLevel, number>;
  changes: InterfaceSpecCompatibilityChange[];
}

const LEVEL_ORDER: Record<InterfaceSpecChangeLevel, number> = { info: 0, warning: 1, breaking: 2 };

/** Path parameters match by position, so `{id}` → `{orderId}` is a rename, not remove + add. */
function routeKey(endpoint: Pick<InterfaceEndpoint, 'method' | 'path'>): string {
  const path = endpoint.path.trim().replace(/\{[^}/]*\}|:[A-Za-z_][\w-]*/g, '{}').replace(/\/+$/, '') || '/';
  return `${endpoint.method.trim().toUpperCase()} ${path}`;
}

function route(endpoint: Pick<InterfaceEndpoint, 'method' | 'path'>): string {
  return `${endpoint.method.trim().toUpperCase()} ${endpoint.path.trim()}`;
}

function fieldKey(field: InterfaceFieldSpec): string {
  return (field.path ?? field.nameEn).trim();
}

function normalizedType(type: string): string {
  return type.replace(/\s+/g, '').toLowerCase();
}

function numericSize(value: string): number | null {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

function compareFields(
  location: 'request' | 'response',
  before: InterfaceFieldSpec[],
  after: InterfaceFieldSpec[],
  base: Pick<InterfaceSpecCompatibilityChange, 'route' | 'interfaceId'>,
  push: (change: InterfaceSpecCompatibilityChange) => void,
): void {
  const previous = new Map(before.map((field) => [fieldKey(field), field]));
  const next = new Map(after.map((field) => [fieldKey(field), field]));
  for (const key of previous.keys()) {
    if (next.has(key)) continue;
    push({ ...base, location, field: key, level: location === 'response' ? 'breaking' : 'warning',
      code: location === 'response' ? 'response-field-removed' : 'request-field-removed' });
  }
  for (const [key, field] of next) {
    const old = previous.get(key);
    if (!old) {
      if (location === 'response') {
        push({ ...base, location, field: key, level: 'info', code: 'response-field-added' });
      } else if (field.required === 'Y') {
        push({ ...base, location, field: key, level: 'breaking', code: 'request-field-added-required' });
      } else if (field.required === 'TBD') {
        push({ ...base, location, field: key, level: 'warning', code: 'request-field-added-unresolved' });
      } else {
        push({ ...base, location, field: key, level: 'info', code: 'request-field-added-optional' });
      }
      continue;
    }
    if (normalizedType(old.dataType) !== normalizedType(field.dataType)) {
      push({ ...base, location, field: key, level: 'breaking', code: 'field-type-changed', before: old.dataType, after: field.dataType });
    }
    if (old.required !== field.required) {
      if (location === 'request' && field.required === 'Y') {
        push({ ...base, location, field: key, level: 'breaking', code: 'request-field-became-required', before: old.required, after: field.required });
      } else if (location === 'request' && old.required === 'Y') {
        push({ ...base, location, field: key, level: 'info', code: 'request-field-became-optional', before: old.required, after: field.required });
      } else if (location === 'response' && old.required === 'Y') {
        push({ ...base, location, field: key, level: 'warning', code: 'response-field-became-optional', before: old.required, after: field.required });
      }
    }
    if (location === 'request') {
      const oldMax = numericSize(old.maxSize);
      const newMax = numericSize(field.maxSize);
      if (oldMax !== null && newMax !== null && newMax < oldMax) {
        push({ ...base, location, field: key, level: 'breaking', code: 'request-field-max-size-reduced', before: old.maxSize, after: field.maxSize });
      }
    }
  }
}

/** Compares two revisions of the same interface spec from a caller's point of view. */
export function compareInterfaceSpecDocuments(
  before: InterfaceSpecDocument,
  after: InterfaceSpecDocument,
): InterfaceSpecCompatibilityReport {
  const changes: InterfaceSpecCompatibilityChange[] = [];
  const push = (change: InterfaceSpecCompatibilityChange) => { changes.push(change); };
  const previous = new Map(before.endpoints.map((endpoint) => [routeKey(endpoint), endpoint]));
  const next = new Map(after.endpoints.map((endpoint) => [routeKey(endpoint), endpoint]));

  for (const [key, endpoint] of previous) {
    if (!next.has(key)) push({ level: 'breaking', code: 'endpoint-removed', route: route(endpoint), interfaceId: endpoint.interfaceId });
  }
  for (const [key, endpoint] of next) {
    const old = previous.get(key);
    const base = { route: route(endpoint), interfaceId: endpoint.interfaceId || old?.interfaceId || '' };
    if (!old) {
      push({ ...base, level: 'info', code: 'endpoint-added' });
      continue;
    }
    if (!old.authRequired && endpoint.authRequired) push({ ...base, level: 'breaking', code: 'auth-required-added' });
    if (old.authRequired && !endpoint.authRequired) push({ ...base, level: 'warning', code: 'auth-required-removed' });
    compareFields('request', old.requestFields, endpoint.requestFields, base, push);
    compareFields('response', old.responseFields, endpoint.responseFields, base, push);
  }

  const counts: Record<InterfaceSpecChangeLevel, number> = { breaking: 0, warning: 0, info: 0 };
  for (const change of changes) counts[change.level] += 1;
  changes.sort((a, b) => LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level]);
  const level = counts.breaking ? 'breaking' : counts.warning ? 'warning' : counts.info ? 'info' : 'none';
  return { level, counts, changes };
}
