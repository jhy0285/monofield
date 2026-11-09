import type { ReaBrowserStep, ReaBrowserView } from './rea-evidence.js';

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
  /** The last flow recorded with REA for this reference, if any. */
  flow?: ReferenceFlowSummary | null;
  /** The project's own screen recorded with the same steps and compared with {@link flow}. */
  remake?: ReferenceRemake | null;
}

export type ReferenceCompareDifference = 'action' | 'status' | 'navigation' | 'calls' | 'structure';

/** One side of a compared step, as patterns: no text, no concrete paths. */
export interface ReferenceCompareSide {
  status: string;
  /** The page path changed during this step. */
  navigated: boolean;
  /** API calls of the step as `METHOD 2xx`, sorted. */
  calls: string[];
}

export interface ReferenceCompareRow {
  position: number;
  id: string;
  label: string;
  verdict: 'pass' | 'fail' | 'missing' | 'extra';
  differences: ReferenceCompareDifference[];
  reference: ReferenceCompareSide | null;
  ours: ReferenceCompareSide | null;
  /** Kinds of screen elements (accessibility roles) present on one side only after the step. */
  onlyReference: string[];
  onlyOurs: string[];
}

export interface ReferenceFlowComparison {
  rows: ReferenceCompareRow[];
  summary: { pass: number; fail: number; missing: number; extra: number; total: number };
}

export interface ReferenceRemake {
  /** The project's screen that was recorded. */
  url: string;
  flow: ReferenceFlowSummary;
  comparison: ReferenceFlowComparison;
  comparedAt: string;
}

export interface ReferenceCompareRequest {
  url: string;
  /** Defaults to the steps the reference's flow was recorded with. */
  steps?: ReferenceFlowStep[];
  browserPath?: string;
}

export interface ReferenceCompareResponse {
  item: ReferenceItem;
  remake: ReferenceRemake;
  /** The differences as a request for the agent (empty when every step matched). */
  block: string;
}

/**
 * One step of a flow recorded with REA, in the person's terms: press a button, link, tab, checkbox or radio by its
 * visible name, type a public value into a field by its label, wait for a text to appear, or wait a moment.
 */
export type ReferenceFlowStep =
  | { kind: 'click'; target: string; role?: ReferenceFlowClickRole }
  | { kind: 'fill'; target: string; value: string }
  | { kind: 'wait-text'; target: string }
  | { kind: 'wait'; ms: number };
export type ReferenceFlowClickRole = 'button' | 'link' | 'tab' | 'menuitem' | 'checkbox' | 'radio';
export const REFERENCE_FLOW_CLICK_ROLES: readonly ReferenceFlowClickRole[] = ['button', 'link', 'tab', 'menuitem', 'checkbox', 'radio'];

export interface ReferenceFlowSummary {
  /** The REA evidence file, project-relative (`references/<id>.flow.json`); REA Studio opens it. */
  file: string;
  evidenceId: string;
  sha256: string;
  recordedAt: string;
  /** The browser executable's file name (not its path). */
  browser: string;
  /** `request` is the step as it was asked for, so screens can describe it in their own language. */
  steps: Array<{ id: string; label: string; status: string; error?: string; request?: ReferenceFlowStep }>;
  completed: number;
  total: number;
  /** The last screen REA captured, saved beside the evidence (`references/<id>.flow.png`), when its hash matched. */
  screenshot?: string;
  /** API calls seen during the flow, with identifiers generalized (`/orders/{id}`), at most 30. */
  apiCalls: Array<{ method: string; path: string; status: number | null }>;
  completeness: string;
}

export interface ReferenceFlowRequest {
  steps?: ReferenceFlowStep[];
  /** An absolute path to a Chromium-family browser; otherwise the one the REA setup check finds. */
  browserPath?: string;
}

export interface ReferenceFlowResponse {
  item: ReferenceItem;
  flow: ReferenceFlowSummary;
}

