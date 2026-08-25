import type { InterfaceEndpoint, InterfaceSpecDocument } from '@open-design/contracts';
import { validateInterfaceSpecDocument } from '@open-design/contracts';
import {
  COVER_SHEET_LAYOUT,
  DETAIL_FIELD_HEADERS,
  DETAIL_SHEET_LAYOUT,
  LIST_SHEET_LAYOUT,
} from './preset-data.js';
import {
  buildRequestExample,
  buildResponseExample,
  deriveDomain,
  endpointApiKey,
  hierarchicalNumbers,
  resolveAuthRow,
  resolveInterfaceName,
  seedDomainCounters,
} from './render-xlsx.js';

/**
 * HTML preview of an interface-spec document — a live, in-panel rendering that
 * mirrors what the XLSX workbook will contain, so users see "the Excel will
 * look like this" while configuring options instead of only after export.
 *
 * Content parity with render-xlsx is guaranteed by sharing its pure helpers
 * (interface-name resolution, id assignment, auth row, field numbering,
 * sample payloads). Only the presentation differs: HTML tables vs. xlsx cells.
 */

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface DetailModel {
  interfaceId: string;
  interfaceName: string;
  apiKey: string;
  requestRows: Array<{ no: number | string; nameEn: string; nameKo: string; dataType: string; minSize: string; maxSize: string; required: string; note: string }>;
  responseRows: Array<{ no: number | string; nameEn: string; nameKo: string; dataType: string; minSize: string; maxSize: string; required: string; note: string }>;
  requestSample: string;
  responseSample: string;
}

/** Resolve every endpoint the same way render-xlsx does (sort, ids, rows). */
function computeModel(doc: InterfaceSpecDocument): DetailModel[] {
  const domainCounters = seedDomainCounters(doc.endpoints);
  const sorted = [...doc.endpoints].sort((a, b) => {
    if (a.method !== b.method) return a.method < b.method ? -1 : 1;
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    return 0;
  });

  return sorted.map((ep) => {
    let interfaceId: string;
    if (ep.interfaceId.trim()) {
      interfaceId = ep.interfaceId.trim().toUpperCase();
    } else {
      const domain = deriveDomain(ep.path);
      const next = (domainCounters.get(domain) ?? 0) + 1;
      domainCounters.set(domain, next);
      interfaceId = `${domain}-${String(next).padStart(3, '0')}`;
    }

    const authRow = resolveAuthRow(ep, doc.auth);
    const requestRows: DetailModel['requestRows'] = [];
    if (authRow) {
      requestRows.push({ no: 1, nameEn: authRow.nameEn, nameKo: authRow.nameKo, dataType: authRow.dataType, minSize: '', maxSize: '', required: 'Y', note: authRow.note });
    }
    const reqNos = hierarchicalNumbers(ep.requestFields, { startRootNo: authRow ? 2 : 1 });
    ep.requestFields.forEach((f, i) => {
      requestRows.push({ no: reqNos[i]!, nameEn: f.nameEn, nameKo: f.nameKo, dataType: f.dataType, minSize: f.minSize, maxSize: f.maxSize, required: f.required, note: f.note });
    });

    const responseRows: DetailModel['responseRows'] = [];
    DETAIL_SHEET_LAYOUT.responseSection.baseFields.forEach((base, idx) => {
      responseRows.push({ no: idx + 1, nameEn: base.nameEn, nameKo: base.nameKo, dataType: base.dataType ?? (ep.responseType || 'Object'), minSize: '', maxSize: '', required: base.required, note: base.note });
    });
    const respNos = hierarchicalNumbers(ep.responseFields, { topLevelParentNo: DETAIL_SHEET_LAYOUT.responseSection.topLevelParentNo });
    ep.responseFields.forEach((f, i) => {
      responseRows.push({ no: respNos[i]!, nameEn: f.nameEn, nameKo: f.nameKo, dataType: f.dataType, minSize: f.minSize, maxSize: f.maxSize, required: f.required, note: f.note });
    });

    return {
      interfaceId,
      interfaceName: resolveInterfaceName(ep),
      apiKey: endpointApiKey(ep),
      requestRows,
      responseRows,
      requestSample: JSON.stringify(buildRequestExample(ep, authRow), null, 2),
      responseSample: JSON.stringify(buildResponseExample(ep), null, 2),
    };
  });
}

function fieldTableRows(
  rows: DetailModel['requestRows'],
  endpointIndex: number,
  section: 'request' | 'response',
): string {
  if (rows.length === 0) return `<tr><td colspan="8" class="empty">(필드 없음)</td></tr>`;
  return rows
    .map(
      (r, rowIndex) => `<tr data-od-id="interface-spec-${endpointIndex}-${section}-field-${rowIndex}" data-screen-label="${esc(`${section.toUpperCase()} ${r.nameEn}`)}">
      <td class="num">${esc(r.no)}</td>
      <td>${esc(r.nameEn)}</td>
      <td>${esc(r.nameKo)}</td>
      <td>${esc(r.dataType)}</td>
      <td>${esc(r.minSize)}</td>
      <td>${esc(r.maxSize)}</td>
      <td class="ctr">${esc(r.required)}</td>
      <td>${esc(r.note)}</td>
    </tr>`,
    )
    .join('\n');
}

