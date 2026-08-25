/**
 * Declarative workbook presets for the interface-spec XLSX renderer.
 *
 * Ported 1:1 from the proven Python generator's `workbook_layout.json` and
 * `style_preset.json` (generate-api-interface-excel skill, "aapserver" form).
 * Keep these as data — the renderer must stay a pure function of
 * (InterfaceSpecDocument, presets).
 */

export const METHOD_ACTION_MAP: Record<string, string> = {
  GET: '조회',
  POST: '등록',
  PUT: '수정',
  PATCH: '수정',
  DELETE: '삭제',
  DEFAULT: '처리',
};

export const ACTION_PREFIXES: readonly string[] = [
  '조회',
  '등록',
  '수정',
  '삭제',
  '점검',
  '요청',
  '변경',
  '생성',
  '발급',
  '확인',
  '검증',
  '처리',
];

export const DETAIL_FIELD_HEADERS: readonly string[] = [
  'NO',
  '영문명',
  '한글명',
  '데이터타입',
  '최소사이즈',
  '최대사이즈',
  '필수여부',
  '비고',
];

export const LIST_SHEET_LAYOUT = {
  title: '인터페이스 목록',
  titleLinkCell: 'A1',
  sectionTitleCell: 'A3',
  sectionTitleText: '인터페이스 목록',
  sectionMerges: ['A4:D4', 'E4:J4', 'K4:K5'],
  sectionLabels: { A4: '인터페이스 구분', K4: '비고' } as Record<string, string>,
  headerRow: 5,
  dataStartRow: 6,
  headers: [
    'NO',
    '업무코드',
    '화면ID',
    '인터페이스명',
    '채널',
    'URL',
    '패키지',
    '컨트롤러',
    '서비스',
    '담당자',
    '비고',
  ],
  // Business code is blank by default (matching 담당자/비고). The user fills
  // it via the question form's 일괄/모듈별/파일 options; an unfilled cell
  // stays empty rather than showing a placeholder like "AUTO".
  defaultBusinessCode: '',
  defaultChannel: '',
  columns: {
    rowNo: 1,
    businessCode: 2,
    interfaceId: 3,
    interfaceName: 4,
    channel: 5,
    url: 6,
    package: 7,
    controller: 8,
    service: 9,
    owner: 10,
    note: 11,
  },
} as const;

export const COVER_SHEET_LAYOUT = {
  title: '문서표지',
  brandCell: 'Q4',
  defaultBrandText: '그리스 OSE',
  docTypeCell: 'O7',
  docTypeText: '인터페이스 명세서',
  docNameCell: 'O9',
  versionCell: 'Q10',
  departmentCell: 'N17',
  mergeRanges: ['Q4:T4', 'O7:T7', 'O9:T9', 'Q10:T10', 'N17:T17'],
  departmentPrefix: '관리부서 : ',
  activeCell: 'P18',
} as const;

export const DETAIL_SHEET_LAYOUT = {
  mergeEndColumn: 'H',
  title: { cell: 'A4', text: '인터페이스 명세서' },
  navigation: { cell: 'A5', text: '목록', targetSheet: '인터페이스 목록' },
  fieldBindings: [
    { labelCell: 'A6', label: '인터페이스 ID', valueCell: 'B6', valueKey: 'interfaceId' },
    { labelCell: 'C6', label: '인터페이스 설명', valueCell: 'D6', valueKey: 'interfaceName' },
    { labelCell: 'A7', label: '인터페이스 명', valueCell: 'B7', valueKey: 'interfaceName' },
    { labelCell: 'A8', label: '인터페이스 URL', valueCell: 'B8', valueKey: 'apiKey' },
  ] as ReadonlyArray<{ labelCell: string; label: string; valueCell: string; valueKey: 'interfaceId' | 'interfaceName' | 'apiKey' }>,
  mergeRanges: ['A4:H4', 'C6:C8', 'D6:H8', 'A10:H10'],
  requestSection: { titleCell: 'A10', title: 'REQUEST', headerRow: 11, dataStartRow: 12 },
  authHeaderRow: {
    nameEn: 'Authorization',
    nameKo: '인증 헤더',
    dataType: 'String',
    required: 'Y',
    note: 'Bearer {accessToken}',
  },
  responseSection: {
    minTitleRow: 14,
    gapAfterRequest: 2,
    title: 'Response',
    headerRowOffset: 1,
    baseFields: [
      { nameEn: 'resultCode', nameKo: '결과코드', dataType: 'Integer', required: 'Y', note: '' },
      { nameEn: 'resultMsg', nameKo: '결과메시지', dataType: 'String', required: 'Y', note: '' },
      // dataType null → use endpoint.responseType or "Object" at render time.
      { nameEn: 'result', nameKo: '결과', dataType: null, required: 'Y', note: '' },
    ] as ReadonlyArray<{ nameEn: string; nameKo: string; dataType: string | null; required: string; note: string }>,
    topLevelParentNo: '3',
  },
  sampleBlocks: {
    gapBeforeRequestSample: 1,
    gapBetweenSamples: 1,
    requestTitle: '요청 예시 데이터',
    responseTitle: '응답 예시 데이터',
    jsonRowHeight: { min: 54, perLine: 13, max: 409.5 },
  },
} as const;