export interface ReferenceFlowAgentRequestResponse {
  text: string;
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
  flowSteps: 12,
  flowTarget: 120,
  flowValue: 500,
  flowWaitMs: 10_000,
  flowStepTimeoutMs: 10_000,
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

/** Fields a recorded flow never types into: a flow must not carry credentials or payment data. */
const SENSITIVE_FIELD = /pass(?:word|wd|code)?|pwd|비밀번호|패스워드|암호|otp|인증\s*번호|card|카드\s*번호|cvc|cvv|주민|ssn|secret|token/i;

/** Validated steps, or why they are refused. No steps means "open the page and let it settle". */
export function normalizeReferenceFlowSteps(value: unknown): { ok: true; steps: ReferenceFlowStep[] } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, steps: [] };
  if (!Array.isArray(value)) return { ok: false, error: 'steps must be a list.' };
  if (value.length > REFERENCE_LIMITS.flowSteps) return { ok: false, error: `A flow has at most ${REFERENCE_LIMITS.flowSteps} steps.` };
  const steps: ReferenceFlowStep[] = [];
  for (const [index, raw] of value.entries()) {
    const step = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const target = typeof step.target === 'string' ? step.target.replace(/\s+/g, ' ').trim() : '';
    const where = `Step ${index + 1}`;
    if (step.kind === 'wait') {
      const ms = typeof step.ms === 'number' && Number.isFinite(step.ms) ? Math.round(step.ms) : NaN;
      if (!(ms >= 100 && ms <= REFERENCE_LIMITS.flowWaitMs)) return { ok: false, error: `${where}: wait between 100 and ${REFERENCE_LIMITS.flowWaitMs} ms.` };
      steps.push({ kind: 'wait', ms });
      continue;
    }
    if (step.kind !== 'click' && step.kind !== 'fill' && step.kind !== 'wait-text') return { ok: false, error: `${where}: unknown kind.` };
    if (!target || target.length > REFERENCE_LIMITS.flowTarget) return { ok: false, error: `${where}: name the button, field or text (at most ${REFERENCE_LIMITS.flowTarget} characters).` };
    if (step.kind === 'click') {
      const role = step.role === undefined ? 'button' : step.role;
      if (!(REFERENCE_FLOW_CLICK_ROLES as readonly unknown[]).includes(role)) return { ok: false, error: `${where}: unknown control type.` };
      steps.push({ kind: 'click', target, role: role as ReferenceFlowClickRole });
    } else if (step.kind === 'fill') {
      const text = typeof step.value === 'string' ? step.value : '';
      if (text.length > REFERENCE_LIMITS.flowValue) return { ok: false, error: `${where}: the value is longer than ${REFERENCE_LIMITS.flowValue} characters.` };
      if (SENSITIVE_FIELD.test(target)) return { ok: false, error: `${where}: a recorded flow does not type into password, verification, card or ID fields.` };
      steps.push({ kind: 'fill', target, value: text });
    } else steps.push({ kind: 'wait-text', target });
  }
  return { ok: true, steps };
}

/** How a step reads in the board and in prompts. */
export function referenceFlowStepLabel(step: ReferenceFlowStep): string {
  if (step.kind === 'click') return `press ${step.role ?? 'button'} "${step.target}"`;
  if (step.kind === 'fill') return `type into "${step.target}"`;
  if (step.kind === 'wait-text') return `wait for "${step.target}"`;
  return `wait ${step.ms} ms`;
}

/**
 * The REA `capture_browser_scenario` input for a reference: a fresh temporary browser profile (so nothing signed in
 * is reused), the person's steps with a per-step deadline, a screenshot and accessibility snapshot after each step,
 * network and page errors with response bodies. Values typed into fields are public literals; no secrets are declared.
 */
export function referenceFlowScenario(url: string, steps: ReferenceFlowStep[], browserPath: string): Record<string, unknown> {
  const timeout = REFERENCE_LIMITS.flowStepTimeoutMs;
  const actions = steps.length === 0
    ? [{ step_id: 'page-settled', action: 'wait_for_timeout', duration_ms: 1500 }]
    : steps.map((step, index) => {
      const step_id = `step-${index + 1}`;
      if (step.kind === 'wait') return { step_id, action: 'wait_for_timeout', duration_ms: step.ms };
      if (step.kind === 'click') return { step_id, action: 'click', locator: { kind: 'role', role: step.role ?? 'button', name: step.target }, timeout_ms: timeout };
      if (step.kind === 'fill') return { step_id, action: 'fill', locator: { kind: 'role', role: 'textbox', name: step.target }, value: { source: 'literal', value: step.value }, timeout_ms: timeout };
      return { step_id, action: 'wait_for', locator: { kind: 'css', selector: `text=${JSON.stringify(step.target)}` }, state: 'visible', timeout_ms: timeout };
    });
  return {
    browser: { mode: 'launch', executable_path: browserPath, headless: true },
    start_url: { url, query: [] },
    environment: { viewport: { width: 1280, height: 720, device_scale_factor: 1 }, locale: 'ko-KR', timezone: 'Asia/Seoul', color_scheme: 'light', reduced_motion: 'reduce', service_workers: 'block' },
    actions,
    capture: {
      after_each_step: ['screenshot', 'accessibility'],
      at_end: ['url'],
      events: ['network', 'page-errors'],
      network: { request_body: true, response_body: true, header_values: false },
    },
  };
}

