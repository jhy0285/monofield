import { createHash } from 'node:crypto';
import path from 'node:path';
import type {
  ReaBrowserRequest,
  ReaBrowserView,
  ReaCitation,
  ReaCiteTarget,
  ReaEvidenceView,
  ReaPayload,
  ReaSqliteView,
  ReaStaticView,
  ReaTraceView,
} from '@open-design/contracts';
import { BrowserEvidenceError, type BrowserEvidenceFileAccess } from './browser-evidence.js';
import { isDocumentPath } from './project-document-graph.js';
import { accessibilityOutline, buildReaEvidenceView, htmlText } from './rea-evidence.js';

/**
 * A citation of one REA evidence item for a prompt: what it is, where it is in the file, and what REA recorded about
 * it. The web composer and `monofield rea cite` quote the same block, so an agent gets the same context either way.
 *
 * Captured values (bodies, DOM text, SQLite rows) are real application data. Unless the caller asks for them, a
 * citation carries their structure only (JSON keys and types), which is what rebuilding a screen or an API needs.
 */
const VALUE_EXCERPT = 1500;
const MAX_EVIDENCE_BYTES = 64 * 1024 * 1024;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const kb = (bytes: number | null) => (bytes === null ? '' : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`);
const attr = (value: string) => value.replace(/["\n\r]/g, "'");
const clip = (value: string, limit: number) => (value.length > limit ? `${value.slice(0, limit)}…` : value);
const indent = (value: string) => value.split('\n').map((line) => `  ${line}`).join('\n');

/** The structure of a JSON value: keys and types, never the values. */
export function jsonShape(value: unknown, depth = 0): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.length === 0 ? '[]' : depth >= 4 ? '[…]' : `[${jsonShape(value[0], depth + 1)}]`;
  if (typeof value === 'object') {
    if (depth >= 4) return '{…}';
    const entries = Object.entries(value as Json);
    if (entries.length === 0) return '{}';
    const shown = entries.slice(0, 25).map(([key, item]) => `${key}: ${jsonShape(item, depth + 1)}`);
    return `{ ${[...shown, ...(entries.length > 25 ? [`… ${entries.length - 25} more`] : [])].join(', ')} }`;
  }
  return typeof value;
}

function payloadLines(name: string, payload: ReaPayload, includeValues: boolean): string[] {
  const meta = [payload.mediaType, kb(payload.bytes)].filter(Boolean).join(', ');
  if (payload.state === 'integrity-failed') return [`${name}: hash does not match the recorded SHA-256, not quoted`];
  if (payload.state !== 'captured' && payload.state !== 'captured-binary') return [`${name}: not captured (${payload.state}${payload.reason ? `, ${payload.reason}` : ''})`];
  if (payload.state === 'captured-binary' || payload.text === undefined) return [`${name}: ${meta}, binary, sha256 verified`];
  let shape = '';
  if (!payload.truncated) {
    try { shape = jsonShape(JSON.parse(payload.text)); } catch { shape = ''; }
  }
  const lines = [`${name}: ${meta}, sha256 verified${shape ? ` — shape ${shape}` : payload.truncated ? ' — over the display limit, shape not read' : ' — not JSON'}`];
  if (includeValues) lines.push(`${name} excerpt:`, indent(clip(payload.text, VALUE_EXCERPT)));
  return lines;
}

const callLine = (request: ReaBrowserRequest) => `  ${request.method} ${request.path} → ${request.status ?? request.failure ?? 'no response'}`;

function sourceLine(view: ReaEvidenceView): string {
  const envelope = view.envelope;
  return [`source: ${envelope.operation} (${envelope.predicate})`, `REA ${envelope.provider.id || envelope.provider.name} ${envelope.provider.version}`.trim(),
    envelope.confidence ? `confidence ${envelope.confidence}` : '', envelope.authority ? `authority ${envelope.authority}` : ''].filter(Boolean).join(' · ');
}

interface Item { pointer: string; label: string; lines: string[] }

function browserItem(view: ReaBrowserView, target: ReaCiteTarget, includeValues: boolean): Item {
  if (target.kind === 'step') {
    const step = view.steps.find((item) => item.index === target.index);
    if (!step) throw new BrowserEvidenceError(`No step ${target.index} in this capture.`, 404, 'REA_ITEM_NOT_FOUND');
    const calls = view.requests.filter((request) => request.stepIndex === step.index && request.isApi);
    let page = '';
    if (step.url) { try { page = new URL(step.url).pathname; } catch { page = step.url; } }
    const lines = [
      `item: step ${step.index} "${step.id}" · ${step.action} · ${step.status}${step.elapsedMs === null ? '' : ` · ${step.elapsedMs} ms`}`,
      ...(step.url ? [`page: ${page} (${step.url})`] : []),
      ...(step.error ? [`error: ${step.error}`] : []),
      ...(calls.length ? ['API calls in this step:', ...calls.slice(0, 20).map(callLine), ...(calls.length > 20 ? [`  … ${calls.length - 20} more`] : [])] : ['API calls in this step: none recorded']),
    ];
    const snapshot = step.accessibility?.state === 'captured' ? step.accessibility.text : undefined;
    const html = step.dom?.state === 'captured' ? step.dom.text : undefined;
    if (snapshot !== undefined) {
      if (includeValues) lines.push('accessibility snapshot excerpt:', indent(clip(snapshot, VALUE_EXCERPT * 2)));
      else lines.push('screen outline (accessibility snapshot; names kept for headings and controls only, values off):', indent(accessibilityOutline(snapshot)));
    }
    if (html !== undefined) {
      if (includeValues) lines.push('visible text excerpt (from the captured HTML):', indent(clip(htmlText(html), VALUE_EXCERPT)));
      else lines.push('page HTML: captured, not quoted (values off)');
    } else if (step.dom) lines.push(`page HTML: not available (${step.dom.state})`);
    return { pointer: `steps[step_index=${step.index}]`, label: `step ${step.index} ${step.id || step.action}`, lines };
  }
  if (target.kind === 'request') {
    const request = view.requests.find((item) => item.id === target.id);
    if (!request) throw new BrowserEvidenceError(`No request ${target.id} in this capture.`, 404, 'REA_ITEM_NOT_FOUND');
    const lines = [
      `item: ${request.method} ${request.path} → ${request.status ?? request.failure ?? 'no response'} (${request.resourceType}) · step ${request.stepIndex}`,
      ...(request.origin ? [`origin: ${request.origin}`] : []),
      ...(request.queryNames.length ? [`query parameter names: ${request.queryNames.join(', ')}`] : []),
      ...payloadLines('request body', request.request, includeValues),
      ...payloadLines('response body', request.response, includeValues),
    ];
    return { pointer: `events.items[transaction_id=${request.id}]`, label: `${request.method} ${request.path}`, lines };
  }
  if (target.kind === 'file') {
    const api = view.requests.filter((request) => request.isApi);
    return {
      pointer: 'normalized_result', label: `browser capture, ${view.steps.length} steps`,
      lines: [`item: the whole capture · ${view.steps.length} steps · ${view.requests.length} requests (${api.length} API) · completeness ${view.completeness.status}`,
        ...(view.origin ? [`origin: ${view.origin}`] : []),
        'steps:', ...view.steps.map((step) => `  ${step.index} ${step.id} · ${step.action} · ${step.status}`),
        ...(api.length ? ['API calls:', ...api.slice(0, 30).map(callLine), ...(api.length > 30 ? [`  … ${api.length - 30} more`] : [])] : [])],
    };
  }
  throw new BrowserEvidenceError(`A browser capture has steps and requests, not ${target.kind} items.`, 400, 'REA_ITEM_INVALID');
}

function sqliteItem(view: ReaSqliteView, target: ReaCiteTarget, includeValues: boolean): Item {
  if (target.kind === 'file') {
    return { pointer: 'schema', label: `SQLite schema, ${view.tables.length} tables`,
      lines: [`item: the whole schema · ${view.engine} · ${view.tables.length} tables · completeness ${view.completeness}`,
        ...view.tables.map((table) => `  ${table.name}(${table.columns.map((column) => column.name).join(', ')})`)] };
  }
  if (target.kind !== 'table') throw new BrowserEvidenceError(`A SQLite inspection has tables, not ${target.kind} items.`, 400, 'REA_ITEM_INVALID');
  const table = view.tables.find((item) => item.name === target.name);
  if (!table) throw new BrowserEvidenceError(`No table ${target.name} in this inspection.`, 404, 'REA_ITEM_NOT_FOUND');
  const lines = [
    `item: SQLite table ${table.name} · ${table.columns.length} columns · ${view.engine}`,
    'columns:',
    ...table.columns.map((column) => `  ${column.name} ${column.type || '(no type)'}${column.primaryKey ? ` PK${column.primaryKey}` : ''}${column.notNull ? ' NOT NULL' : ''}${column.defaultSql !== null ? ` DEFAULT ${column.defaultSql}` : ''}`),
    ...(table.foreignKeys.length ? [`foreign keys: ${table.foreignKeys.map((key) => `${key.column} → ${key.refTable}.${key.refColumn}`).join('; ')}`] : []),
    ...(table.unique.length ? [`unique: ${table.unique.join('; ')}`] : []),
    ...(table.checks.length ? [`checks: ${table.checks.join('; ')}`] : []),
    ...(table.indexes.length ? [`indexes: ${table.indexes.join(', ')}`] : []),
    'constraints are read from the CREATE TABLE text; they do not show what the connection enforced',
  ];
  if (table.rows) {
    if (includeValues) {
      lines.push(`rows (${table.rows.returned} returned${table.rows.truncated ? ', truncated' : ''}), first ${Math.min(5, table.rows.values.length)}:`);
      for (const row of table.rows.values.slice(0, 5)) lines.push(`  ${table.rows.columns.map((column, index) => `${column}=${clip(row[index] ?? '', 80)}`).join(', ')}`);
    } else lines.push(`rows: ${table.rows.returned} returned, not quoted (values off)`);
  }
  return { pointer: `schema.tables[name=${table.name}]`, label: `table ${table.name}`, lines };
}

function staticItem(view: ReaStaticView, target: ReaCiteTarget): Item {
  if (target.kind === 'file') {
    return { pointer: 'graph', label: `static analysis, ${view.nodeTotal} nodes`,
      lines: [`item: the whole analysis · ${view.nodeTotal} nodes · ${view.edgeTotal} edges · coverage ${view.applicationCoverage ?? 'unknown'} · ${view.semanticUnknowns} semantic unknowns`,
        ...view.statistics.slice(0, 12).map((stat) => `  ${stat.key}: ${stat.value}`)] };
  }
  if (target.kind !== 'node') throw new BrowserEvidenceError(`A static analysis has nodes, not ${target.kind} items.`, 400, 'REA_ITEM_INVALID');
  const node = view.nodes.find((item) => item.id === target.id);
  if (!node) throw new BrowserEvidenceError(`No node ${target.id} among the nodes shown for this analysis.`, 404, 'REA_ITEM_NOT_FOUND');
  const name = new Map(view.nodes.map((item) => [item.id, item.label]));
  const out = view.edges.filter((edge) => edge.from === node.id);
  const into = view.edges.filter((edge) => edge.to === node.id);
  return { pointer: `graph.nodes[node_id=${node.id}]`, label: `${node.kind} ${node.label}`, lines: [
    `item: ${node.kind} "${node.label}"`,
    ...(out.length ? ['links out:', ...out.slice(0, 20).map((edge) => `  ${edge.relation} → ${name.get(edge.to) ?? edge.to}`)] : []),
    ...(into.length ? ['links in:', ...into.slice(0, 20).map((edge) => `  ${name.get(edge.from) ?? edge.from} ${edge.relation} →`)] : []),
    ...(view.nodeTotal > view.nodes.length ? [`the screen shows ${view.nodes.length} of ${view.nodeTotal} nodes, so other links may exist`] : []),
  ] };
}

function traceItem(view: ReaTraceView, target: ReaCiteTarget): Item {
  if (target.kind === 'file') {
    return { pointer: 'paths', label: `trace of "${view.seed}"`,
      lines: [`item: trace of seed "${view.seed}" (${view.direction}) · ${view.status} · ${view.matches} matches · ${view.terminalPaths} terminal paths`,
        ...view.paths.slice(0, 10).map((steps, index) => `  path ${index + 1}: ${steps.join(' → ')}`)] };
  }
  if (target.kind !== 'path') throw new BrowserEvidenceError(`A trace has paths, not ${target.kind} items.`, 400, 'REA_ITEM_INVALID');
  const steps = view.paths[target.index];
  if (!steps) throw new BrowserEvidenceError(`No path ${target.index} in this trace.`, 404, 'REA_ITEM_NOT_FOUND');
  return { pointer: `paths[${target.index}]`, label: `path ${target.index + 1} of "${view.seed}"`,
    lines: [`item: path ${target.index + 1} of ${view.paths.length} for seed "${view.seed}" (${view.direction})`, `path: ${steps.join(' → ')}`] };
}

/** The verified bytes of a step's screenshot, read from the raw file (the screen's view may leave large images out). */
function stepScreenshot(buffer: Buffer, stepIndex: number): { bytes: Buffer; mediaType: string; sha256: string } | null {
  let parsed: unknown;
  try { parsed = JSON.parse(buffer.toString('utf8')); } catch { return null; }
  const evidence = isObject(parsed) && isObject(parsed.evidence) ? parsed.evidence : parsed;
  const result = isObject(evidence) && isObject(evidence.normalized_result) ? evidence.normalized_result : {};
  const step = (Array.isArray(result.steps) ? result.steps : []).find((item) => isObject(item) && Number(item.step_index) === stepIndex);
  const shot = isObject(step) && isObject(step.artifacts) && isObject(step.artifacts.screenshot) ? step.artifacts.screenshot : null;
  const value = shot && shot.state === 'captured' && isObject(shot.value) ? shot.value : null;
  if (!value || typeof value.data_base64 !== 'string' || typeof value.sha256 !== 'string') return null;
  const bytes = Buffer.from(value.data_base64, 'base64');
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== value.sha256.toLowerCase()) return null;
  return { bytes, mediaType: typeof value.media_type === 'string' ? value.media_type : 'image/png', sha256: digest };
}

function parseTarget(value: unknown): ReaCiteTarget {
  const target = isObject(value) ? value : {};
  switch (target.kind) {
    case 'file': return { kind: 'file' };
    case 'step': case 'path':
      if (typeof target.index === 'number' && Number.isInteger(target.index) && target.index >= 0) return { kind: target.kind, index: target.index };
      break;
    case 'request': case 'node':
      if (typeof target.id === 'string' && target.id) return { kind: target.kind, id: target.id };
      break;
    case 'table':
      if (typeof target.name === 'string' && target.name) return { kind: 'table', name: target.name };
      break;
    default: break;
  }
  throw new BrowserEvidenceError('target must be { kind: file } or a step, request, table, node or path with its index, id or name.', 400, 'REA_ITEM_INVALID');
}

/** Builds the citation for one item and, for a step with a verified screenshot, writes the image next to the evidence. */
export async function citeReaEvidence(files: BrowserEvidenceFileAccess, body: { file?: unknown; target?: unknown; includeValues?: unknown }): Promise<ReaCitation> {
  if (!isDocumentPath(body.file)) throw new BrowserEvidenceError('file must be a project-relative JSON path.');
  const target = parseTarget(body.target);
  const includeValues = body.includeValues === true;
  const read = await files.read(body.file);
  if (read.buffer.length > MAX_EVIDENCE_BYTES) throw new BrowserEvidenceError(`${body.file} exceeds the 64 MB evidence limit.`);
  const view = buildReaEvidenceView(read.buffer, read.name);
  const item = view.kind === 'browser' ? browserItem(view as ReaEvidenceView & ReaBrowserView, target, includeValues)
    : view.kind === 'sqlite' ? sqliteItem(view as ReaEvidenceView & ReaSqliteView, target, includeValues)
      : view.kind === 'static' ? staticItem(view as ReaEvidenceView & ReaStaticView, target)
        : view.kind === 'trace' ? traceItem(view as ReaEvidenceView & ReaTraceView, target)
          : target.kind === 'file' ? { pointer: 'normalized_result', label: view.envelope.operation, lines: [`item: ${view.envelope.operation} result`] }
            : (() => { throw new BrowserEvidenceError('Only the whole file can be cited for this kind of evidence.', 400, 'REA_ITEM_INVALID'); })();

  const written: string[] = [];
  if (view.kind === 'browser' && target.kind === 'step') {
    const shot = stepScreenshot(read.buffer, target.index);
    if (shot) {
      const extension = shot.mediaType === 'image/jpeg' ? 'jpg' : shot.mediaType === 'image/webp' ? 'webp' : 'png';
      const dir = path.posix.dirname(read.name.replaceAll('\\', '/'));
      const name = path.posix.join(dir === '.' ? '' : dir, 'rea-cite', `${path.posix.basename(read.name, '.json')}-step-${target.index}.${extension}`);
      await files.write(name, shot.bytes, { overwrite: true });
      written.push(name);
      item.lines.push(`screenshot: ${name} (${shot.mediaType}, ${kb(shot.bytes.length)}, sha256 ${shot.sha256.slice(0, 12)}… verified)`);
    } else if ((view as ReaEvidenceView & ReaBrowserView).steps.find((step) => step.index === target.index)?.screenshot) {
      item.lines.push('screenshot: recorded but not verified or not readable, not exported');
    }
  }
  const tail = [`REA unknowns in this file: ${view.unknowns.length} · limitations: ${view.envelope.limitations.length} (open the file for them)`];
  const block = [`<rea-evidence file="${attr(read.name)}" evidence_id="${attr(view.envelope.evidenceId)}" pointer="${attr(item.pointer)}">`,
    sourceLine(view), ...item.lines, ...tail, '</rea-evidence>'].join('\n');
  return { ok: true, file: read.name, evidenceId: view.envelope.evidenceId, pointer: item.pointer, label: item.label, block, files: written, valuesIncluded: includeValues };
}
