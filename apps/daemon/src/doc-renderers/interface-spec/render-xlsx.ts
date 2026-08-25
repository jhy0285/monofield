import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type {
  InterfaceAuthScheme,
  InterfaceEndpoint,
  InterfaceFieldSpec,
  InterfaceSpecDocument,
} from '@open-design/contracts';
import { validateInterfaceSpecDocument } from '@open-design/contracts';
import {
  ACTION_PREFIXES,
  COVER_SHEET_LAYOUT,
  COVER_SHEET_STYLE,
  DETAIL_FIELD_HEADERS,
  DETAIL_SHEET_LAYOUT,
  DETAIL_SHEET_STYLE,
  GENERATED_LIST_SHEET_TITLE,
  LIST_SHEET_LAYOUT,
  LIST_SHEET_STYLE,
  METHOD_ACTION_MAP,
  resolveTheme,
  type InterfaceSpecStyleOverride,
  INTERFACE_SPEC_TEMPLATE_STYLES,
  mergeInterfaceSpecStyles,
  type PresetFont,
  type ResolvedTheme,
} from './preset-data.js';

/**
 * Deterministic InterfaceSpecDocument → XLSX renderer.
 *
 * Pure function of (document, presets): the same document always produces the
 * same workbook. All content decisions (Korean names, field expansion, ...)
 * belong to the collector that wrote the document; this renderer only lays
 * the data out in the "aapserver" workbook form ported from the proven
 * Python generator (generate-api-interface-excel skill).
 *
 * Intentional differences from the Python generator:
 * - No naming-dictionary Koreanization: agent collectors are contractually
 *   required to fill `interfaceName` in Korean. The blank-name fallback here
 *   is a plain "<action> <path segments>" phrase.
 * - `minSize`/`maxSize` schema values are written into the detail columns
 *   the layout always reserved for them (the Python model had no such data).
 */

// ---------------------------------------------------------------------------
// Naming helpers (ported from scratch_builder.py)
// ---------------------------------------------------------------------------

