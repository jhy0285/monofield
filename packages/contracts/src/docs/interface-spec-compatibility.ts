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
  | 'auth-authorities-narrowed'
  | 'auth-authorities-widened'
  | 'auth-rule-changed'
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
  | 'request-enum-value-added'
  | 'request-enum-value-removed'
  | 'response-enum-value-added'
  | 'response-enum-value-removed'
  | 'request-default-changed'
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
  /** Value before and after the change; `undefined` when the field, default or rule did not exist on that side. */
  before?: string | undefined;
  after?: string | undefined;
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

/** Java primitives and their boxed types carry the same value on the wire (`int` and `Integer` are one number). */
const BOXED_TYPES: Record<string, string> = {
  int: 'integer', long: 'long', short: 'short', byte: 'byte', double: 'double', float: 'float', boolean: 'boolean', char: 'character',
};

function normalizedType(type: string): string {
  return type.replace(/\s+/g, '').toLowerCase().replace(/\b(int|long|short|byte|double|float|boolean|char)\b/g, (name) => BOXED_TYPES[name] ?? name);
}

function joined(values: Iterable<string>): string | undefined {
  const list = [...values];
  return list.length ? list.join(', ') : undefined;
}

/**
 * Enum values are compared only when both revisions recorded them: an older scan that recorded none is not a change.
 * A caller sends request values and reads response values, so the same edit weighs differently on each side:
 * a removed request value is rejected from then on (breaking), an added response value can reach a client that
 * handles every known value (warning), and the other two only widen or narrow what the caller may meet (info).
 */
function compareEnumValues(
  location: 'request' | 'response',
  key: string,
  before: InterfaceFieldSpec,
  after: InterfaceFieldSpec,
  base: Pick<InterfaceSpecCompatibilityChange, 'route' | 'interfaceId'>,
  push: (change: InterfaceSpecCompatibilityChange) => void,
): void {
  if (!before.enumValues || !after.enumValues) return;
  const previous = new Set(before.enumValues);
  const next = new Set(after.enumValues);
  const added = joined(after.enumValues.filter((value) => !previous.has(value)));
  const removed = joined(before.enumValues.filter((value) => !next.has(value)));
  if (added) {
    push({ ...base, location, field: key, level: location === 'response' ? 'warning' : 'info',
      code: location === 'response' ? 'response-enum-value-added' : 'request-enum-value-added', after: added });
  }
  if (removed) {
    push({ ...base, location, field: key, level: location === 'request' ? 'breaking' : 'info',
      code: location === 'request' ? 'request-enum-value-removed' : 'response-enum-value-removed', before: removed });
  }
}

/**
 * Who may call an endpoint, from a caller's side. `authorities` lists alternatives (any one grants access), so the
 * change narrows access when a caller holding a previously sufficient authority, or any authenticated caller when
 * none was listed, is now refused; it widens access otherwise. Compared only when `authRequired` did not change,
 * because that change is already reported. A rule kept as text is compared as text and needs a decision.
 */
function compareAccess(
  before: InterfaceEndpoint,
  after: InterfaceEndpoint,
  base: Pick<InterfaceSpecCompatibilityChange, 'route' | 'interfaceId'>,
  push: (change: InterfaceSpecCompatibilityChange) => void,
): void {
  if (before.authRequired !== after.authRequired) return;
  const previous = new Set(before.authorities ?? []);
  const next = new Set(after.authorities ?? []);
  const changed = previous.size !== next.size || [...previous].some((authority) => !next.has(authority));
  if (changed) {
    const lost = [...previous].some((authority) => !next.has(authority));
    const narrowed = next.size > 0 && (previous.size === 0 || lost);
    push({ ...base, level: narrowed ? 'breaking' : 'info', code: narrowed ? 'auth-authorities-narrowed' : 'auth-authorities-widened',
      before: joined(previous), after: joined(next) });
  }
  const rule = (value?: string) => value?.replace(/\s+/g, ' ').trim() || undefined;
  if (rule(before.accessRule) !== rule(after.accessRule)) {
    push({ ...base, level: 'warning', code: 'auth-rule-changed', before: rule(before.accessRule), after: rule(after.accessRule) });
  }
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
    compareEnumValues(location, key, old, field, base, push);
    if (location === 'request' && (old.defaultValue ?? undefined) !== (field.defaultValue ?? undefined)) {
      // A caller that omits the field gets a different value (or none) from now on; a new default only fills a gap.
      push({ ...base, location, field: key, level: old.defaultValue === undefined ? 'info' : 'warning',
        code: 'request-default-changed', before: old.defaultValue, after: field.defaultValue });
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
    compareAccess(old, endpoint, base, push);
    compareFields('request', old.requestFields, endpoint.requestFields, base, push);
    compareFields('response', old.responseFields, endpoint.responseFields, base, push);
  }

  const counts: Record<InterfaceSpecChangeLevel, number> = { breaking: 0, warning: 0, info: 0 };
  for (const change of changes) counts[change.level] += 1;
  changes.sort((a, b) => LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level]);
  const level = counts.breaking ? 'breaking' : counts.warning ? 'warning' : counts.info ? 'info' : 'none';
  return { level, counts, changes };
}