export const GENERATED_LIST_SHEET_TITLE = '인터페이스 목록(Generated)';

// ---------------------------------------------------------------------------
// Style preset (colors/fonts/sizes ported from style_preset.json)
// ---------------------------------------------------------------------------

export interface PresetFont {
  name: string;
  size: number;
  bold?: boolean;
  color: string; // ARGB
  underline?: boolean;
}

export const FONTS: Record<string, PresetFont> = {
  title: { name: 'Malgun Gothic', size: 20, color: 'FF000000' },
  section: { name: 'Malgun Gothic', size: 10, bold: true, color: 'FF000000' },
  header: { name: 'Malgun Gothic', size: 10, bold: true, color: 'FF000000' },
  label: { name: 'Malgun Gothic', size: 10, bold: true, color: 'FF000000' },
  body: { name: 'Malgun Gothic', size: 10, color: 'FF000000' },
  json: { name: 'Malgun Gothic', size: 10, color: 'FF000000' },
  listHeader: { name: 'Malgun Gothic', size: 10, bold: true, color: 'FF000000' },
  coverBrand: { name: '맑은 고딕', size: 20, bold: true, color: 'FF000000' },
  coverDocType: { name: 'LG스마트체 Regular', size: 28, bold: true, color: 'FF000000' },
  coverDocName: { name: 'LG스마트체 Regular', size: 20, bold: true, color: 'FF000000' },
  coverVersion: { name: 'LG스마트체 Regular', size: 12, bold: true, color: 'FF000000' },
  coverDepartment: { name: 'LG스마트체 Regular', size: 14, bold: true, color: 'FF000000' },
  coverBase: { name: 'LG스마트체 Regular', size: 11, color: 'FF000000' },
  hyperlink: { name: 'Malgun Gothic', size: 10, color: 'FF0563C1', underline: true },
};

export const FILL_COLORS = {
  section: 'FFDAEEF3',
  header: 'FFDAEEF3',
  label: 'FFDAEEF3',
  listHeader: 'FFCCFFCC',
} as const;

export const BORDER_COLOR_THIN_GRAY = 'FFD9DEE8';

/**
 * Optional style override, e.g. derived from a selected design system's
 * tokens. Only the provided keys deviate from the aapserver defaults, so an
 * empty/absent override keeps the workbook byte-for-byte deterministic.
 * Colors are ARGB strings (e.g. "FF1A1916").
 */
export interface InterfaceSpecStyleOverride {
  fonts?: Partial<Record<keyof typeof FONTS, Partial<PresetFont>>>;
  fills?: Partial<Record<keyof typeof FILL_COLORS, string>>;
  borderColor?: string;
}

/**
 * The current SI workbook remains the default. The other built-ins keep the
 * exact sheet/cell contract and vary only deterministic workbook styling, so
 * preview and export never drift structurally.
 */
export const INTERFACE_SPEC_TEMPLATE_STYLES = {
  'si-standard': null,
  compact: {
    fills: {
      section: 'FFE2E8F0',
      header: 'FFE2E8F0',
      label: 'FFF1F5F9',
      listHeader: 'FFE2E8F0',
    },
    borderColor: 'FFCBD5E1',
  },
  review: {
    fills: {
      section: 'FFFFF2CC',
      header: 'FFFFF2CC',
      label: 'FFFFF8E7',
      listHeader: 'FFFFE699',
    },
    borderColor: 'FFE0B84F',
  },
} satisfies Record<string, InterfaceSpecStyleOverride | null>;

