import { createHash } from 'node:crypto';
import {
  REA_TEXT_LIMIT,
  classifyReaEvidence,
  parseSqliteConstraints,
  type ReaBrowserRequest,
  type ReaBrowserStep,
  type ReaBrowserView,
  type ReaCompleteness,
  type ReaEnvelope,
  type ReaEvidenceBody,
  type ReaEvidenceKind,
  type ReaEvidenceListEntry,
  type ReaEvidenceView,
  type ReaOtherView,
  type ReaPayload,
  type ReaSqliteTable,
  type ReaSqliteView,
  type ReaStaticView,
  type ReaTraceView,
} from '@open-design/contracts';
import { BrowserEvidenceError, type BrowserEvidenceFileAccess } from './browser-evidence.js';
import { isDocumentPath } from './project-document-graph.js';

/**
 * REA Studio: any REA evidence file in a project, as a view. The envelope and
 * the payload hashes are checked here; the view carries what REA said,
 * including what it could not establish.
 */
const MAX_EVIDENCE_BYTES = 64 * 1024 * 1024;
/** Inline images above this are listed but not embedded, and the whole response is capped as well. */
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_TOTAL_BYTES = 12 * 1024 * 1024;
const MAX_GRAPH_NODES = 80;
const MAX_GRAPH_EDGES = 160;
const HEAD_BYTES = 64 * 1024;
const PREDICATE = /"predicate_type"\s*:\s*"(rea\.[A-Za-z0-9_.-]+)"/;
const OPERATION = /"operation"\s*:\s*"([A-Za-z0-9_.-]+)"/;
const EVIDENCE_ID = /"evidence_id"\s*:\s*"([^"]+)"/;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const asObject = (value: unknown): Json => (isObject(value) ? value : {});
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const strings = (value: unknown): string[] => asArray(value).filter((item): item is string => typeof item === 'string');
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');

/** Project JSON files whose head carries an REA envelope, newest first. */
export async function listReaEvidenceFiles(files: BrowserEvidenceFileAccess): Promise<ReaEvidenceListEntry[]> {
  const candidates = (await files.list())
    .filter((file) => /\.json$/i.test(file.name) && !/\.(?:interface|screen)-spec\.json$/i.test(file.name) && (file.size ?? 0) <= MAX_EVIDENCE_BYTES)
    .slice(0, 2000);
  const found: ReaEvidenceListEntry[] = [];
  for (const file of candidates) {
    try {
      const head = (await files.head(file.name, HEAD_BYTES)).toString('utf8');
      const predicate = head.match(PREDICATE)?.[1];
      if (!predicate) continue;
      const operation = head.match(OPERATION)?.[1] ?? '';
      found.push({
        file: file.name, size: Number(file.size ?? head.length), mtime: Number(file.mtime ?? 0),
        kind: classifyReaEvidence(predicate, operation), operation, evidenceId: head.match(EVIDENCE_ID)?.[1] ?? '',
      });
    } catch { /* unreadable files are not evidence */ }
    if (found.length >= 300) break;
  }
  return found.sort((a, b) => b.mtime - a.mtime);
}

function envelopeOf(evidence: Json): ReaEnvelope {
  const provider = asObject(evidence.provider);
  return {
    evidenceId: text(evidence.evidence_id),
    predicate: text(evidence.predicate_type),
    operation: text(evidence.operation),
    provider: { id: text(provider.id), name: text(provider.name), version: text(provider.version) },
    confidence: typeof evidence.confidence === 'string' ? evidence.confidence : null,
    authority: typeof evidence.authority === 'string' ? evidence.authority : null,
    limitations: strings(evidence.limitations),
  };
}

function completenessOf(value: unknown): ReaCompleteness {
  const completeness = asObject(value);
  return {
    status: text(completeness.status, 'unknown'),
    missingSections: strings(completeness.missing_sections),
    truncatedSections: strings(completeness.truncated_sections),
  };
}