/** The flow as short lines for a prompt or the CLI. */
export function referenceFlowLines(flow: ReferenceFlowSummary): string[] {
  const lines = [`flow: ${flow.file} (REA evidence ${flow.evidenceId}, ${flow.completed}/${flow.total} steps, capture ${flow.completeness}) — open it in REA Studio for screens and API bodies`];
  flow.steps.forEach((step, index) => lines.push(`  ${index + 1}. ${step.label} → ${step.status}${step.error ? ` (${step.error})` : ''}`));
  if (flow.screenshot) lines.push(`last screen: ${flow.screenshot} — layout reference only`);
  if (flow.apiCalls.length) lines.push(`api: ${flow.apiCalls.map((call) => `${call.method} ${call.path} → ${call.status ?? 'no response'}`).join('; ')}`);
  return lines;
}

/**
 * For flows the step editor cannot express (a signed-in screen, a long wizard): a request for the agent to record it
 * with the REA MCP tools, under the same rules.
 */
export function referenceFlowAgentRequest(item: ReferenceItem, steps: ReferenceFlowStep[], request?: string): string {
  const lines = [`<reference-flow-request id="${attr(item.id)}" url="${attr(item.url)}">`];
  lines.push(`request: ${request?.trim() ? inline(request.trim().slice(0, REFERENCE_LIMITS.request)) : 'Record how this page behaves so its flow can be rebuilt in this project.'}`);
  lines.push('how: use the REA MCP tool capture_browser_scenario with a screenshot and accessibility snapshot after each step and network events with response bodies.');
  lines.push(`save: the evidence JSON as ${REFERENCE_BOARD_FOLDER}/${item.id}.flow.json in this project, then summarize the steps and API calls.`);
  if (steps.length) {
    lines.push('steps:');
    steps.forEach((step, index) => lines.push(`  ${index + 1}. ${inline(referenceFlowStepLabel(step))}${step.kind === 'fill' ? ` with "${inline(step.value)}"` : ''}`));
  } else lines.push('steps: open the page, decide the steps that show its main flow, and tell me what you chose.');
  lines.push('rules:',
    '- Do not sign in, create accounts, solve CAPTCHAs or get around bot protection; if the flow needs that, stop and tell me.',
    '- Do not type passwords, verification codes, card numbers or personal data; do not submit orders, payments or messages.',
    '- Record the pattern only; do not copy text, images, logos or branding into this project.');
  if (item.note) lines.push(`note: ${inline(item.note)}`);
  lines.push('</reference-flow-request>');
  return lines.join('\n');
}

/** Accessibility roles that say nothing about a screen's pattern. */
const NOISE_ROLES = new Set(['document', 'generic', 'text', 'paragraph', 'group', 'none', 'presentation', 'img', 'separator', 'strong', 'emphasis']);

/** The kinds of elements in a Playwright accessibility snapshot (`- button "조회"` → `button`), without their names. */
export function accessibilityRoles(snapshot: string): string[] {
  const roles = new Set<string>();
  for (const line of snapshot.split('\n')) {
    const match = /^\s*-\s+([a-z][a-z-]*)\b/.exec(line);
    if (match && !NOISE_ROLES.has(match[1]!)) roles.add(match[1]!);
  }
  return [...roles].sort();
}

