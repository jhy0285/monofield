import {
  REA_COMPARE_ROW_LIMIT,
  type ReaBrowserComparison,
  type ReaBrowserStep,
  type ReaBrowserView,
  type ReaCaseComparison,
  type ReaCaseRow,
  type ReaCompareCall,
  type ReaCompareStepRow,
  type ReaCompareStepSide,
  type ReaCompareSummary,
  type ReaCompareVerdict,
  type ReaComparison,
  type ReaEvidenceView,
  type ReaStepDifference,
} from '@open-design/contracts';
import { BrowserEvidenceError, type BrowserEvidenceFileAccess } from './browser-evidence.js';
import { isDocumentPath } from './project-document-graph.js';
import { buildReaEvidenceView, htmlText } from './rea-evidence.js';

/**
 * An original next to its remake. Two REA browser captures of the same scenario are compared step by step (action,
 * result, page, API calls, visible text); two case-result files are compared case by case (same input, same output).
 * The verdict says only whether the recorded behaviour matched: a capture shows what was observed in that run, so a
 * pass is not a proof that the remake behaves the same everywhere.
 */
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TEXT_LINES = 20;
const VALUE_LIMIT = 200;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** `/api/orders/1001/settle` → `/api/orders/{n}/settle`: IDs differ between two runs of the same scenario. */
export function routeOf(pathname: string): string {
  return pathname.split('/').map((segment) => (/^\d+$/.test(segment) ? '{n}'
    : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) || /^[0-9a-f]{12,}$/i.test(segment) ? '{id}' : segment)).join('/');
}

