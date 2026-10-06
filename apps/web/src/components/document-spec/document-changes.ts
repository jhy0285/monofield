import type { InterfaceSpecDocument } from '@open-design/contracts';

export interface DocumentChange {
  target: string;
  before: string;
  after: string;
}

/** Stable endpoint/field identities keep a reordering from hiding substantive changes. */
export function compareInterfaceDocuments(before: InterfaceSpecDocument, after: InterfaceSpecDocument): DocumentChange[] {
  function rows(doc: InterfaceSpecDocument): Map<string, string> {
    const output = new Map<string, string>();
    function flatten(value: unknown, label: string): void {
      if (value === undefined) return;
      if (value !== null && typeof value === 'object' && Object.keys(value).length) {
        for (const [key, item] of Object.entries(value)) flatten(item, `${label} / ${key}`);
      } else output.set(label, typeof value === 'string' ? value : JSON.stringify(value));
    }
    const { endpoints, ...metadata } = doc;
    flatten(metadata, 'DOCUMENT');
    for (const endpoint of endpoints) {
      const id = endpoint.interfaceId || `${endpoint.method} ${endpoint.path}`;
      const { requestFields, responseFields, ...endpointMetadata } = endpoint;
      flatten(endpointMetadata, id);
      for (const [section, fields] of [['REQUEST', requestFields], ['RESPONSE', responseFields]] as const) {
        const totals = new Map<string, number>();
        const occurrences = new Map<string, number>();
        for (const field of fields) {
          const key = field.path || field.nameEn;
          totals.set(key, (totals.get(key) ?? 0) + 1);
        }
        for (const field of fields) {
          const key = field.path || field.nameEn;
          const occurrence = (occurrences.get(key) ?? 0) + 1;
          occurrences.set(key, occurrence);
          const label = (totals.get(key) ?? 0) > 1 ? `${key} [${occurrence}]` : key;
          flatten(field, `${id} / ${section} / ${label}`);
        }
      }
    }
    return output;
  }
  const previous = rows(before);
  const proposed = rows(after);
  return [...new Set([...previous.keys(), ...proposed.keys()])].flatMap((target) => {
    const left = previous.get(target);
    const right = proposed.get(target);
    return left === right ? [] : [{ target, before: left ?? '—', after: right ?? '—' }];
  });
}