/** Text for display from captured bytes: JSON is pretty-printed; anything else is shown if it is text. */
function displayText(bytes: Buffer, mediaType: string | null): { text?: string; truncated?: boolean; binary?: boolean } {
  const raw = bytes.toString('utf8');
  if (raw.includes('\u0000')) return { binary: true };
  let shown = raw;
  if (/json/i.test(mediaType ?? '') || /^\s*[[{]/.test(raw)) {
    try { shown = JSON.stringify(JSON.parse(raw), null, 2); } catch { /* not JSON after all */ }
  }
  return shown.length > REA_TEXT_LIMIT ? { text: shown.slice(0, REA_TEXT_LIMIT), truncated: true } : { text: shown };
}

/**
 * A captured body or artifact. Content is shown only when its hash matches the recorded one: a mismatch means the file
 * changed after REA wrote it, and showing the bytes anyway would present altered data as evidence.
 */
function payloadOf(value: unknown, options: { image?: boolean } = {}): ReaPayload {
  const source = asObject(value);
  const state = text(source.state, 'missing');
  // Artifacts nest the payload under `value` (screenshots, DOM); network content nests it under `body.content`.
  const nested = asObject(source.value);
  const content = typeof source.content === 'string' ? source.content : null;
  const encoded = typeof nested.data_base64 === 'string' ? nested.data_base64 : content;
  const plain = typeof nested.text === 'string' ? nested.text : null;
  const meta = typeof nested.data_base64 === 'string' || plain !== null ? nested : source;
  const mediaType = text(nested.media_type, text(source.media_type)) || null;
  const recorded = typeof meta.sha256 === 'string' ? meta.sha256.toLowerCase() : null;
  const base = { mediaType, bytes: num(meta.bytes), sha256: recorded, redacted: source.redacted === true || nested.redacted === true };
  if (state !== 'captured' || (encoded === null && plain === null)) {
    return { state: state === 'captured' ? 'missing' : (state as ReaPayload['state']), ...base, ...(typeof source.reason === 'string' ? { reason: source.reason } : {}) };
  }
  const bytes = encoded !== null ? Buffer.from(encoded, 'base64') : Buffer.from(plain!, 'utf8');
  if (!recorded || sha256(bytes) !== recorded || (base.bytes !== null && base.bytes !== bytes.length)) {
    return { state: 'integrity-failed', ...base, bytes: bytes.length };
  }
  if (options.image || /^image\//i.test(mediaType ?? '')) {
    if (bytes.length > MAX_IMAGE_BYTES) return { state: 'omitted', ...base, bytes: bytes.length, reason: 'image-too-large' };
    return { state: 'captured-binary', ...base, bytes: bytes.length, dataUrl: `data:${mediaType ?? 'image/png'};base64,${bytes.toString('base64')}` };
  }
  const shown = displayText(bytes, mediaType);
  if (shown.binary) return { state: 'captured-binary', ...base, bytes: bytes.length };
  return { state: 'captured', ...base, bytes: bytes.length, ...(shown.text !== undefined ? { text: shown.text } : {}), ...(shown.truncated ? { truncated: true } : {}) };
}

function browserView(result: Json): ReaBrowserView {
  const scenario = asObject(result.scenario);
  const network = asObject(scenario.network_content);
  const events = asArray(asObject(result.events).items).filter(isObject);
  const bySequence = new Map(events.map((event) => [Number(event.sequence), event]));
  const groups = new Map<string, Json[]>();
  for (const event of events) {
    if (typeof event.transaction_id !== 'string') continue;
    groups.set(event.transaction_id, [...(groups.get(event.transaction_id) ?? []), event]);
  }
  const requests: ReaBrowserRequest[] = [];
  for (const [id, group] of groups) {
    const request = group.find((event) => event.kind === 'request');
    const response = group.find((event) => event.kind === 'response');
    const failed = group.find((event) => event.kind === 'request-failed');
    const head = response ?? request ?? failed;
    const url = asObject(head?.url);
    if (!head || typeof url.url !== 'string') continue;
    const owner = (phase: 'request' | 'response') => (phase === 'request' ? request : response);
    const content = (phase: 'request' | 'response') => group.find((event) => event.kind === 'network-content' && event.phase === phase
      && (owner(phase) === undefined || bySequence.get(Number(event.source_event_sequence)) === owner(phase)));
    let path = url.url;
    try { path = new URL(url.url).pathname || '/'; } catch { path = url.url.split(/[?#]/)[0] || '/'; }
    const resourceType = text(head.resource_type, 'other');
    const responsePayload = payloadOf(asObject(content('response')).body);
    const requestPayload = payloadOf(asObject(content('request')).body);
    requests.push({
      id,
      stepIndex: Number(head.step_index ?? 0),
      method: text(head.method, 'GET').toUpperCase(),
      origin: typeof url.origin === 'string' ? url.origin : null,
      path,
      queryNames: strings(url.query_parameter_names),
      resourceType,
      status: num(response?.status),
      ...(typeof failed?.failure === 'string' ? { failure: failed.failure } : {}),
      isApi: resourceType === 'fetch' || resourceType === 'xhr' || (/json/i.test(`${responsePayload.mediaType ?? ''} ${requestPayload.mediaType ?? ''}`) && !['document', 'script', 'stylesheet', 'image', 'font', 'media'].includes(resourceType)),
      request: requestPayload,
      response: responsePayload,
    });
  }
  let imageBytes = 0;
  const steps: ReaBrowserStep[] = asArray(result.steps).filter(isObject).map((step) => {
    const artifacts = asObject(step.artifacts);
    const after = asObject(step.after_url);
    const view: ReaBrowserStep = {
      index: Number(step.step_index ?? 0),
      id: text(step.step_id),
      action: text(step.action),
      status: text(step.status, 'unknown'),
      elapsedMs: num(step.elapsed_ms),
      url: typeof after.url === 'string' ? after.url : null,
      eventStart: Number(step.event_sequence_start ?? 0),
      eventEnd: Number(step.event_sequence_end ?? 0),
      error: isObject(step.error) ? text(step.error.message, 'failed') : typeof step.error === 'string' ? step.error : null,
    };
    for (const key of ['screenshot', 'dom', 'accessibility'] as const) {
      if (!isObject(artifacts[key])) continue;
      let payload = payloadOf(artifacts[key], { image: key === 'screenshot' });
      if (payload.dataUrl) {
        imageBytes += payload.bytes ?? 0;
        if (imageBytes > MAX_IMAGE_TOTAL_BYTES) { const { dataUrl: _dropped, ...rest } = payload; payload = { ...rest, state: 'omitted', reason: 'response-size-limit' }; }
      }
      // `not_requested` is the common case and adds nothing to a step.
      if (payload.state !== ('not_requested' as string)) view[key] = payload;
    }
    return view;
  });
  const dropped = asObject(result.events).dropped;
  return {
    kind: 'browser',
    origin: typeof scenario.start_origin === 'string' ? scenario.start_origin : requests[0]?.origin ?? null,
    durationMs: num(result.duration_ms),
    steps,
    requests,
    completeness: completenessOf(result.completeness),
    captured: { requestBodies: network.request_body === true, responseBodies: network.response_body === true },
    droppedEvents: typeof dropped === 'number' ? dropped : 0,
  };
}

function sqliteValue(cell: unknown): string {
  if (!isObject(cell)) return String(cell ?? '');
  const type = text(cell.type);
  if (type === 'null') return 'NULL';
  if (type === 'blob') return `<blob${typeof cell.bytes === 'number' ? ` ${cell.bytes} B` : ''}>`;
  return String(cell.value ?? '');
}

function sqliteView(result: Json): ReaSqliteView {
  const schema = asObject(result.schema);
  const artifact = asObject(result.artifact);
  const engine = asObject(result.engine);
  const rows = isObject(result.rows) ? result.rows : null;
  const indexes = asArray(schema.indexes).filter(isObject);
  const tables: ReaSqliteTable[] = asArray(schema.tables).filter(isObject).filter((table) => text(table.kind, 'table') === 'table').map((table) => {
    const name = text(table.name);
    const constraints = parseSqliteConstraints(typeof table.sql === 'string' ? table.sql : null);
    const view: ReaSqliteTable = {
      name,
      columns: asArray(table.columns).filter(isObject).map((column) => ({
        name: text(column.name),
        type: text(column.declared_type),
        notNull: column.not_null === true,
        primaryKey: Number(column.primary_key_position ?? 0) || 0,
        defaultSql: typeof column.default_sql === 'string' ? column.default_sql : null,
      })),
      foreignKeys: constraints.foreignKeys,
      unique: constraints.unique,
      checks: constraints.checks,
      indexes: indexes.filter((index) => index.table === name && !String(index.name).startsWith('sqlite_autoindex')).map((index) => text(index.name)),
    };
    if (rows && rows.table === name) {
      view.rows = {
        columns: strings(rows.columns),
        values: asArray(rows.values).map((row) => asArray(row).map(sqliteValue)),
        returned: Number(rows.returned_rows ?? 0),
        truncated: rows.truncated === true,
      };
    }
    return view;
  });
  return {
    kind: 'sqlite',
    engine: [text(engine.name, 'SQLite'), text(engine.version)].filter(Boolean).join(' '),
    encoding: typeof result.database_encoding === 'string' ? result.database_encoding : null,
    bytes: num(artifact.bytes),
    sha256: typeof artifact.sha256 === 'string' ? artifact.sha256 : null,
    completeness: text(schema.completeness, 'unknown'),
    tables,
    views: asArray(schema.views).filter(isObject).map((view) => text(view.name)),
    triggers: asArray(schema.triggers).filter(isObject).map((trigger) => text(trigger.name)),
  };
}

const KIND_RANK: Readonly<Record<string, number>> = { artifact: 0, package: 1, 'electron-renderer': 1, 'javascript-asset': 1, 'javascript-module': 2, endpoint: 3 };

function staticView(result: Json): ReaStaticView {
  const graph = asObject(result.graph);
  const semantic = asObject(result.semantic_graph);
  const rawNodes = asArray(graph.nodes).filter(isObject);
  const rawEdges = asArray(graph.edges).filter(isObject);
  const label = (node: Json) => text(asObject(asArray(node.observations)[0]).label) || text(asObject(node.identity).key) || text(node.node_id).slice(0, 12);
  const degree = new Map<string, number>();
  for (const edge of rawEdges) for (const id of [text(edge.source_node_id), text(edge.target_node_id)]) degree.set(id, (degree.get(id) ?? 0) + 1);
  // A large graph is cut to its best-connected nodes, so the picture stays readable; the totals say how much was left out.
  const kept = new Set([...rawNodes].sort((a, b) => (degree.get(text(b.node_id)) ?? 0) - (degree.get(text(a.node_id)) ?? 0)).slice(0, MAX_GRAPH_NODES).map((node) => text(node.node_id)));
  const unknowns = asArray(semantic.unknowns).filter(isObject);
  const reasons = new Map<string, number>();
  for (const unknown of unknowns) reasons.set(text(unknown.reason, 'unspecified'), (reasons.get(text(unknown.reason, 'unspecified')) ?? 0) + 1);
  const statistics = Object.entries(asObject(result.statistics)).filter((entry): entry is [string, number] => typeof entry[1] === 'number').map(([key, value]) => ({ key, value }));
  const coverage = asObject(result.coverage);
  return {
    kind: 'static',
    format: typeof result.format === 'string' ? result.format : null,
    statistics,
    applicationCoverage: typeof asObject(coverage.application).status === 'string' ? text(asObject(coverage.application).status) : typeof asObject(graph.coverage).status === 'string' ? text(asObject(graph.coverage).status) : null,
    semanticCoverage: typeof asObject(semantic.coverage).status === 'string' ? text(asObject(semantic.coverage).status) : null,
    semanticUnknowns: unknowns.length,
    unknownReasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([reason, count]) => ({ reason, count })),
    nodes: rawNodes.filter((node) => kept.has(text(node.node_id))).sort((a, b) => (KIND_RANK[text(a.kind)] ?? 4) - (KIND_RANK[text(b.kind)] ?? 4))
      .map((node) => ({ id: text(node.node_id), kind: text(node.kind), label: label(node) })),
    edges: rawEdges.filter((edge) => kept.has(text(edge.source_node_id)) && kept.has(text(edge.target_node_id))).slice(0, MAX_GRAPH_EDGES)
      .map((edge) => ({ from: text(edge.source_node_id), to: text(edge.target_node_id), relation: text(edge.relation) })),
    nodeTotal: rawNodes.length,
    edgeTotal: rawEdges.length,
  };
}

function traceView(result: Json): ReaTraceView {
  const seed = asObject(result.seed);
  const summary = asObject(result.summary);
  const graph = asObject(result.graph);
  const labels = new Map(asArray(graph.nodes).filter(isObject).map((node) => [text(node.node_id), text(asObject(asArray(node.observations)[0]).label) || text(node.kind)]));
  return {
    kind: 'trace',
    seed: text(seed.value) || JSON.stringify(seed),
    direction: text(result.direction),
    status: text(asObject(result.coverage).status, 'unknown'),
    matches: asArray(result.seed_matches).length,
    tracedNodes: Number(summary.traced_nodes ?? 0),
    terminalPaths: Number(summary.terminal_paths ?? 0),
    paths: asArray(result.paths).filter(isObject).slice(0, 50)
      .map((path) => asArray(path.node_ids ?? path.nodes).map((id) => labels.get(text(id)) ?? text(id).slice(0, 12))),
  };
}

function otherView(kind: 'view' | 'other', result: Json): ReaOtherView {
  const facts: Array<{ key: string; value: string }> = [];
  for (const key of ['kind', 'parent_operation', 'parent_evidence_id']) if (typeof result[key] === 'string') facts.push({ key, value: result[key] as string });
  const summary = asObject(result.summary);
  for (const [key, value] of Object.entries(asObject(summary.statistics))) if (typeof value === 'number') facts.push({ key, value: String(value) });
  const coverage = asObject(result.coverage);
  if (typeof coverage.status === 'string') facts.push({ key: 'coverage', value: coverage.status });
  return { kind, facts };
}

/** Decode one REA evidence file into its view. Throws a {@link BrowserEvidenceError} for a file that is not REA evidence. */
export function buildReaEvidenceView(buffer: Buffer, file: string): ReaEvidenceView {
  let parsed: unknown;
  try { parsed = JSON.parse(buffer.toString('utf8')); } catch { throw new BrowserEvidenceError(`${file} is not JSON.`); }
  const evidence = isObject(parsed) && isObject(parsed.evidence) ? parsed.evidence : parsed;
  if (!isObject(evidence) || typeof evidence.predicate_type !== 'string' || !evidence.predicate_type.startsWith('rea.')) {
    throw new BrowserEvidenceError(`${file} is not an REA evidence file (no rea.* predicate_type).`);
  }
  const result = asObject(evidence.normalized_result);
  const envelope = envelopeOf(evidence);
  const kind = classifyReaEvidence(envelope.predicate, envelope.operation);
  const body: ReaEvidenceBody = kind === 'browser' ? browserView(result)
    : kind === 'sqlite' ? sqliteView(result)
      : kind === 'static' ? staticView(result)
        : kind === 'trace' ? traceView(result)
          : otherView(kind === 'view' ? 'view' : 'other', result);
  const unknowns = strings(result.unknowns);
  return { ok: true, file, envelope, unknowns, ...body };
}

/**
 * Whether one file is REA evidence, from its first 64 KB only: the screen asks this for every JSON file a person opens,
 * so it must not read a large unrelated file whole.
 */
export async function probeReaEvidenceFile(files: BrowserEvidenceFileAccess, body: { file?: unknown }): Promise<{ evidence: boolean; kind?: ReaEvidenceKind; operation?: string }> {
  if (!isDocumentPath(body.file)) throw new BrowserEvidenceError('file must be a project-relative JSON path.');
  const head = (await files.head(body.file, HEAD_BYTES)).toString('utf8');
  const predicate = head.match(PREDICATE)?.[1];
  if (!predicate) return { evidence: false };
  const operation = head.match(OPERATION)?.[1] ?? '';
  return { evidence: true, kind: classifyReaEvidence(predicate, operation), operation };
}

export async function viewReaEvidenceFile(files: BrowserEvidenceFileAccess, body: { file?: unknown }): Promise<ReaEvidenceView> {
  if (!isDocumentPath(body.file)) throw new BrowserEvidenceError('file must be a project-relative JSON path.');
  const read = await files.read(body.file);
  if (read.buffer.length > MAX_EVIDENCE_BYTES) throw new BrowserEvidenceError(`${body.file} exceeds the 64 MB evidence limit.`);
  return buildReaEvidenceView(read.buffer, read.name);
}