function pagePath(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).pathname; } catch { return url.split(/[?#]/)[0] ?? url; }
}

const side = (step: ReaBrowserStep): ReaCompareStepSide => ({ index: step.index, id: step.id, action: step.action, status: step.status, path: pagePath(step.url) });

const captured = (payload: ReaBrowserStep['dom']) => (payload && payload.state === 'captured' && payload.text !== undefined && !payload.truncated ? payload.text : null);
const lines = (value: string) => value.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);

/** The lines a screen is compared by: the accessibility snapshot when both sides have one, else the HTML's text. */
function screenLines(left: ReaBrowserStep, right: ReaBrowserStep): { source: 'accessibility' | 'dom'; left: string[]; right: string[] } | null {
  const a = captured(left.accessibility); const b = captured(right.accessibility);
  if (a !== null && b !== null) return { source: 'accessibility', left: lines(a).map((line) => line.replace(/^- /, '')), right: lines(b).map((line) => line.replace(/^- /, '')) };
  const c = captured(left.dom); const d = captured(right.dom);
  if (c !== null && d !== null) return { source: 'dom', left: lines(htmlText(c)), right: lines(htmlText(d)) };
  return null;
}

/** Lines of `a` not matched by a line of `b`, counting repeats. */
function unmatched(a: string[], b: string[]): string[] {
  const left = new Map<string, number>();
  for (const line of b) left.set(line, (left.get(line) ?? 0) + 1);
  const out: string[] = [];
  for (const line of a) {
    const count = left.get(line) ?? 0;
    if (count > 0) left.set(line, count - 1); else out.push(line);
  }
  return out;
}

function callsOf(view: ReaBrowserView, step: ReaBrowserStep | undefined): Map<string, { method: string; route: string; statuses: number[] }> {
  const calls = new Map<string, { method: string; route: string; statuses: number[] }>();
  if (!step) return calls;
  for (const request of view.requests) {
    if (request.stepIndex !== step.index || !request.isApi) continue;
    const route = routeOf(request.path);
    const key = `${request.method} ${route}`;
    const entry = calls.get(key) ?? { method: request.method, route, statuses: [] };
    entry.statuses.push(request.status ?? 0);
    calls.set(key, entry);
  }
  return calls;
}

const screenshotOk = (step: ReaBrowserStep | undefined) => Boolean(step?.screenshot && step.screenshot.state === 'captured-binary');

function compareSteps(original: ReaBrowserView, remake: ReaBrowserView, compareText: boolean): ReaCompareStepRow[] {
  const a = [...original.steps].sort((x, y) => x.index - y.index);
  const b = [...remake.steps].sort((x, y) => x.index - y.index);
  // Pair by step ID when the two runs mostly share them (the same scenario replayed); otherwise by position.
  const ids = new Set(b.map((step) => step.id).filter(Boolean));
  const shared = a.filter((step) => step.id && ids.has(step.id)).length;
  const pairs: Array<[ReaBrowserStep | undefined, ReaBrowserStep | undefined]> = [];
  if (shared * 2 >= Math.max(a.length, b.length) && shared > 0) {
    const byId = new Map(b.map((step) => [step.id, step]));
    const used = new Set<ReaBrowserStep>();
    for (const step of a) {
      const match = step.id ? byId.get(step.id) : undefined;
      if (match && !used.has(match)) { used.add(match); pairs.push([step, match]); } else pairs.push([step, undefined]);
    }
    for (const step of b) if (!used.has(step)) pairs.push([undefined, step]);
  } else {
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) pairs.push([a[i], b[i]]);
  }

  return pairs.map(([left, right], position) => {
    const differences: ReaStepDifference[] = [];
    const leftCalls = callsOf(original, left);
    const rightCalls = callsOf(remake, right);
    const calls: ReaCompareCall[] = [...new Set([...leftCalls.keys(), ...rightCalls.keys()])].map((key) => {
      const l = leftCalls.get(key); const r = rightCalls.get(key);
      const statuses = { original: l?.statuses ?? [], remake: r?.statuses ?? [] };
      return { method: (l ?? r)!.method, route: (l ?? r)!.route, ...statuses, same: statuses.original.join(',') === statuses.remake.join(',') };
    });
    let text: ReaCompareStepRow['text'] = { compared: false, source: null, onlyOriginal: [], onlyRemake: [] };
    let verdict: ReaCompareVerdict;
    if (left && right) {
      if (left.action !== right.action) differences.push('action');
      if (left.status !== right.status) differences.push('status');
      const leftPath = pagePath(left.url); const rightPath = pagePath(right.url);
      if (leftPath !== null && rightPath !== null && routeOf(leftPath) !== routeOf(rightPath)) differences.push('url');
      if (calls.some((call) => !call.same)) differences.push('calls');
      const screen = compareText ? screenLines(left, right) : null;
      if (screen) {
        const onlyOriginal = unmatched(screen.left, screen.right); const onlyRemake = unmatched(screen.right, screen.left);
        text = { compared: true, source: screen.source, onlyOriginal: onlyOriginal.slice(0, MAX_TEXT_LINES), onlyRemake: onlyRemake.slice(0, MAX_TEXT_LINES) };
        if (onlyOriginal.length || onlyRemake.length) differences.push('text');
      }
      verdict = differences.length ? 'fail' : 'pass';
    } else verdict = left ? 'missing' : 'extra';
    return { position, original: left ? side(left) : null, remake: right ? side(right) : null, verdict, differences, calls, text,
      screenshots: { original: screenshotOk(left), remake: screenshotOk(right) } };
  });
}

