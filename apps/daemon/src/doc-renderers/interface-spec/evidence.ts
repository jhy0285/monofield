import type { InterfaceSpecDocument } from '@open-design/contracts';

export function interfaceEvidenceRows(doc: InterfaceSpecDocument): string[][] {
  const rows: string[][] = [];
  for (const endpoint of doc.endpoints) {
    const id = endpoint.interfaceId || `${endpoint.method} ${endpoint.path}`;
    for (const ref of endpoint.evidenceRefs ?? []) {
      rows.push([id, 'ENDPOINT', '', ref.kind, ref.ref, String(ref.line ?? ''), ref.revision ?? '', ref.sha256 ?? '', ref.summary ?? '', '', ref.symbol ?? '', ref.capturedAt ?? '']);
    }
    for (const [section, fields] of [['REQUEST', endpoint.requestFields], ['RESPONSE', endpoint.responseFields]] as const) {
      for (const field of fields) {
        if (field.evidence) rows.push([id, section, field.path || field.nameEn, 'context', '', '', '', '', field.evidence, field.reviewStatus ?? 'unreviewed', '', '']);
        for (const ref of field.evidenceRefs ?? []) {
          rows.push([id, section, field.path || field.nameEn, ref.kind, ref.ref, String(ref.line ?? ''), ref.revision ?? '', ref.sha256 ?? '', ref.summary ?? '', field.reviewStatus ?? 'unreviewed', ref.symbol ?? '', ref.capturedAt ?? '']);
        }
      }
    }
  }
  return rows;
}