function detailSection(d: DetailModel, index: number): string {
  const headerCells = DETAIL_FIELD_HEADERS.map((h) => `<th>${esc(h)}</th>`).join('');
  return `<section class="detail" id="if-${index}" data-od-id="interface-spec-${index}" data-screen-label="${esc(`${d.interfaceName} ${d.interfaceId}`)}">
    <h3>${esc(d.interfaceName)} <span class="id">${esc(d.interfaceId)}</span></h3>
    <table class="meta">
      <tr><th>인터페이스 ID</th><td>${esc(d.interfaceId)}</td><th>인터페이스 설명</th><td>${esc(d.interfaceName)}</td></tr>
      <tr><th>인터페이스 URL</th><td colspan="3">${esc(d.apiKey)}</td></tr>
    </table>
    <div class="sec-title">REQUEST</div>
    <table class="fields"><thead><tr>${headerCells}</tr></thead><tbody>${fieldTableRows(d.requestRows, index, 'request')}</tbody></table>
    <div class="sec-title">Response</div>
    <table class="fields"><thead><tr>${headerCells}</tr></thead><tbody>${fieldTableRows(d.responseRows, index, 'response')}</tbody></table>
    <div class="samples">
      <div><div class="sample-title">${esc(DETAIL_SHEET_LAYOUT.sampleBlocks.requestTitle)}</div><pre>${esc(d.requestSample)}</pre></div>
      <div><div class="sample-title">${esc(DETAIL_SHEET_LAYOUT.sampleBlocks.responseTitle)}</div><pre>${esc(d.responseSample)}</pre></div>
    </div>
  </section>`;
}

function listSection(models: DetailModel[]): string {
  const headers = LIST_SHEET_LAYOUT.headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const rows = models
    .map(
      (d, i) => `<tr data-od-id="interface-spec-list-${i}" data-screen-label="${esc(`${d.interfaceName} ${d.interfaceId}`)}">
      <td class="num">${i + 1}</td>
      <td></td>
      <td>${esc(d.interfaceId)}</td>
      <td><a href="#if-${i}">${esc(d.interfaceName)}</a></td>
      <td></td>
      <td><a href="#if-${i}">${esc(d.apiKey)}</a></td>
      <td></td><td></td><td></td><td></td><td></td>
    </tr>`,
    )
    .join('\n');
  return `<section class="list">
    <h2>${esc(LIST_SHEET_LAYOUT.title)}</h2>
    <table class="fields"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>
  </section>`;
}

export function renderInterfaceSpecHtml(doc: InterfaceSpecDocument): string {
  // Preview never blocks on validation, but surface fatal issues as a banner.
  const issues = validateInterfaceSpecDocument(doc);
  const fatal = issues.filter((i) => i.severity === 'fatal');
  const banner = fatal.length
    ? `<div class="banner">⚠ ${esc(fatal.length)}건의 치명적 문제 — export 전 수정 필요: ${esc(fatal.map((i) => i.message).join(' / '))}</div>`
    : '';

  const cover = doc.cover;
  const models = computeModel(doc);
  const palette = {
    'si-standard': { accent: '#294766', section: '#daeef3', list: '#ccffcc', border: '#d9dee8', page: '#faf9f7' },
    compact: { accent: '#334155', section: '#e2e8f0', list: '#e2e8f0', border: '#cbd5e1', page: '#ffffff' },
    review: { accent: '#8a5d00', section: '#fff2cc', list: '#ffe699', border: '#e0b84f', page: '#fffdf7' },
  }[doc.templatePreset];

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>${esc(cover.docName || COVER_SHEET_LAYOUT.docTypeText)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: "Malgun Gothic", system-ui, sans-serif; margin: 0; padding: 24px; background: ${palette.page}; color: #1a1916; }
  .banner { background: #fdecea; border: 1px solid #f5c6c2; color: #9c2a25; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; font-size: 13px; }
  .cover { text-align: center; padding: 24px 0 8px; }
  .cover .doc-type { font-size: 28px; font-weight: 700; }
  .cover .doc-name { font-size: 18px; margin-top: 6px; }
  .cover .meta { font-size: 13px; color: #74716b; margin-top: 10px; }
  h2 { font-size: 18px; border-bottom: 2px solid ${palette.accent}; padding-bottom: 6px; margin-top: 32px; }
  h3 { font-size: 15px; margin: 28px 0 8px; }
  h3 .id { color: #b45a3b; font-weight: 600; font-size: 13px; margin-left: 8px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; margin: 6px 0 4px; }
  th, td { border: 1px solid ${palette.border}; padding: 4px 8px; text-align: left; vertical-align: top; }
  thead th, table.fields thead th { background: ${palette.section}; font-weight: 700; text-align: center; }
  .list table.fields thead th { background: ${palette.list}; }
  table.meta th { background: ${palette.section}; width: 120px; white-space: nowrap; }
  .num, .ctr { text-align: center; }
  .sec-title { background: ${palette.section}; font-weight: 700; text-align: center; padding: 4px; border: 1px solid ${palette.border}; border-bottom: none; margin-top: 14px; }
  .empty { text-align: center; color: #989590; }
  .samples { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
  .sample-title { font-weight: 700; font-size: 12px; margin-bottom: 4px; }
  pre { background: #f4f5f7; border: 1px solid #e1e5eb; border-radius: 4px; padding: 8px; font-size: 11px; overflow: auto; margin: 0; }
  .detail { border-top: 1px dashed #c9d0da; padding-top: 8px; }
  a { color: #2348b8; }
</style></head><body data-open-docs-kind="interface-spec">
${banner}
<div class="cover">
  <div class="doc-type">${esc(COVER_SHEET_LAYOUT.docTypeText)}</div>
  <div class="doc-name">${esc(cover.docName || '')}</div>
  <div class="meta">
    ${esc(cover.brand || COVER_SHEET_LAYOUT.defaultBrandText)}
    ${cover.version ? ` · v${esc(cover.version)}` : ''}
    ${cover.department ? ` · ${esc(COVER_SHEET_LAYOUT.departmentPrefix)}${esc(cover.department)}` : ''}
  </div>
</div>
${listSection(models)}
${models.map((d, i) => detailSection(d, i)).join('\n')}
</body></html>`;
}
