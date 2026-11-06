/**
 * Reference board: pages a person kept while browsing, to borrow a pattern from (layout structure, flow, field
 * composition, interaction) and apply it to the project they are building.
 *
 * What is kept is deliberately a pattern, not a copy: the page's URL (credentials and secret-looking query values
 * removed), an optional screenshot for layout, and an outline of its structure (regions, heading levels, form field
 * types and labels, table headers, control counts). Body copy, image and link URLs, colours and fonts are not kept.
 * The apply block tells the agent to rebuild the pattern in the project's own code and style and to copy no text,
 * images, logos or branding.
 */

export type ReferenceTake = 'structure' | 'flow' | 'fields' | 'interaction';
export const REFERENCE_TAKES: readonly ReferenceTake[] = ['structure', 'flow', 'fields', 'interaction'];

export interface ReferenceFormField {
  /** Input type (`email`, `password`, `select`, `textarea`, `checkbox`...). */
  type: string;
  /** The visible label or placeholder, at most {@link REFERENCE_LIMITS.label} characters. */
  label: string;
  required: boolean;
}

export interface ReferenceOutline {
  /** Top-level landmarks in page order: header, nav, main, aside, footer, form, section, dialog. */
  regions: string[];
  /** Number of headings per level, h1 first. */
  headings: Array<{ level: number; count: number }>;
  forms: Array<{ fields: ReferenceFormField[]; buttons: number }>;
  tables: Array<{ columns: string[]; rows: number }>;
  controls: { links: number; buttons: number; inputs: number; images: number };
  viewport: { width: number; height: number } | null;
}

export interface ReferenceScreenshot {
  /** Project-relative path, inside the board folder. */
  file: string;
  sha256: string;
  bytes: number;
  mediaType: 'image/png' | 'image/jpeg';
}

export interface ReferenceItem {
  id: string;
  url: string;
  title: string;
  note: string;
  takes: ReferenceTake[];
  screenshot: ReferenceScreenshot | null;
  outline: ReferenceOutline | null;
  capturedAt: string;
  source: 'browser' | 'cli';
}

export interface ReferenceBoardFile {
  schemaVersion: 1;
  kind: 'reference-board';
  items: ReferenceItem[];
}

/** The board lives in the project, so the agent can read the screenshots; it carries its own `.gitignore`. */
export const REFERENCE_BOARD_FOLDER = 'references';
export const REFERENCE_BOARD_FILE = `${REFERENCE_BOARD_FOLDER}/board.json`;

export const REFERENCE_LIMITS = {
  items: 500,
  title: 200,
  note: 2000,
  request: 4000,
  target: 1024,
  label: 60,
  regions: 24,
  forms: 6,
  fields: 30,
  tables: 6,
  columns: 16,
  screenshotBytes: 16 * 1024 * 1024,
  applyItems: 12,
} as const;

export interface ReferenceListResponse {
  folder: string;
  items: ReferenceItem[];
}

export interface ReferenceCreateRequest {
  url: string;
  title?: string;
  note?: string;
  takes?: ReferenceTake[];
  /** Base64 PNG or JPEG, without a `data:` prefix (one is accepted and removed). */
  screenshotBase64?: string;
  outline?: unknown;
  source?: 'browser' | 'cli';
}

export interface ReferenceUpdateRequest {
  title?: string;
  note?: string;
  takes?: ReferenceTake[];
}

export interface ReferenceApplyRequest {
  referenceIds: string[];
  /** A project file, a screen name or a short description of where the pattern goes. */
  target?: string;
  /** What the person wants done with the references. */
  request?: string;
  /** Overrides each reference's own `takes` for this request. */
  takes?: ReferenceTake[];
  /** Name the screenshots in the block (default true). */
  includeScreenshot?: boolean;
}

export type ReferenceScreenshotState = 'verified' | 'changed' | 'missing';

export interface ReferenceApplyResponse {
  block: string;
  references: string[];
  /** Screenshots named in the block, project-relative, with whether their bytes still match. */
  screenshots: Array<{ file: string; state: ReferenceScreenshotState }>;
}

const SENSITIVE_QUERY = /(?:token|secret|auth|password|passwd|session|code|key|sig|signature|otp)/i;

/**
 * The URL as it is kept: http(s) only, without user info and fragment, with the values of secret-looking query
 * parameters replaced (the names stay, as the built-in browser's automation log does). Null when not http(s).
 */
