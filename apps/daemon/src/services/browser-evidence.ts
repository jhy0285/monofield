import { createHash } from 'node:crypto';
import {
  BROWSER_EVIDENCE_TEXT,
  BROWSER_EXAMPLE_MAX_BYTES,
  applyBrowserEvidence,
  crossCheckBrowserEvidence,
  emptyBrowserEvidenceSpec,
  isApiTransaction,
  observedFieldsFromJson,
  parseInterfaceSpecDocument,
  validateInterfaceSpecDocument,
  type BrowserEvidenceApplyResponse,
  type BrowserEvidenceCrossCheckResponse,
  type BrowserEvidenceListEntry,
  type BrowserEvidenceSource,
  type BrowserTransaction,
  type InterfaceSpecDocument,
  type ObservedBody,
} from '@open-design/contracts';
import { isDocumentPath } from './project-document-graph.js';

/**
 * Browser evidence (REA `capture_browser_scenario`) against interface
 * specifications. This module only decodes the evidence file; the comparison
 * and the document edits are the pure functions in `@open-design/contracts`.
 */
export const BROWSER_EVIDENCE_PREDICATE = 'rea.browser-scenario-capture';
const MAX_EVIDENCE_BYTES = 64 * 1024 * 1024;
const MAX_SPEC_BYTES = 2 * 1024 * 1024;
const MAX_EVIDENCE_FILES = 10;
const PREDICATE_PATTERN = /"predicate_type"\s*:\s*"rea\.browser-scenario-capture"/;

export interface BrowserEvidenceFileAccess {
  list(): Promise<Array<{ name: string; size?: number; mtime?: number; kind?: string }>>;
  read(name: string): Promise<{ buffer: Buffer; name: string }>;
  /** The first bytes of a file, to recognize evidence without reading it whole. */
  head(name: string, bytes: number): Promise<Buffer>;
  write(name: string, body: string, options: { expectedContentSha256?: string | null; overwrite: boolean }): Promise<unknown>;
}

export class BrowserEvidenceError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'BROWSER_EVIDENCE_INVALID') { super(message); }
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

/** Project JSON files whose head declares an REA browser capture. */
export async function listBrowserEvidenceFiles(files: BrowserEvidenceFileAccess): Promise<BrowserEvidenceListEntry[]> {
  const candidates = (await files.list())
    .filter((file) => /\.json$/i.test(file.name) && !/\.(?:interface|screen)-spec\.json$/i.test(file.name)
      && (file.size ?? 0) <= MAX_EVIDENCE_BYTES)
    .slice(0, 2000);
  const found: BrowserEvidenceListEntry[] = [];
  for (const file of candidates) {
    try {
      const head = await files.head(file.name, 256 * 1024);
      if (PREDICATE_PATTERN.test(head.toString('utf8'))) {
        found.push({ file: file.name, size: Number(file.size ?? head.length), mtime: Number(file.mtime ?? 0) });
      }
    } catch { /* unreadable files are not evidence */ }
    if (found.length >= 200) break;
  }
  return found.sort((a, b) => b.mtime - a.mtime);
}