export function mergeInterfaceSpecStyles(
  base?: InterfaceSpecStyleOverride | null,
  override?: InterfaceSpecStyleOverride | null,
): InterfaceSpecStyleOverride | null {
  if (!base && !override) return null;
  const borderColor = override?.borderColor ?? base?.borderColor;
  return {
    fonts: { ...(base?.fonts ?? {}), ...(override?.fonts ?? {}) },
    fills: { ...(base?.fills ?? {}), ...(override?.fills ?? {}) },
    ...(borderColor ? { borderColor } : {}),
  };
}

export interface ResolvedTheme {
  fonts: Record<keyof typeof FONTS, PresetFont>;
  fills: Record<keyof typeof FILL_COLORS, string>;
  borderColor: string;
}

export function resolveTheme(override?: InterfaceSpecStyleOverride | null): ResolvedTheme {
  const fonts = {} as Record<keyof typeof FONTS, PresetFont>;
  for (const key of Object.keys(FONTS) as Array<keyof typeof FONTS>) {
    fonts[key] = { ...FONTS[key]!, ...(override?.fonts?.[key] ?? {}) };
  }
  const fills = { ...FILL_COLORS, ...(override?.fills ?? {}) } as Record<
    keyof typeof FILL_COLORS,
    string
  >;
  return {
    fonts,
    fills,
    borderColor: override?.borderColor ?? BORDER_COLOR_THIN_GRAY,
  };
}

export const LIST_SHEET_STYLE = {
  showGridLines: false,
  columnWidths: {
    A: 17.69921875,
    B: 6.59765625,
    C: 10.796875,
    D: 41.19921875,
    E: 6.69921875,
    F: 40.8984375,
    G: 23.8984375,
    H: 55.8984375,
    I: 52.69921875,
    J: 15.8984375,
    K: 8.8984375,
  } as Record<string, number>,
  rowHeights: { 4: 20.1, 5: 20.1, 6: 26.4 } as Record<number, number>,
  sectionRow: 4,
  headerRow: 5,
  maxColumns: 11,
} as const;

export const COVER_SHEET_STYLE = {
  zoomScale: 70,
  defaultRowHeight: 14.4,
  defaultColWidth: 8.59765625,
  columnWidthLetters: 'ABCDEFGHIJKLMNOPQRST',
  columnWidth: 13,
  rowHeights: {
    1: 25.5, 2: 25.5, 3: 25.5, 4: 31.5, 5: 25.5, 6: 25.5, 7: 35.25, 8: 25.5,
    9: 25.5, 10: 15.75, 11: 15.75, 12: 15.75, 13: 15.75, 14: 15.75, 15: 15.75,
    16: 15.75, 17: 18, 18: 15.75, 19: 18, 20: 16.5, 21: 16.5, 22: 16.5,
    23: 16.5, 24: 16.5, 25: 16.5, 26: 16.5, 27: 16.5, 28: 16.5, 29: 16.5,
    30: 16.5, 31: 16.5, 32: 16.5, 33: 16.5, 34: 16.5, 35: 15.75,
  } as Record<number, number>,
  pageMargins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
  pageSetup: { paperSize: 9, fitToWidth: 0 },
} as const;

export const DETAIL_SHEET_STYLE = {
  showGridLines: false,
  columnWidths: {
    A: 27.3984375,
    B: 35.3984375,
    C: 18.09765625,
    D: 8.8984375,
    E: 8.59765625,
    F: 13,
    G: 7.09765625,
    H: 35.3984375,
  } as Record<string, number>,
  rowHeights: { 4: 31.5, 5: 16.5, 6: 13.5, 7: 15.6, 8: 15.6, 11: 31.2, 12: 15.6, 17: 31.2 } as Record<number, number>,
  defaultRowHeight: 15.6,
  maxColumns: 8,
  titleCells: ['A4'],
  labelCells: ['A5', 'A6', 'A7', 'A8', 'C6', 'C7', 'C8'],
  bodyCells: ['B6', 'B7', 'B8', 'D6', 'D7', 'D8'],
  sectionMarkers: ['request', 'response'],
  sectionHeaderMaxCol: 8,
} as const;