/** Canonical JSON (sorted keys), used to match cases by input. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/** The JSON path of the first difference between two values, or null when they are equal (numbers within `tolerance`). */
export function firstDifference(a: unknown, b: unknown, tolerance: number, at = '$'): string | null {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= tolerance || (Number.isNaN(a) && Number.isNaN(b)) ? null : at;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return at;
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      if (i >= a.length || i >= b.length) return `${at}[${i}]`;
      const found = firstDifference(a[i], b[i], tolerance, `${at}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  if (isObject(a) || isObject(b)) {
    if (!isObject(a) || !isObject(b)) return at;
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const next = /^[A-Za-z_$][\w$]*$/.test(key) ? `${at}.${key}` : `${at}[${JSON.stringify(key)}]`;
      if (!(key in a) || !(key in b)) return next;
      const found = firstDifference(a[key], b[key], tolerance, next);
      if (found) return found;
    }
    return null;
  }
  return a === b ? null : at;
}

interface Case { key: string; input: unknown; hasInput: boolean; output: unknown }

function casesOf(value: unknown, file: string): Case[] | null {
  if (!isObject(value) || !Array.isArray(value.cases)) return null;
  return value.cases.map((item, index) => {
    if (!isObject(item) || !('output' in item)) throw new BrowserEvidenceError(`${file}: case ${index} has no "output".`);
    const id = typeof item.id === 'string' || typeof item.id === 'number' ? String(item.id) : '';
    return { key: id, input: item.input, hasInput: 'input' in item, output: item.output };
  });
}

const clip = (value: string, width: number) => (value.length > width ? `${value.slice(0, width - 1)}…` : value);

/** A comparison as text: the verdict counts, then every row that did not pass (and the passing ones with --json only). */
/** A comparison before its text report is attached; spelled out because `Omit` over a union drops the variants. */
type ComparisonBody = (ReaBrowserComparison | ReaCaseComparison) & { ok: true; original: string; remake: string; summary: ReaCompareSummary };

export function formatReaComparison(result: ComparisonBody): string {
  const { summary } = result;
  const lines = [`${result.original} → ${result.remake} (${result.kind === 'browser' ? 'browser steps' : 'cases'}): ${summary.pass}/${summary.total} pass · ${summary.fail} fail · ${summary.missing} missing in remake · ${summary.extra} only in remake`];
  if (result.kind === 'browser') {
    for (const row of result.steps) {
      const name = row.original ? `${row.original.index} ${row.original.id}` : `— ${row.remake?.id ?? ''}`;
      lines.push(`  ${row.verdict.padEnd(7)} step ${clip(name, 34).padEnd(34)}${row.differences.length ? ` ${row.differences.join(', ')}` : ''}`);
      if (row.differences.includes('action')) lines.push(`      action ${row.original?.action} → ${row.remake?.action}`);
      if (row.differences.includes('status')) lines.push(`      status ${row.original?.status} → ${row.remake?.status}`);
      if (row.differences.includes('url')) lines.push(`      page ${row.original?.path} → ${row.remake?.path}`);
      for (const call of row.calls.filter((item) => !item.same)) lines.push(`      ${call.method} ${call.route}: ${call.original.join(',') || 'none'} → ${call.remake.join(',') || 'none'}`);
      for (const line of row.text.onlyOriginal.slice(0, 5)) lines.push(`      - ${clip(line, 90)}`);
      for (const line of row.text.onlyRemake.slice(0, 5)) lines.push(`      + ${clip(line, 90)}`);
    }
    if (!result.textCompared) lines.push('  visible text was not compared (--no-text)');
  } else {
    if (result.tolerance) lines.push(`  numbers equal within ${result.tolerance}`);
    for (const row of result.rows.filter((item) => item.verdict !== 'pass').slice(0, 50)) {
      lines.push(`  ${row.verdict.padEnd(7)} ${clip(row.key, 40)}${row.at ? ` at ${row.at}` : ''}  ${clip(row.original ?? '—', 40)} → ${clip(row.remake ?? '—', 40)}`);
    }
    const shown = Math.min(50, summary.total - summary.pass);
    if (summary.total - summary.pass > shown) lines.push(`  … ${summary.total - summary.pass - shown} more (use --json)`);
    if (result.truncated) lines.push('  the JSON lists the first rows only');
  }
  return lines.join('\n');
}

const show = (value: unknown) => { const json = JSON.stringify(value) ?? 'undefined'; return json.length > VALUE_LIMIT ? `${json.slice(0, VALUE_LIMIT)}…` : json; };

function compareCases(original: Case[], remake: Case[], tolerance: number): { rows: ReaCaseRow[]; summary: ReaCompareSummary; truncated: boolean } {
  const all = [...original, ...remake];
  const mode = all.every((item) => item.key) ? 'id' : all.every((item) => item.hasInput) ? 'input' : 'position';
  const keyOf = (item: Case, index: number) => (mode === 'id' ? item.key : mode === 'input' ? canonical(item.input) : `#${index + 1}`);
  const remakeByKey = new Map<string, Case[]>();
  remake.forEach((item, index) => { const key = keyOf(item, index); remakeByKey.set(key, [...(remakeByKey.get(key) ?? []), item]); });
  const rows: ReaCaseRow[] = [];
  original.forEach((item, index) => {
    const key = keyOf(item, index);
    const label = mode === 'input' ? show(item.input) : key;
    const match = remakeByKey.get(key)?.shift();
    const input = item.hasInput ? show(item.input) : null;
    if (!match) { rows.push({ key: label, input, original: show(item.output), remake: null, verdict: 'missing' }); return; }
    const at = firstDifference(item.output, match.output, tolerance);
    rows.push({ key: label, input, original: show(item.output), remake: show(match.output), verdict: at ? 'fail' : 'pass', ...(at ? { at } : {}) });
  });
  for (const [key, rest] of remakeByKey) {
    for (const item of rest) rows.push({ key: mode === 'input' ? show(item.input) : key, input: item.hasInput ? show(item.input) : null, original: null, remake: show(item.output), verdict: 'extra' });
  }
  const summary = summarize(rows.map((row) => row.verdict));
  const order: Record<ReaCompareVerdict, number> = { fail: 0, missing: 1, extra: 2, pass: 3 };
  const sorted = rows.map((row, index) => ({ row, index })).sort((x, y) => order[x.row.verdict] - order[y.row.verdict] || x.index - y.index).map((entry) => entry.row);
  return { rows: sorted.slice(0, REA_COMPARE_ROW_LIMIT), summary, truncated: sorted.length > REA_COMPARE_ROW_LIMIT };
}

function summarize(verdicts: ReaCompareVerdict[]): ReaCompareSummary {
  const count = (verdict: ReaCompareVerdict) => verdicts.filter((item) => item === verdict).length;
  return { total: verdicts.length, pass: count('pass'), fail: count('fail'), missing: count('missing'), extra: count('extra') };
}

async function readJson(files: BrowserEvidenceFileAccess, file: string): Promise<{ name: string; buffer: Buffer; json: unknown }> {
  const read = await files.read(file);
  if (read.buffer.length > MAX_FILE_BYTES) throw new BrowserEvidenceError(`${file} exceeds the 64 MB limit.`);
  try { return { name: read.name, buffer: read.buffer, json: JSON.parse(read.buffer.toString('utf8')) }; } catch { throw new BrowserEvidenceError(`${file} is not JSON.`); }
}

const isReaBrowser = (json: unknown) => {
  const evidence = isObject(json) && isObject(json.evidence) ? json.evidence : json;
  return isObject(evidence) && (evidence.predicate_type === 'rea.browser-scenario-capture' || evidence.operation === 'capture_browser_scenario');
};

export async function compareReaFiles(files: BrowserEvidenceFileAccess, body: { original?: unknown; remake?: unknown; tolerance?: unknown; compareText?: unknown }): Promise<ReaComparison> {
  if (!isDocumentPath(body.original) || !isDocumentPath(body.remake)) throw new BrowserEvidenceError('original and remake must be project-relative JSON paths.');
  const tolerance = body.tolerance === undefined ? 0 : Number(body.tolerance);
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new BrowserEvidenceError('tolerance must be a number of at least 0.');
  const compareText = body.compareText !== false;
  const [original, remake] = await Promise.all([readJson(files, body.original), readJson(files, body.remake)]);
  if (isReaBrowser(original.json) && isReaBrowser(remake.json)) {
    const left = buildReaEvidenceView(original.buffer, original.name) as ReaEvidenceView & ReaBrowserView;
    const right = buildReaEvidenceView(remake.buffer, remake.name) as ReaEvidenceView & ReaBrowserView;
    const steps = compareSteps(left, right, compareText);
    const result = { ok: true as const, kind: 'browser' as const, original: original.name, remake: remake.name, steps, textCompared: compareText, summary: summarize(steps.map((step) => step.verdict)) };
    return { ...result, report: formatReaComparison(result) };
  }
  const leftCases = casesOf(original.json, original.name);
  const rightCases = casesOf(remake.json, remake.name);
  if (leftCases && rightCases) {
    const compared = { ok: true as const, kind: 'cases' as const, original: original.name, remake: remake.name, tolerance, ...compareCases(leftCases, rightCases, tolerance) };
    return { ...compared, report: formatReaComparison(compared) };
  }
  throw new BrowserEvidenceError('Compare two REA browser captures, or two case-result files ({ "cases": [{ "id", "input", "output" }] }); these two files are not the same kind.', 400, 'REA_COMPARE_MISMATCH');
}

/** Whether a JSON file is a case-result file, from its parsed content. */
export function isCaseResultFile(json: unknown): boolean {
  return isObject(json) && Array.isArray(json.cases) && json.cases.every((item) => isObject(item) && 'output' in item);
}