export function sanitizeReferenceUrl(value: string): string | null {
  let url: URL;
  try { url = new URL(value.trim()); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.username = '';
  url.password = '';
  url.hash = '';
  for (const key of [...new Set(url.searchParams.keys())]) {
    if (SENSITIVE_QUERY.test(key)) url.searchParams.set(key, '[redacted]');
  }
  const href = url.toString();
  return href.length > 2048 ? null : href;
}

export function isReferenceTake(value: unknown): value is ReferenceTake {
  return typeof value === 'string' && (REFERENCE_TAKES as readonly string[]).includes(value);
}

export function normalizeReferenceTakes(value: unknown): ReferenceTake[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',').map((item) => item.trim()) : [];
  const takes = REFERENCE_TAKES.filter((take) => list.includes(take));
  return takes.length ? takes : ['structure'];
}

const text = (value: unknown, limit: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '');
const count = (value: unknown, max = 100_000) => {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
  return Math.max(0, Math.min(max, number));
};
const REGION_NAMES = new Set(['header', 'nav', 'main', 'aside', 'footer', 'form', 'section', 'dialog', 'search']);
const FIELD_TYPE = /^[a-z][a-z-]{0,23}$/;

/**
 * An outline as it is kept. The outline is read from a page the person browsed, so it is untrusted: only the known
 * shape is kept, every string is cut to a short label and every list to a small count.
 */
export function normalizeReferenceOutline(value: unknown): ReferenceOutline | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const regions = (Array.isArray(raw.regions) ? raw.regions : [])
    .map((region) => text(region, 16).toLowerCase())
    .filter((region) => REGION_NAMES.has(region))
    .slice(0, REFERENCE_LIMITS.regions);
  const headings = (Array.isArray(raw.headings) ? raw.headings : [])
    .map((item) => (item && typeof item === 'object' ? item as Record<string, unknown> : {}))
    .map((item) => ({ level: count(item.level, 99), count: count(item.count, 10_000) }))
    .filter((item) => item.level >= 1 && item.level <= 6 && item.count > 0)
    .sort((a, b) => a.level - b.level)
    .filter((item, index, all) => all.findIndex((other) => other.level === item.level) === index);
  const forms = (Array.isArray(raw.forms) ? raw.forms : []).slice(0, REFERENCE_LIMITS.forms).map((form) => {
    const item = form && typeof form === 'object' ? form as Record<string, unknown> : {};
    const fields = (Array.isArray(item.fields) ? item.fields : []).slice(0, REFERENCE_LIMITS.fields).map((field) => {
      const entry = field && typeof field === 'object' ? field as Record<string, unknown> : {};
      const type = text(entry.type, 24).toLowerCase();
      return { type: FIELD_TYPE.test(type) ? type : 'text', label: text(entry.label, REFERENCE_LIMITS.label), required: entry.required === true };
    });
    return { fields, buttons: count(item.buttons, 1000) };
  }).filter((form) => form.fields.length > 0 || form.buttons > 0);
  const tables = (Array.isArray(raw.tables) ? raw.tables : []).slice(0, REFERENCE_LIMITS.tables).map((table) => {
    const item = table && typeof table === 'object' ? table as Record<string, unknown> : {};
    return {
      columns: (Array.isArray(item.columns) ? item.columns : []).slice(0, REFERENCE_LIMITS.columns).map((column) => text(column, REFERENCE_LIMITS.label)),
      rows: count(item.rows),
    };
  }).filter((table) => table.columns.length > 0 || table.rows > 0);
  const controls = raw.controls && typeof raw.controls === 'object' ? raw.controls as Record<string, unknown> : {};
  const viewport = raw.viewport && typeof raw.viewport === 'object' ? raw.viewport as Record<string, unknown> : null;
  const width = count(viewport?.width, 20_000);
  const height = count(viewport?.height, 20_000);
  return {
    regions,
    headings,
    forms,
    tables,
    controls: { links: count(controls.links), buttons: count(controls.buttons), inputs: count(controls.inputs), images: count(controls.images) },
    viewport: width > 0 && height > 0 ? { width, height } : null,
  };
}

const TAKE_TEXT: Record<ReferenceTake, string> = {
  structure: 'layout structure (regions and their order)',
  flow: 'flow (steps, order of screens and actions)',
  fields: 'field composition (which inputs and columns, their types and grouping)',
  interaction: 'interaction (what responds to what, states and feedback)',
};