const pathOf = (url: string | null) => {
  if (!url) return null;
  try { return new URL(url).pathname; } catch { return url.split(/[?#]/)[0] ?? url; }
};
const statusClass = (status: number | null) => (status === null || status === 0 ? 'no response' : `${Math.floor(status / 100)}xx`);

function sides(view: ReaBrowserView): Map<string, { step: ReaBrowserStep; side: ReferenceCompareSide; roles: string[] | null; position: number }> {
  const steps = [...view.steps].sort((a, b) => a.index - b.index);
  const out = new Map<string, { step: ReaBrowserStep; side: ReferenceCompareSide; roles: string[] | null; position: number }>();
  steps.forEach((step, position) => {
    const previous = position > 0 ? pathOf(steps[position - 1]!.url) : null;
    const current = pathOf(step.url);
    const calls = view.requests.filter((request) => request.stepIndex === step.index && request.isApi)
      .map((request) => `${request.method} ${statusClass(request.status)}`).sort();
    const accessibility = step.accessibility;
    const roles = accessibility && accessibility.state === 'captured' && typeof accessibility.text === 'string' && !accessibility.truncated
      ? accessibilityRoles(accessibility.text) : null;
    out.set(step.id || `#${position}`, { step, position, roles, side: { status: step.status, navigated: position === 0 || (previous !== null && current !== null && previous !== current), calls } });
  });
  return out;
}

/**
 * The reference's recorded flow next to the project's own screen recorded with the same steps, compared as patterns:
 * whether each step could be done, whether it moved to another page, the API calls it made (method and status class,
 * not paths), and the kinds of elements on the screen after it (roles, not names). Text, paths and styling are expected
 * to differ and are not compared.
 */
export function compareReferenceFlows(reference: ReaBrowserView, ours: ReaBrowserView, labels: Record<string, string> = {}): ReferenceFlowComparison {
  const left = sides(reference);
  const right = sides(ours);
  const ids = [...left.keys()];
  for (const id of right.keys()) if (!left.has(id)) ids.push(id);
  const rows: ReferenceCompareRow[] = ids.map((id, position) => {
    const a = left.get(id);
    const b = right.get(id);
    const label = labels[id] ?? (id === 'scenario_start' ? 'open the page' : id === 'page-settled' ? 'let the page settle' : id);
    if (!a || !b) {
      return { position, id, label, verdict: a ? 'missing' : 'extra', differences: [], reference: a?.side ?? null, ours: b?.side ?? null, onlyReference: [], onlyOurs: [] };
    }
    const differences: ReferenceCompareDifference[] = [];
    if (a.step.action !== b.step.action) differences.push('action');
    if (a.side.status !== b.side.status) differences.push('status');
    if (a.side.navigated !== b.side.navigated) differences.push('navigation');
    if (a.side.calls.join(',') !== b.side.calls.join(',')) differences.push('calls');
    let onlyReference: string[] = [];
    let onlyOurs: string[] = [];
    if (a.roles && b.roles) {
      onlyReference = a.roles.filter((role) => !b.roles!.includes(role)).slice(0, 12);
      onlyOurs = b.roles.filter((role) => !a.roles!.includes(role)).slice(0, 12);
      if (onlyReference.length || onlyOurs.length) differences.push('structure');
    }
    return { position, id, label, verdict: differences.length ? 'fail' : 'pass', differences, reference: a.side, ours: b.side, onlyReference, onlyOurs };
  });
  const count = (verdict: ReferenceCompareRow['verdict']) => rows.filter((row) => row.verdict === verdict).length;
  return { rows, summary: { pass: count('pass'), fail: count('fail'), missing: count('missing'), extra: count('extra'), total: rows.length } };
}

const sideText = (side: ReferenceCompareSide | null) => side
  ? `${side.status}${side.navigated ? ', moved to another page' : ''}, ${side.calls.length ? side.calls.join(' + ') : 'no API call'}`
  : 'not recorded';

/** The comparison as short lines: the totals, then every step that did not match. */
export function referenceComparisonLines(remake: ReferenceRemake): string[] {
  const { summary } = remake.comparison;
  const lines = [`our screen: ${remake.url} (${remake.flow.file}) — ${summary.pass}/${summary.total} steps match the reference's pattern`];
  for (const row of remake.comparison.rows.filter((entry) => entry.verdict !== 'pass')) {
    lines.push(`  ${row.position + 1}. ${row.label}: ${row.verdict}${row.differences.length ? ` (${row.differences.join(', ')})` : ''}`);
    lines.push(`     reference: ${sideText(row.reference)}`);
    lines.push(`     ours:      ${sideText(row.ours)}`);
    if (row.onlyReference.length) lines.push(`     only on the reference's screen: ${row.onlyReference.join(', ')}`);
    if (row.onlyOurs.length) lines.push(`     only on our screen: ${row.onlyOurs.join(', ')}`);
  }
  return lines;
}

/**
 * The differences as a request for the agent: make our screen follow the reference's pattern where it does not, in
 * this project's own code and wording. Empty when nothing differs.
 */
export function referenceComparisonBlock(item: ReferenceItem): string {
  const remake = item.remake;
  if (!remake || remake.comparison.rows.every((row) => row.verdict === 'pass')) return '';
  const lines = [`<reference-flow-comparison id="${attr(item.id)}" reference="${attr(item.url)}" ours="${attr(remake.url)}">`];
  lines.push('request: Our screen does not yet follow the reference\'s flow at the steps below. Change our screen so each of them behaves like the reference: the same step can be done, it moves (or stays) like the reference, it makes the same kind of server call with the same kind of result, and the same kinds of elements appear.');
  lines.push('rules:', ...REFERENCE_APPLY_RULES.map((rule) => `- ${rule}`), '- Compare against the recorded evidence; do not guess behaviour the evidence does not show.');
  lines.push(...referenceComparisonLines(remake).map(inline));
  lines.push(`evidence: reference ${item.flow?.file ?? '(not recorded)'}; ours ${remake.flow.file} — open both in REA Studio`);
  lines.push('</reference-flow-comparison>');
  return lines.join('\n');
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
    if (item.flow) lines.push(...referenceFlowLines(item.flow).map(inline));
    if (item.remake) lines.push(...referenceComparisonLines(item.remake).map(inline));
    lines.push('</reference>');
  }
  lines.push('</reference-board-apply>');
  return lines.join('\n');
}