function decodeBody(content: unknown): ObservedBody {
  if (!isObject(content) || !isObject(content.body)) return { state: 'missing', fields: [] };
  const body = content.body;
  const state = String(body.state ?? 'missing');
  if (state === 'not_requested' || state === 'not_exposed') return { state, fields: [] };
  if (state === 'unavailable') return { state, ...(typeof body.reason === 'string' ? { reason: body.reason } : {}), fields: [] };
  if (state !== 'captured' || typeof body.content !== 'string') return { state: 'missing', fields: [] };
  const bytes = Buffer.from(body.content, 'base64');
  const mediaType = typeof body.media_type === 'string' ? body.media_type : null;
  const base = { mediaType, bytes: bytes.length, redacted: body.redacted === true, ...(typeof body.sha256 === 'string' ? { sha256: body.sha256 } : {}) };
  // REA validates these on write; a mismatch here means the file changed afterwards.
  if (typeof body.sha256 !== 'string' || sha256(bytes) !== body.sha256.toLowerCase()
    || (typeof body.bytes === 'number' && body.bytes !== bytes.length)) {
    return { state: 'integrity-failed', ...base, fields: [] };
  }
  const text = bytes.toString('utf8');
  const jsonLike = /json/i.test(mediaType ?? '') || (!mediaType || /^text\/plain/i.test(mediaType)) && /^\s*[[{]/.test(text);
  if (!jsonLike) return { state: 'not-json', ...base, fields: [] };
  try {
    const value: unknown = JSON.parse(text);
    return { state: 'captured', ...base, fields: observedFieldsFromJson(value), ...(bytes.length <= BROWSER_EXAMPLE_MAX_BYTES ? { example: value } : {}) };
  } catch {
    return { state: 'not-json', ...base, fields: [] };
  }
}

function pathOf(rawUrl: string): { path: string; origin: string | null } {
  try {
    const url = new URL(rawUrl);
    return { path: url.pathname || '/', origin: url.origin === 'null' ? null : url.origin };
  } catch {
    return { path: rawUrl.split(/[?#]/)[0] || '/', origin: null };
  }
}

/** Decode one REA browser capture into transactions and a source summary. */
export function readBrowserEvidence(buffer: Buffer, file: string): { source: BrowserEvidenceSource; transactions: BrowserTransaction[] } {
  let parsed: unknown;
  try { parsed = JSON.parse(buffer.toString('utf8')); } catch { throw new BrowserEvidenceError(`${file} is not JSON.`); }
  const evidence = isObject(parsed) && isObject(parsed.evidence) ? parsed.evidence : parsed;
  if (!isObject(evidence) || evidence.predicate_type !== BROWSER_EVIDENCE_PREDICATE || !isObject(evidence.normalized_result)) {
    throw new BrowserEvidenceError(`${file} is not an REA browser scenario capture (${BROWSER_EVIDENCE_PREDICATE}).`);
  }
  const result = evidence.normalized_result;
  const evidenceId = typeof evidence.evidence_id === 'string' ? evidence.evidence_id : sha256(buffer).slice(0, 16);
  const steps = Array.isArray(result.steps) ? result.steps.filter(isObject) : [];
  const stepIds = new Map(steps.map((step) => [Number(step.step_index), typeof step.step_id === 'string' ? step.step_id : undefined]));
  const events = isObject(result.events) && Array.isArray(result.events.items) ? result.events.items.filter(isObject) : [];
  const bySequence = new Map(events.map((event) => [Number(event.sequence), event]));
  const groups = new Map<string, Json[]>();
  for (const event of events) {
    if (typeof event.transaction_id !== 'string') continue;
    groups.set(event.transaction_id, [...(groups.get(event.transaction_id) ?? []), event]);
  }
  const transactions: BrowserTransaction[] = [];
  for (const [transactionId, group] of groups) {
    const request = group.find((event) => event.kind === 'request');
    const response = group.find((event) => event.kind === 'response');
    const failed = group.find((event) => event.kind === 'request-failed');
    const head = response ?? request ?? failed;
    if (!head || !isObject(head.url) || typeof head.url.url !== 'string') continue;
    // network-content points at the request/response event it belongs to.
    const owner = (phase: 'request' | 'response') => phase === 'request' ? request : response;
    const content = (phase: 'request' | 'response') => group.find((event) => event.kind === 'network-content' && event.phase === phase
      && (owner(phase) === undefined || bySequence.get(Number(event.source_event_sequence)) === owner(phase)));
    const { path, origin } = pathOf(head.url.url);
    const stepIndex = Number(head.step_index ?? 0);
    const stepId = stepIds.get(stepIndex);
    transactions.push({
      evidenceFile: file,
      evidenceId,
      transactionId,
      stepIndex,
      ...(stepId ? { stepId } : {}),
      method: String(head.method ?? 'GET').toUpperCase(),
      origin: typeof head.url.origin === 'string' ? head.url.origin : origin,
      path,
      queryNames: Array.isArray(head.url.query_parameter_names) ? head.url.query_parameter_names.filter((name): name is string => typeof name === 'string') : [],
      resourceType: String(head.resource_type ?? 'other'),
      status: typeof response?.status === 'number' ? response.status : null,
      ...(typeof failed?.failure === 'string' ? { failure: failed.failure } : {}),
      request: decodeBody(content('request')),
      response: decodeBody(content('response')),
    });
  }
  const scenario = isObject(result.scenario) ? result.scenario : {};
  const networkContent = isObject(scenario.network_content) ? scenario.network_content : {};
  const completeness = isObject(result.completeness) ? result.completeness : {};
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  return {
    transactions,
    source: {
      file,
      evidenceId,
      origin: typeof scenario.start_origin === 'string' ? scenario.start_origin : transactions[0]?.origin ?? null,
      steps: steps.length,
      completedSteps: steps.filter((step) => step.status === 'completed').length,
      transactions: transactions.length,
      apiTransactions: transactions.filter(isApiTransaction).length,
      droppedEvents: isObject(result.events) && typeof result.events.dropped === 'number' ? result.events.dropped : 0,
      completeness: {
        status: typeof completeness.status === 'string' ? completeness.status : 'unknown',
        missingSections: strings(completeness.missing_sections),
        truncatedSections: strings(completeness.truncated_sections),
      },
      captured: { requestBodies: networkContent.request_body === true, responseBodies: networkContent.response_body === true },
      limitations: strings(result.limitations).slice(0, 12),
    },
  };
}

function evidenceFileList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  if (list.length === 0) throw new BrowserEvidenceError('evidenceFiles must name at least one REA browser evidence file.');
  if (list.length > MAX_EVIDENCE_FILES) throw new BrowserEvidenceError(`At most ${MAX_EVIDENCE_FILES} evidence files can be compared at once.`);
  return [...new Set(list.map((item) => {
    if (!isDocumentPath(item)) throw new BrowserEvidenceError('Evidence files must be project-relative JSON paths.');
    return item;
  }))];
}

async function loadSpec(files: BrowserEvidenceFileAccess, inputFile: unknown): Promise<{ doc: InterfaceSpecDocument; name: string; contentSha256: string } | null> {
  if (inputFile === undefined || inputFile === null || inputFile === '') return null;
  if (!isDocumentPath(inputFile)) throw new BrowserEvidenceError('inputFile must be a project-relative JSON document path.');
  const file = await files.read(inputFile);
  if (file.buffer.length > MAX_SPEC_BYTES) throw new BrowserEvidenceError('The document exceeds the 2 MB analysis limit.');
  let value: unknown;
  try { value = JSON.parse(file.buffer.toString('utf8')); } catch { throw new BrowserEvidenceError(`${inputFile} is not JSON.`); }
  const parsed = parseInterfaceSpecDocument(value);
  if (!parsed.ok) throw new BrowserEvidenceError(parsed.error);
  return { doc: parsed.doc, name: file.name, contentSha256: sha256(file.buffer) };
}

async function loadEvidence(files: BrowserEvidenceFileAccess, evidenceFiles: unknown) {
  const sources: BrowserEvidenceSource[] = [];
  const transactions: BrowserTransaction[] = [];
  for (const name of evidenceFileList(evidenceFiles)) {
    const file = await files.read(name);
    if (file.buffer.length > MAX_EVIDENCE_BYTES) throw new BrowserEvidenceError(`${name} exceeds the 64 MB evidence limit.`);
    const decoded = readBrowserEvidence(file.buffer, file.name);
    sources.push(decoded.source);
    transactions.push(...decoded.transactions);
  }
  return { sources, transactions };
}

function draftName(sources: BrowserEvidenceSource[]): string {
  const origin = sources.find((source) => source.origin)?.origin;
  return origin ? `${origin.replace(/^https?:\/\//, '')} interface specification (observed)` : 'Observed interface specification';
}

export async function crossCheckBrowserEvidenceFiles(files: BrowserEvidenceFileAccess, body: { inputFile?: unknown; evidenceFiles?: unknown }): Promise<BrowserEvidenceCrossCheckResponse> {
  const spec = await loadSpec(files, body.inputFile);
  const { sources, transactions } = await loadEvidence(files, body.evidenceFiles);
  const doc = spec?.doc ?? emptyBrowserEvidenceSpec(draftName(sources), sources[0]?.origin ?? null, new Date().toISOString());
  const result = crossCheckBrowserEvidence(doc, transactions);
  return { ok: true, inputFile: spec?.name ?? '', contentSha256: spec?.contentSha256 ?? '', sources, transactions, ...result };
}

export async function applyBrowserEvidenceFiles(files: BrowserEvidenceFileAccess, body: Record<string, unknown>): Promise<BrowserEvidenceApplyResponse> {
  const spec = await loadSpec(files, body.inputFile);
  const { sources, transactions } = await loadEvidence(files, body.evidenceFiles);
  const findingIds = body.findingIds === undefined ? undefined
    : Array.isArray(body.findingIds) && body.findingIds.every((id) => typeof id === 'string') ? body.findingIds as string[]
      : (() => { throw new BrowserEvidenceError('findingIds must be a list of finding IDs.'); })();
  const language = body.noteLanguage === 'en' ? 'en' : 'ko';
  const base = spec?.doc ?? emptyBrowserEvidenceSpec(draftName(sources), sources[0]?.origin ?? null, new Date().toISOString());
  const { doc, changes } = applyBrowserEvidence(base, transactions, {
    ...(findingIds ? { findingIds } : {}),
    attachEvidence: body.attachEvidence !== false,
    includeExamples: body.includeExamples === true,
    text: BROWSER_EVIDENCE_TEXT[language],
  });
  const fatal = validateInterfaceSpecDocument(doc).filter((issue) => issue.severity === 'fatal');
  if (fatal.length) throw new BrowserEvidenceError(`The result is not a valid interface specification: ${fatal.map((issue) => issue.message).join('; ')}`);
  if (body.write !== true) return { ok: true, doc, changes };

  const target = body.outputFile ?? spec?.name;
  if (!isDocumentPath(target)) throw new BrowserEvidenceError('outputFile must be a project-relative JSON path (required when drafting without inputFile).');
  const overwritingInput = spec !== null && target === spec.name;
  if (overwritingInput && body.baseContentSha256 !== spec.contentSha256) {
    throw new BrowserEvidenceError('The document changed since it was compared; run the comparison again before writing.', 409, 'BROWSER_EVIDENCE_STALE');
  }
  const content = `${JSON.stringify(doc, null, 2)}\n`;
  await files.write(target, content, { overwrite: overwritingInput, expectedContentSha256: overwritingInput ? spec.contentSha256 : null });
  return { ok: true, doc, changes, written: { file: target, contentSha256: sha256(content) } };
}