const attr = (value: string) => value.replace(/["\n\r<>]/g, "'");
/** Free text inside the block: angle brackets are replaced so no text can open or close an element of the block. */
const inline = (value: string) => value.replace(/</g, '‹').replace(/>/g, '›');

/** The outline as short lines for a prompt; labels are quoted, nothing else from the page is. */
export function referenceOutlineLines(outline: ReferenceOutline): string[] {
  const lines: string[] = [];
  if (outline.viewport) lines.push(`viewport: ${outline.viewport.width}×${outline.viewport.height}`);
  if (outline.regions.length) lines.push(`regions: ${outline.regions.join(' > ')}`);
  if (outline.headings.length) lines.push(`headings: ${outline.headings.map((item) => `h${item.level}×${item.count}`).join(', ')}`);
  outline.forms.forEach((form, index) => {
    const fields = form.fields.map((field) => `${field.type}${field.label ? ` "${field.label.replace(/"/g, "'")}"` : ''}${field.required ? ' (required)' : ''}`);
    lines.push(`form ${index + 1}: ${fields.join(', ') || 'no fields'}; ${form.buttons} button${form.buttons === 1 ? '' : 's'}`);
  });
  outline.tables.forEach((table, index) => {
    lines.push(`table ${index + 1}: ${table.columns.length} columns${table.columns.length ? ` (${table.columns.join(', ')})` : ''}, ${table.rows} rows`);
  });
  const { links, buttons, inputs, images } = outline.controls;
  if (links + buttons + inputs + images > 0) lines.push(`controls: ${links} links, ${buttons} buttons, ${inputs} inputs, ${images} images`);
  return lines;
}

export const REFERENCE_APPLY_RULES = [
  'Rebuild the pattern in this project\'s own code, components and styles; do not paste markup or CSS from the reference.',
  'Do not copy text, images, icons, logos, brand colours or fonts from the reference, and do not load anything from its site.',
  'The screenshot is a layout reference only. Labels in the outline show what a field is for; write this project\'s own wording.',
  'If the reference needs a login or blocks automated access, do not try to get around it; work from what is here.',
];

/**
 * The block the composer and `monofield refs apply` quote: the request, the target, the rules, then each reference
 * with its URL, the person's note, what to take, the screenshot path and the outline.
 */
export function referenceApplyBlock(items: Array<ReferenceItem & { screenshotState?: ReferenceScreenshotState }>, options: {
  target?: string; request?: string; takes?: ReferenceTake[]; includeScreenshot?: boolean;
} = {}): string {
  const target = text(options.target, REFERENCE_LIMITS.target);
  const request = typeof options.request === 'string' ? options.request.trim().slice(0, REFERENCE_LIMITS.request) : '';
  const lines = [`<reference-board-apply${target ? ` target="${attr(target)}"` : ''} references="${items.length}">`];
  lines.push(`request: ${request ? inline(request) : 'Apply the pattern of the selected references to the target.'}`);
  if (target) lines.push(`target: ${inline(target)}`);
  lines.push('rules:', ...REFERENCE_APPLY_RULES.map((rule) => `- ${rule}`));
  for (const item of items) {
    const takes = options.takes?.length ? options.takes : item.takes;
    lines.push('', `<reference id="${attr(item.id)}" url="${attr(item.url)}" captured="${attr(item.capturedAt)}">`);
    if (item.title) lines.push(`title: ${inline(item.title)}`);
    if (item.note) lines.push(`note: ${inline(item.note)}`);
    lines.push(`take: ${takes.map((take) => TAKE_TEXT[take]).join('; ')}`);
    if (item.screenshot && options.includeScreenshot !== false) {
      const state = item.screenshotState ?? 'verified';
      lines.push(state === 'verified'
        ? `screenshot: ${inline(item.screenshot.file)} (sha256 verified) — layout reference only`
        : state === 'changed' ? `screenshot: ${inline(item.screenshot.file)} (changed since it was kept; check it before relying on it)`
          : `screenshot: ${inline(item.screenshot.file)} (missing)`);
    }
    if (item.outline) lines.push(...referenceOutlineLines(item.outline).map(inline));
    else lines.push('outline: not captured');
    lines.push('</reference>');
  }
  lines.push('</reference-board-apply>');
  return lines.join('\n');
}