function safeSheetTitle(base: string, used: Set<string>): string {
  let title = base.replace(/[/?*[\]]/g, '_');
  if (title.length > 31) title = title.slice(0, 31);
  if (!used.has(title)) {
    used.add(title);
    return title;
  }
  for (let i = 2; ; i += 1) {
    const suffix = ` (${i})`;
    const candidate = title.slice(0, 31 - suffix.length) + suffix;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

function containsHangul(text: string): boolean {
  return /[가-힣]/.test(text);
}

function methodActionKo(method: string): string {
  return METHOD_ACTION_MAP[method.toUpperCase()] ?? METHOD_ACTION_MAP['DEFAULT']!;
}

function pathSegments(path: string): string[] {
  const parts = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  if (parts.length >= 3 && parts[0] === 'api' && parts[1]!.toLowerCase().startsWith('v')) {
    return parts.slice(2);
  }
  return parts;
}

function pathPhrase(path: string): string {
  return pathSegments(path)
    .map((part) => part.replace(/^\{|\}$/g, '').trim())
    .filter(Boolean)
    .join(' ');
}

function moveActionToSuffix(name: string): string {
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return name.trim();
  if (ACTION_PREFIXES.includes(tokens[0]!)) {
    return [...tokens.slice(1), tokens[0]!].join(' ');
  }
  return tokens.join(' ');
}

export function deriveDomain(path: string): string {
  const parts = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  let seed = 'API';
  if (parts.length >= 3 && parts[0] === 'api' && parts[1]!.toLowerCase().startsWith('v')) {
    seed = parts[2]!;
  } else if (parts.length > 0) {
    seed = parts[0]!;
  }
  const cleaned = seed.toUpperCase().replace(/[^A-Z0-9]/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'API';
}

export function seedDomainCounters(endpoints: InterfaceEndpoint[]): Map<string, number> {
  const counters = new Map<string, number>();
  const pattern = /^([A-Z0-9][A-Z0-9-]*)-(\d+)$/i;
  for (const ep of endpoints) {
    const match = pattern.exec(ep.interfaceId.trim());
    if (!match) continue;
    const domain = match[1]!.toUpperCase();
    const num = Number.parseInt(match[2]!, 10);
    if (num > (counters.get(domain) ?? 0)) counters.set(domain, num);
  }
  return counters;
}

function fallbackInterfaceName(ep: InterfaceEndpoint): string {
  return moveActionToSuffix(`${methodActionKo(ep.method)} ${pathPhrase(ep.path)}`.trim());
}

export function resolveInterfaceName(ep: InterfaceEndpoint): string {
  const provided = ep.interfaceName.trim();
  if (provided && containsHangul(provided)) return moveActionToSuffix(provided);
  return fallbackInterfaceName(ep);
}

export function endpointApiKey(ep: InterfaceEndpoint): string {
  return `[${ep.method.toUpperCase()}] ${ep.path}`;
}

// ---------------------------------------------------------------------------
// Field hierarchy: numbering + nested sample payloads (ported)
// ---------------------------------------------------------------------------

interface FieldNode {
  field: InterfaceFieldSpec;
  uniquePath: string;
  depth: number;
  parentUniquePath: string | null;
}

function normalizeFieldNodes(fields: InterfaceFieldSpec[]): FieldNode[] {
  const nodes: FieldNode[] = [];
  const usedPaths = new Set<string>();
  const rawPathToLatestUnique = new Map<string, string>();
  const latestPathByDepth = new Map<number, string>();

  fields.forEach((field, idx) => {
    let rawPath = (field.path ?? field.nameEn ?? `field${idx + 1}`).trim();
    if (!rawPath) rawPath = `field${idx + 1}`;
    const rawParent = (field.parentPath ?? '').trim() || null;
    const depth = field.depth >= 0 ? field.depth : 0;

    let uniquePath = rawPath;
    if (usedPaths.has(uniquePath)) uniquePath = `${rawPath}#${idx + 1}`;
    usedPaths.add(uniquePath);

    let parentUnique: string | null = null;
    if (rawParent) parentUnique = rawPathToLatestUnique.get(rawParent) ?? null;
    if (parentUnique === null && depth > 0) {
      parentUnique = latestPathByDepth.get(depth - 1) ?? null;
    }

    nodes.push({ field, uniquePath, depth, parentUniquePath: parentUnique });
    rawPathToLatestUnique.set(rawPath, uniquePath);
    latestPathByDepth.set(depth, uniquePath);
    for (const d of [...latestPathByDepth.keys()]) {
      if (d > depth) latestPathByDepth.delete(d);
    }
  });

  return nodes;
}

export function hierarchicalNumbers(
  fields: InterfaceFieldSpec[],
  opts: { startRootNo?: number; topLevelParentNo?: string } = {},
): Array<number | string> {
  const nodes = normalizeFieldNodes(fields);
  const numbers: Array<number | string> = [];
  const numberByPath = new Map<string, string>();
  const childCountByParent = new Map<string, number>();
  let rootNo = (opts.startRootNo ?? 1) - 1;

  for (const node of nodes) {
    let parentNo: string | null = null;
    if (node.parentUniquePath && numberByPath.has(node.parentUniquePath)) {
      parentNo = numberByPath.get(node.parentUniquePath)!;
    } else if (opts.topLevelParentNo !== undefined && node.depth === 0) {
      parentNo = opts.topLevelParentNo;
    }

    if (parentNo === null) {
      rootNo += 1;
      numbers.push(rootNo);
      numberByPath.set(node.uniquePath, String(rootNo));
    } else {
      const childIdx = (childCountByParent.get(parentNo) ?? 0) + 1;
      childCountByParent.set(parentNo, childIdx);
      const no = `${parentNo}-${childIdx}`;
      numbers.push(no);
      numberByPath.set(node.uniquePath, no);
    }
  }

  return numbers;
}

function sampleValue(dataType: string): unknown {
  const t = dataType.toLowerCase();
  if (['int', 'integer', 'long', 'short'].some((x) => t.includes(x))) return 0;
  if (['double', 'float', 'decimal', 'bigdecimal', 'number'].some((x) => t.includes(x))) return 0;
  if (t.includes('bool')) return true;
  if (['list', 'array', '[]', 'set'].some((x) => t.includes(x))) return [];
  if (t.includes('datetime') || (t.includes('date') && t.includes('time'))) return '2026-01-01T00:00:00';
  if (t.includes('date')) return '2026-01-01';
  if (t.includes('time')) return '00:00:00';
  return 'sample';
}

function isCollectionType(dataType: string): boolean {
  const t = dataType.toLowerCase();
  return ['list', 'set', '[]', 'array', 'collection', 'iterable'].some((x) => t.includes(x));
}

function buildNestedSamplePayload(fields: InterfaceFieldSpec[]): Record<string, unknown> {
  const nodes = normalizeFieldNodes(fields);
  const children = new Map<string, FieldNode[]>();
  const roots: FieldNode[] = [];
  for (const node of nodes) {
    if (node.parentUniquePath === null) {
      roots.push(node);
    } else {
      const list = children.get(node.parentUniquePath) ?? [];
      list.push(node);
      children.set(node.parentUniquePath, list);
    }
  }

  const buildNodeValue = (node: FieldNode): unknown => {
    const kids = children.get(node.uniquePath) ?? [];
    if (kids.length === 0) return sampleValue(node.field.dataType);

    const nested: Record<string, unknown> = {};
    const dupIdx = new Map<string, number>();
    for (const child of kids) {
      let key = child.field.nameEn || 'field';
      if (key in nested) {
        const next = (dupIdx.get(key) ?? 1) + 1;
        dupIdx.set(key, next);
        key = `${key}_${next}`;
      }
      nested[key] = buildNodeValue(child);
    }
    return isCollectionType(node.field.dataType) ? [nested] : nested;
  };

  const payload: Record<string, unknown> = {};
  const dupIdx = new Map<string, number>();
  for (const node of roots) {
    let key = node.field.nameEn || 'field';
    if (key in payload) {
      const next = (dupIdx.get(key) ?? 1) + 1;
      dupIdx.set(key, next);
      key = `${key}_${next}`;
    }
    payload[key] = buildNodeValue(node);
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Authentication row resolution (stack-neutral; replaces hardcoded Bearer)
// ---------------------------------------------------------------------------

export interface ResolvedAuthRow {
  nameEn: string;
  nameKo: string;
  dataType: string;
  note: string;
  /** Example headers/cookies for the request sample block. */
  example: Record<string, unknown>;
}

/**
 * Resolve the auth row for an endpoint from its own `auth` override, else the
 * document-level `auth` scheme. Returns null when the endpoint is unauthenticated
 * or the scheme is `none`. Never fabricates a Bearer row: an auth-required
 * endpoint with no scheme anywhere yields an honest "방식 미지정" row instead.
 */
export function resolveAuthRow(
  ep: InterfaceEndpoint,
  docAuth: InterfaceAuthScheme | undefined,
): ResolvedAuthRow | null {
  const scheme = ep.auth ?? docAuth;
  if (!ep.authRequired && !ep.auth) return null;
  if (scheme && scheme.type === 'none') return null;

  if (!scheme) {
    // authRequired but nobody said how — don't invent Bearer.
    return {
      nameEn: '(auth)',
      nameKo: '인증 필요',
      dataType: 'String',
      note: '인증 방식 미지정',
      example: {},
    };
  }

  switch (scheme.type) {
    case 'undecided':
      return {
        nameEn: '(auth)',
        nameKo: '인증 여부',
        dataType: 'TBD',
        note: '인증 방식 확인 필요',
        example: {},
      };
    case 'bearer': {
      const name = scheme.name ?? 'Authorization';
      const note = scheme.valueFormat ?? 'Bearer {accessToken}';
      return {
        nameEn: name,
        nameKo: scheme.description ?? '인증 헤더',
        dataType: 'String',
        note,
        example: { [name]: 'Bearer sample' },
      };
    }
    case 'session-cookie': {
      const cookieName = scheme.name ?? 'sid';
      const note = scheme.valueFormat ?? `${cookieName}={세션ID}`;
      return {
        nameEn: 'Cookie',
        nameKo: scheme.description ?? '세션 쿠키',
        dataType: 'String',
        note,
        example: { Cookie: `${cookieName}=sample` },
      };
    }
    case 'api-key':
    case 'custom': {
      const location = scheme.location ?? 'header';
      const defaultName = scheme.type === 'api-key' ? 'X-API-Key' : 'Authorization';
      const credName = scheme.name ?? defaultName;
      const nameEn = location === 'cookie' ? 'Cookie' : credName;
      const note =
        scheme.valueFormat ?? (location === 'cookie' ? `${credName}={value}` : `{${credName}}`);
      const example =
        location === 'cookie'
          ? { Cookie: `${credName}=sample` }
          : location === 'query'
            ? {}
            : { [credName]: 'sample' };
      return {
        nameEn,
        nameKo: scheme.description ?? (scheme.type === 'api-key' ? 'API 키' : '인증'),
        dataType: 'String',
        note,
        example,
      };
    }
    default:
      return null;
  }
}

export function buildRequestExample(ep: InterfaceEndpoint, authRow: ResolvedAuthRow | null): unknown {
  // A supplied example (captured or statically synthesized) wins over the
  // type-derived fallback so the workbook preserves its reviewed shape.
  if (ep.requestExample !== undefined) return ep.requestExample;
  const out: Record<string, unknown> = { body: buildNestedSamplePayload(ep.requestFields) };
  if (authRow && Object.keys(authRow.example).length > 0) out['headers'] = authRow.example;
  return out;
}

export function buildResponseExample(ep: InterfaceEndpoint): unknown {
  // A supplied example (captured or statically synthesized) wins over the
  // type-derived fallback.
  if (ep.responseExample !== undefined) return ep.responseExample;
  let resultPayload: unknown;
  if (ep.responseFields.length > 0) {
    resultPayload = buildNestedSamplePayload(ep.responseFields);
  } else {
    const t = (ep.responseType ?? '').trim().toLowerCase();
    if (!t || t === 'object') resultPayload = {};
    else if (['list', 'array', 'set', 'collection', 'iterable', '[]'].some((x) => t.includes(x))) resultPayload = [];
    else if (['int', 'integer', 'long', 'short', 'byte', 'double', 'float', 'decimal', 'number'].some((x) => t.includes(x))) resultPayload = 0;
    else if (t.includes('bool')) resultPayload = true;
    else if (t.includes('string') || t.includes('char')) resultPayload = 'sample';
    else if (t.includes('resource') || t.includes('byte[]')) resultPayload = 'sample';
    else if (t.includes('datetime') || (t.includes('date') && t.includes('time'))) resultPayload = '2026-01-01T00:00:00';
    else if (t.includes('date')) resultPayload = '2026-01-01';
    else if (t.includes('time')) resultPayload = '00:00:00';
    else resultPayload = {};
  }
  return { resultCode: 0, resultMsg: 'SUCCESS', result: resultPayload };
}

// ---------------------------------------------------------------------------
// exceljs style helpers
// ---------------------------------------------------------------------------

type Ws = ExcelJS.Worksheet;

function toFont(preset: PresetFont): Partial<ExcelJS.Font> {
  const font: Partial<ExcelJS.Font> = {
    name: preset.name,
    size: preset.size,
    bold: preset.bold ?? false,
    color: { argb: preset.color },
  };
  if (preset.underline) font.underline = true;
  return font;
}

function solidFill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function thinBorder(color: string): Partial<ExcelJS.Borders> {
  const side: ExcelJS.Border = { style: 'thin', color: { argb: color } };
  return { top: side, left: side, bottom: side, right: side };
}

const ALIGN = {
  center: { horizontal: 'center', vertical: 'middle', wrapText: true },
  left: { horizontal: 'left', vertical: 'middle', wrapText: true },
  leftTop: { horizontal: 'left', vertical: 'top', wrapText: true },
  rightNone: { horizontal: 'right', wrapText: true },
  rightTop: { horizontal: 'right', vertical: 'top', wrapText: true },
} satisfies Record<string, Partial<ExcelJS.Alignment>>;

function mergeIfAbsent(ws: Ws, merged: Set<string>, range: string): void {
  if (merged.has(range)) return;
  ws.mergeCells(range);
  merged.add(range);
}

function sheetLocation(title: string, cellRef = 'A1'): string {
  return `#'${title.replace(/'/g, "''")}'!${cellRef}`;
}

// ---------------------------------------------------------------------------
// Sheet writers
// ---------------------------------------------------------------------------

function writeCoverSheet(ws: Ws, merged: Set<string>, doc: InterfaceSpecDocument): void {
  const layout = COVER_SHEET_LAYOUT;
  for (const range of layout.mergeRanges) mergeIfAbsent(ws, merged, range);
  ws.getCell(layout.brandCell).value = doc.cover.brand.trim() || layout.defaultBrandText;
  ws.getCell(layout.docTypeCell).value = layout.docTypeText;
  ws.getCell(layout.docNameCell).value = doc.cover.docName;
  ws.getCell(layout.versionCell).value = doc.cover.version;
  ws.getCell(layout.departmentCell).value = layout.departmentPrefix + doc.cover.department;
}

function applyCoverSheetPreset(ws: Ws, theme: ResolvedTheme): void {
  const style = COVER_SHEET_STYLE;
  const layout = COVER_SHEET_LAYOUT;
  ws.views = [{ zoomScale: style.zoomScale, activeCell: layout.activeCell }];
  ws.properties.defaultRowHeight = style.defaultRowHeight;
  ws.properties.defaultColWidth = style.defaultColWidth;
  for (const letter of style.columnWidthLetters) {
    ws.getColumn(letter).width = style.columnWidth;
  }
  for (const [row, height] of Object.entries(style.rowHeights)) {
    ws.getRow(Number(row)).height = height;
  }
  ws.pageSetup = {
    ...ws.pageSetup,
    paperSize: style.pageSetup.paperSize,
    fitToWidth: style.pageSetup.fitToWidth,
    margins: { ...style.pageMargins },
  };

  for (let row = 1; row <= 35; row += 1) {
    for (const col of style.columnWidthLetters) {
      const cell = ws.getCell(`${col}${row}`);
      cell.font = toFont(theme.fonts['coverBase']!);
      cell.alignment = { vertical: 'middle' };
    }
  }

  const coverCells: Array<[string, PresetFont, Partial<ExcelJS.Alignment>]> = [
    [layout.brandCell, theme.fonts['coverBrand']!, ALIGN.rightNone],
    [layout.docTypeCell, theme.fonts['coverDocType']!, ALIGN.rightTop],
    [layout.docNameCell, theme.fonts['coverDocName']!, ALIGN.rightNone],
    [layout.versionCell, theme.fonts['coverVersion']!, ALIGN.rightNone],
    [layout.departmentCell, theme.fonts['coverDepartment']!, ALIGN.rightTop],
  ];
  for (const [ref, font, alignment] of coverCells) {
    const cell = ws.getCell(ref);
    cell.font = toFont(font);
    cell.alignment = alignment;
  }
}

function writeListSheetScaffold(ws: Ws, merged: Set<string>): void {
  const layout = LIST_SHEET_LAYOUT;
  ws.getCell(layout.titleLinkCell).value = {
    formula: `${COVER_SHEET_LAYOUT.title}!${COVER_SHEET_LAYOUT.brandCell}`,
  };
  ws.getCell(layout.sectionTitleCell).value = layout.sectionTitleText;
  for (const range of layout.sectionMerges) mergeIfAbsent(ws, merged, range);
  for (const [ref, text] of Object.entries(layout.sectionLabels)) {
    ws.getCell(ref).value = text;
  }
  layout.headers.forEach((header, i) => {
    ws.getRow(layout.headerRow).getCell(i + 1).value = header;
  });
}

function applyListSheetPreset(ws: Ws, theme: ResolvedTheme): void {
  const style = LIST_SHEET_STYLE;
  ws.views = [{ showGridLines: false }];
  for (const [letter, width] of Object.entries(style.columnWidths)) {
    ws.getColumn(letter).width = width;
  }
  for (const [row, height] of Object.entries(style.rowHeights)) {
    ws.getRow(Number(row)).height = height;
  }
  const maxRow = ws.rowCount;
  for (let row = 1; row <= maxRow; row += 1) {
    for (let col = 1; col <= style.maxColumns; col += 1) {
      const cell = ws.getRow(row).getCell(col);
      if (row === style.sectionRow || row === style.headerRow) {
        cell.font = toFont(theme.fonts['listHeader']!);
        cell.fill = solidFill(theme.fills.listHeader);
        cell.border = thinBorder(theme.borderColor);
        cell.alignment = ALIGN.center;
      } else {
        cell.font = toFont(theme.fonts['body']!);
        cell.border = thinBorder(theme.borderColor);
        cell.alignment = ALIGN.left;
      }
    }
  }
}

function writeGeneratedListSheetScaffold(ws: Ws): void {
  LIST_SHEET_LAYOUT.headers.slice(0, 9).forEach((header, i) => {
    ws.getRow(1).getCell(i + 1).value = header;
  });
}

function clearRowBorders(ws: Ws, row: number): void {
  for (let col = 1; col <= DETAIL_FIELD_HEADERS.length; col += 1) {
    ws.getRow(row).getCell(col).border = {};
  }
}

function writeJsonSampleBlock(
  ws: Ws,
  merged: Set<string>,
  titleRow: number,
  title: string,
  payload: unknown,
): number {
  const layout = DETAIL_SHEET_LAYOUT;
  const heights = layout.sampleBlocks.jsonRowHeight;
  mergeIfAbsent(ws, merged, `A${titleRow}:${layout.mergeEndColumn}${titleRow}`);
  const jsonRow = titleRow + 1;
  mergeIfAbsent(ws, merged, `A${jsonRow}:${layout.mergeEndColumn}${jsonRow}`);

  const jsonText = JSON.stringify(payload, null, 2);
  ws.getRow(titleRow).getCell(1).value = title;
  const jsonCell = ws.getRow(jsonRow).getCell(1);
  jsonCell.value = jsonText;
  jsonCell.alignment = ALIGN.leftTop;

  const lineCount = Math.max(1, jsonText.split('\n').length);
  ws.getRow(jsonRow).height = Math.min(heights.max, Math.max(heights.min, lineCount * heights.perLine));
  clearRowBorders(ws, jsonRow);
  return jsonRow + 1;
}

function writeFieldRow(
  ws: Ws,
  row: number,
  no: number | string,
  field: InterfaceFieldSpec,
): void {
  const cells = ws.getRow(row);
  cells.getCell(1).value = no;
  cells.getCell(2).value = field.nameEn;
  cells.getCell(3).value = field.nameKo;
  cells.getCell(4).value = field.dataType;
  cells.getCell(5).value = field.minSize;
  cells.getCell(6).value = field.maxSize;
  cells.getCell(7).value = field.required;
  cells.getCell(8).value = field.note;
}

function writeDetailSheet(
  ws: Ws,
  merged: Set<string>,
  ep: InterfaceEndpoint,
  interfaceId: string,
  interfaceName: string,
  docAuth: InterfaceAuthScheme | undefined,
): void {
  const layout = DETAIL_SHEET_LAYOUT;
  const request = layout.requestSection;
  const response = layout.responseSection;
  const samples = layout.sampleBlocks;

  ws.getCell(layout.title.cell).value = layout.title.text;
  const navCell = ws.getCell(layout.navigation.cell);
  navCell.value = {
    text: layout.navigation.text,
    hyperlink: sheetLocation(layout.navigation.targetSheet),
  };

  const valueMap = { interfaceId, interfaceName, apiKey: endpointApiKey(ep) };
  for (const binding of layout.fieldBindings) {
    ws.getCell(binding.labelCell).value = binding.label;
    ws.getCell(binding.valueCell).value = valueMap[binding.valueKey];
  }
  for (const range of layout.mergeRanges) mergeIfAbsent(ws, merged, range);

  ws.getCell(request.titleCell).value = request.title;
  DETAIL_FIELD_HEADERS.forEach((header, i) => {
    ws.getRow(request.headerRow).getCell(i + 1).value = header;
  });

  const authRow = resolveAuthRow(ep, docAuth);
  let row: number = request.dataStartRow;
  if (authRow) {
    const cells = ws.getRow(row);
    cells.getCell(1).value = 1;
    cells.getCell(2).value = authRow.nameEn;
    cells.getCell(3).value = authRow.nameKo;
    cells.getCell(4).value = authRow.dataType;
    cells.getCell(7).value = 'Y';
    cells.getCell(8).value = authRow.note;
    row += 1;
  }

  const reqNos = hierarchicalNumbers(ep.requestFields, { startRootNo: authRow ? 2 : 1 });
  ep.requestFields.forEach((field, i) => {
    writeFieldRow(ws, row, reqNos[i]!, field);
    row += 1;
  });

  const responseTitleRow = Math.max(response.minTitleRow, row + response.gapAfterRequest);
  mergeIfAbsent(ws, merged, `A${responseTitleRow}:${layout.mergeEndColumn}${responseTitleRow}`);
  ws.getRow(responseTitleRow).getCell(1).value = response.title;
  DETAIL_FIELD_HEADERS.forEach((header, i) => {
    ws.getRow(responseTitleRow + response.headerRowOffset).getCell(i + 1).value = header;
  });

  row = responseTitleRow + response.headerRowOffset + 1;
  response.baseFields.forEach((base, idx) => {
    const cells = ws.getRow(row);
    cells.getCell(1).value = idx + 1;
    cells.getCell(2).value = base.nameEn;
    cells.getCell(3).value = base.nameKo;
    cells.getCell(4).value = base.dataType ?? (ep.responseType || 'Object');
    cells.getCell(7).value = base.required;
    cells.getCell(8).value = base.note;
    row += 1;
  });

  const respNos = hierarchicalNumbers(ep.responseFields, {
    topLevelParentNo: response.topLevelParentNo,
  });
  ep.responseFields.forEach((field, i) => {
    writeFieldRow(ws, row, respNos[i]!, field);
    row += 1;
  });

  const staticExampleSuffix = ep.exampleSource === 'static-analysis'
    ? ' (static analysis; not executed)'
    : '';
  row += samples.gapBeforeRequestSample;
  row = writeJsonSampleBlock(
    ws,
    merged,
    row,
    `${samples.requestTitle}${staticExampleSuffix}`,
    buildRequestExample(ep, authRow),
  );
  row += samples.gapBetweenSamples;
  writeJsonSampleBlock(
    ws,
    merged,
    row,
    `${samples.responseTitle}${staticExampleSuffix}`,
    buildResponseExample(ep),
  );
}

function applyDetailSheetPreset(ws: Ws, merged: Set<string>, theme: ResolvedTheme): void {
  const style = DETAIL_SHEET_STYLE;
  ws.views = [{ showGridLines: false }];
  for (const [letter, width] of Object.entries(style.columnWidths)) {
    ws.getColumn(letter).width = width;
  }
  const fixedHeights = new Map(Object.entries(style.rowHeights).map(([r, h]) => [Number(r), h]));
  for (const [row, height] of fixedHeights) {
    ws.getRow(row).height = height;
  }
  const maxRow = ws.rowCount;
  for (let row = 1; row <= maxRow; row += 1) {
    if (!fixedHeights.has(row) && ws.getRow(row).height === undefined) {
      ws.getRow(row).height = style.defaultRowHeight;
    }
  }

  for (let row = 1; row <= maxRow; row += 1) {
    for (let col = 1; col <= style.maxColumns; col += 1) {
      const cell = ws.getRow(row).getCell(col);
      cell.font = toFont(theme.fonts['body']!);
      cell.border = thinBorder(theme.borderColor);
      cell.alignment = ALIGN.left;
    }
  }

  for (const ref of style.titleCells) {
    const cell = ws.getCell(ref);
    cell.font = toFont(theme.fonts['title']!);
    cell.border = thinBorder(theme.borderColor);
    cell.alignment = ALIGN.center;
  }
  for (const ref of style.labelCells) {
    const cell = ws.getCell(ref);
    cell.font = toFont(theme.fonts['label']!);
    cell.fill = solidFill(theme.fills.label);
    cell.border = thinBorder(theme.borderColor);
    cell.alignment = ALIGN.center;
  }
  for (const ref of style.bodyCells) {
    const cell = ws.getCell(ref);
    cell.font = toFont(theme.fonts['body']!);
    cell.border = thinBorder(theme.borderColor);
    cell.alignment = ALIGN.left;
  }

  const markers = new Set(style.sectionMarkers.map((m) => m.toLowerCase()));
  const sectionRows: number[] = [];
  for (let row = 1; row <= maxRow; row += 1) {
    const value = String(ws.getRow(row).getCell(1).value ?? '').trim().toLowerCase();
    if (markers.has(value)) sectionRows.push(row);
  }

  for (const row of sectionRows) {
    for (let col = 1; col <= style.sectionHeaderMaxCol; col += 1) {
      const cell = ws.getRow(row).getCell(col);
      cell.font = toFont(theme.fonts['section']!);
      cell.fill = solidFill(theme.fills.section);
      cell.border = thinBorder(theme.borderColor);
      cell.alignment = ALIGN.center;
    }
    if (ws.getRow(row).height === undefined) ws.getRow(row).height = 15.6;
    const headerRow = row + 1;
    if (headerRow <= maxRow) {
      for (let col = 1; col <= style.maxColumns; col += 1) {
        const cell = ws.getRow(headerRow).getCell(col);
        cell.font = toFont(theme.fonts['header']!);
        cell.fill = solidFill(theme.fills.header);
        cell.border = thinBorder(theme.borderColor);
        cell.alignment = ALIGN.center;
      }
      if (ws.getRow(headerRow).height === undefined) {
        ws.getRow(headerRow).height = style.defaultRowHeight;
      }
    }
  }

  // JSON sample blocks: merged title row + merged payload row starting with "{".
  for (let row = 1; row < maxRow; row += 1) {
    const current = String(ws.getRow(row).getCell(1).value ?? '').trim();
    const nextValue = String(ws.getRow(row + 1).getCell(1).value ?? '').trim();
    if (!current || !nextValue.startsWith('{')) continue;
    if (!merged.has(`A${row}:H${row}`) || !merged.has(`A${row + 1}:H${row + 1}`)) continue;
    for (let col = 1; col <= style.maxColumns; col += 1) {
      const titleCell = ws.getRow(row).getCell(col);
      titleCell.font = toFont(theme.fonts['section']!);
      titleCell.fill = solidFill(theme.fills.header);
      titleCell.border = thinBorder(theme.borderColor);
      titleCell.alignment = ALIGN.center;
      const jsonCell = ws.getRow(row + 1).getCell(col);
      jsonCell.font = toFont(theme.fonts['json']!);
      jsonCell.border = thinBorder(theme.borderColor);
      jsonCell.alignment = ALIGN.leftTop;
    }
  }

  const nav = ws.getCell(DETAIL_SHEET_LAYOUT.navigation.cell);
  if (nav.value !== null && nav.value !== undefined) {
    nav.font = toFont(theme.fonts['hyperlink']!);
  }
}

// ---------------------------------------------------------------------------
// Internal-hyperlink post-processing
// ---------------------------------------------------------------------------

/**
 * exceljs stores every hyperlink as an EXTERNAL relationship
 * (TargetMode="External") and additionally writes the sheet target with a
 * leading "#" into the `location` attribute. Viewers then treat sheet-to-
 * sheet navigation as an untrusted external link (Hancell/한셀 warns, then
 * fails on the bogus "#'...'" URL).
 *
 * Rewrite the workbook the way openpyxl does: hyperlink elements keep only a
 * "#"-less `location` attribute (a true internal link) and the external
 * relationship entries are removed.
 */
async function convertSheetLinksToInternal(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const sheetPaths = Object.keys(zip.files).filter((name) =>
    /^xl\/worksheets\/sheet\d+\.xml$/.test(name),
  );

  for (const sheetPath of sheetPaths) {
    const xml = await zip.file(sheetPath)!.async('string');
    const removedRelIds = new Set<string>();
    const patched = xml.replace(/<hyperlink\b[^>]*\/>/g, (tag) => {
      if (!/location="#/.test(tag)) return tag;
      const relId = /r:id="([^"]+)"/.exec(tag)?.[1];
      const ref = /ref="([^"]+)"/.exec(tag)?.[1];
      const location = /location="#([^"]*)"/.exec(tag)?.[1];
      if (!relId || !ref || location === undefined) return tag;
      removedRelIds.add(relId);
      return `<hyperlink ref="${ref}" location="${location}"/>`;
    });
    if (removedRelIds.size === 0) continue;

    zip.file(sheetPath, patched);
    const relsPath = sheetPath.replace('xl/worksheets/', 'xl/worksheets/_rels/') + '.rels';
    const relsFile = zip.file(relsPath);
    if (relsFile) {
      let rels = await relsFile.async('string');
      for (const relId of removedRelIds) {
        rels = rels.replace(new RegExp(`<Relationship Id="${relId}"[^>]*/>`), '');
      }
      zip.file(relsPath, rels);
    }
  }

  return Buffer.from(
    await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface RenderInterfaceSpecXlsxResult {
  buffer: Buffer;
  sheetTitles: string[];
  endpointCount: number;
}

export class InterfaceSpecRenderError extends Error {
  constructor(
    message: string,
    readonly issues: ReturnType<typeof validateInterfaceSpecDocument>,
  ) {
    super(message);
    this.name = 'InterfaceSpecRenderError';
  }
}

export interface RenderInterfaceSpecXlsxOptions {
  style?: InterfaceSpecStyleOverride | null;
}

export async function renderInterfaceSpecXlsx(
  doc: InterfaceSpecDocument,
  options: RenderInterfaceSpecXlsxOptions = {},
): Promise<RenderInterfaceSpecXlsxResult> {
  const theme = resolveTheme(
    mergeInterfaceSpecStyles(INTERFACE_SPEC_TEMPLATE_STYLES[doc.templatePreset], options.style),
  );
  const issues = validateInterfaceSpecDocument(doc);
  const fatal = issues.filter((issue) => issue.severity === 'fatal');
  if (fatal.length > 0) {
    throw new InterfaceSpecRenderError(
      `interface-spec document has ${fatal.length} fatal issue(s): ${fatal
        .map((issue) => issue.message)
        .join(' / ')}`,
      issues,
    );
  }

  const wb = new ExcelJS.Workbook();
  const coverWs = wb.addWorksheet(COVER_SHEET_LAYOUT.title);
  const coverMerged = new Set<string>();
  writeCoverSheet(coverWs, coverMerged, doc);

  const listWs = wb.addWorksheet(LIST_SHEET_LAYOUT.title);
  const listMerged = new Set<string>();
  writeListSheetScaffold(listWs, listMerged);

  const generatedWs = wb.addWorksheet(GENERATED_LIST_SHEET_TITLE);
  writeGeneratedListSheetScaffold(generatedWs);

  const usedTitles = new Set(wb.worksheets.map((ws) => ws.name));
  const domainCounters = seedDomainCounters(doc.endpoints);
  const sorted = [...doc.endpoints].sort((a, b) => {
    if (a.method !== b.method) return a.method < b.method ? -1 : 1;
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    return 0;
  });

  const columns = LIST_SHEET_LAYOUT.columns;
  sorted.forEach((ep, i) => {
    const idx = i + 1;
    const interfaceName = resolveInterfaceName(ep);
    const sheetTitle = safeSheetTitle(interfaceName.slice(0, 31), usedTitles);

    let interfaceId: string;
    if (ep.interfaceId.trim()) {
      interfaceId = ep.interfaceId.trim().toUpperCase();
    } else {
      const domain = deriveDomain(ep.path);
      const next = (domainCounters.get(domain) ?? 0) + 1;
      domainCounters.set(domain, next);
      interfaceId = `${domain}-${String(next).padStart(3, '0')}`;
    }

    const detailWs = wb.addWorksheet(sheetTitle);
    const detailMerged = new Set<string>();
    writeDetailSheet(detailWs, detailMerged, ep, interfaceId, interfaceName, doc.auth);
    applyDetailSheetPreset(detailWs, detailMerged, theme);

    const rowNo = LIST_SHEET_LAYOUT.dataStartRow + idx - 1;
    const listRow = listWs.getRow(rowNo);
    listRow.getCell(columns.rowNo).value = idx;
    listRow.getCell(columns.businessCode).value = ep.businessCode || LIST_SHEET_LAYOUT.defaultBusinessCode;
    listRow.getCell(columns.interfaceId).value = interfaceId;
    listRow.getCell(columns.channel).value = ep.channel || LIST_SHEET_LAYOUT.defaultChannel;
    listRow.getCell(columns.package).value = ep.moduleName;
    listRow.getCell(columns.controller).value = ep.sourceFile;
    listRow.getCell(columns.service).value = ep.serviceName;
    listRow.getCell(columns.owner).value = ep.owner;
    listRow.getCell(columns.note).value = ep.note;
    const link = sheetLocation(sheetTitle);
    listRow.getCell(columns.interfaceName).value = { text: interfaceName, hyperlink: link };
    listRow.getCell(columns.url).value = { text: endpointApiKey(ep), hyperlink: link };

    const generatedRow = generatedWs.getRow(idx + 1);
    generatedRow.getCell(1).value = idx;
    generatedRow.getCell(2).value = ep.businessCode || LIST_SHEET_LAYOUT.defaultBusinessCode;
    generatedRow.getCell(3).value = interfaceId;
    generatedRow.getCell(4).value = interfaceName;
    generatedRow.getCell(5).value = ep.channel || LIST_SHEET_LAYOUT.defaultChannel;
    generatedRow.getCell(6).value = endpointApiKey(ep);
    generatedRow.getCell(7).value = ep.moduleName;
    generatedRow.getCell(8).value = ep.sourceFile;
    generatedRow.getCell(9).value = ep.serviceName;
  });

  applyCoverSheetPreset(coverWs, theme);
  applyListSheetPreset(listWs, theme);

  const buffer = await convertSheetLinksToInternal(Buffer.from(await wb.xlsx.writeBuffer()));
  return {
    buffer,
    sheetTitles: wb.worksheets.map((ws) => ws.name),
    endpointCount: sorted.length,
  };
}
