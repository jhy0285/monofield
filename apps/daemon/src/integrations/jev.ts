import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { STORED_BYOK_API_KEY, type JevConfig, type JevErrorCode, type JevEvaluation, type JevModelsResponse, type JevRequest, type JevResponse, type JevStatus } from '@open-design/contracts';
import { readPublicByokCredentials, resolveByokApiKey } from '../byok-credentials.js';
import { proxyDispatcherRequestInit } from '../connectionTest.js';

const HOSTED_BASE = 'https://api.typesafe.ai';
const MAX_BYTES = 256 * 1024;
const DEFAULT_CONFIG: JevConfig = { backend: 'typesafe', localBaseUrl: 'http://127.0.0.1:8000', model: 'jev-latest' };
export class JevError extends Error {
  constructor(public readonly code: JevErrorCode, message: string, public readonly status = 400) { super(message); }
}
const invalid = (message: string): never => { throw new JevError('INVALID_REQUEST', message); };
const record = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const probability = (v: unknown): v is number => finite(v) && v >= 0 && v <= 1;
const sameKeys = (a: Record<string, unknown>, b: Record<string, unknown>) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => Object.hasOwn(b, k));
function jsonValue(value: unknown, depth = 0): boolean {
  if (depth > 16) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || finite(value)) return true;
  if (Array.isArray(value)) return value.every(v => jsonValue(v, depth + 1));
  return record(value) && Object.values(value).every(v => jsonValue(v, depth + 1));
}
export function validateJevConfig(value: unknown): JevConfig {
  if (!record(value) || !['typesafe', 'local'].includes(String(value.backend))) return invalid('Select TypeSafe JEV or a local compatible server.');
  if (typeof value.model !== 'string' || !value.model.trim() || value.model.length > 200) return invalid('A model name is required.');
  if (typeof value.localBaseUrl !== 'string') return invalid('A local server URL is required.');
  let url: URL;
  try { url = new URL(value.localBaseUrl); } catch { return invalid('The local server URL is invalid.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || url.username || url.password || url.search || url.hash) {
    return invalid('Local servers must use a loopback HTTP(S) URL without credentials, query or fragment.');
  }
  return { backend: value.backend as JevConfig['backend'], localBaseUrl: url.toString().replace(/\/+$/, ''), model: value.model.trim() };
}
export function validateJevRequest(value: unknown): JevRequest {
  if (!record(value) || typeof value.model !== 'string' || !value.model.trim() || value.model.length > 200) return invalid('A model name is required.');
  if (!(typeof value.state === 'string' || Array.isArray(value.state) || record(value.state)) || !jsonValue(value.state)) return invalid('state must be text or a JSON object/array.');
  if (!record(value.questions) || Object.keys(value.questions).length < 1 || Object.keys(value.questions).length > 16) return invalid('Provide 1–16 typed questions.');
  for (const [id, q] of Object.entries(value.questions)) {
    if (!id || id.length > 100 || !record(q) || !['choice', 'score', 'noul'].includes(String(q.type))) return invalid('Each question needs a name and a supported type.');
    if (q.instructions !== undefined && (!(q.instructions === null || typeof q.instructions === 'string' || Array.isArray(q.instructions) || record(q.instructions)) || !jsonValue(q.instructions))) return invalid('Question instructions must be text, a JSON object/array, or null.');
    if (q.type === 'choice' && (!record(q.criteria) || Object.keys(q.criteria).length < 1 || Object.keys(q.criteria).length > 100 || Object.keys(q.criteria).some(k => !k || k.length > 200) || !jsonValue(q.criteria))) return invalid('choice needs 1–100 named criteria.');
    if (q.type === 'score' && (!Array.isArray(q.criteria) || q.criteria.length < 1 || q.criteria.length > 100 || !jsonValue(q.criteria))) return invalid('score needs 1–100 ordered criteria.');
    if (q.type === 'noul' && q.criteria != null && (!record(q.criteria) || !sameKeys(q.criteria, { true: 0, false: 0 }) || !jsonValue(q.criteria))) return invalid('noul criteria must contain true and false.');
  }
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_BYTES) return invalid('The decision input exceeds 256 KiB.');
  // Copy only protocol fields; clients cannot forward hooks or arbitrary provider options.
  const questions = Object.fromEntries(Object.entries(value.questions).map(([id, raw]) => {
    const q = raw as Record<string, unknown>;
    return [id, { type: q.type, ...(q.instructions !== undefined ? { instructions: q.instructions } : {}), ...(q.criteria !== undefined ? { criteria: q.criteria } : {}) }];
  }));
  return { model: value.model.trim(), state: value.state, questions } as JevRequest;
}
export function validateJevResponse(value: unknown, request: JevRequest): JevResponse {
  const bad = (): never => { throw new JevError('INVALID_RESPONSE', 'The decision server returned an invalid typed response.', 502); };
  if (!record(value) || typeof value.model !== 'string' || !value.model || !record(value.answers) || !sameKeys(value.answers, request.questions) || !record(value.usage) || ![value.usage.input_tokens, value.usage.output_tokens].every(n => Number.isSafeInteger(n) && Number(n) >= 0)) return bad();
  for (const [id, q] of Object.entries(request.questions)) {
    const a = value.answers[id];
    if (!record(a) || a.type !== q.type) return bad();
    if (q.type === 'noul') { if (!probability(a.noul)) return bad(); continue; }
    if (!probability(a.confidence) || !record(a.probabilities)) return bad();
    const options = q.type === 'choice' ? q.criteria : Object.fromEntries(q.criteria.map((_, i) => [String(i), 0]));
    if (!sameKeys(a.probabilities, options) || !Object.values(a.probabilities).every(probability) || Math.abs(Object.values(a.probabilities).reduce<number>((sum, n) => sum + Number(n), 0) - 1) > 0.02) return bad();
    if (q.type === 'choice' && (typeof a.choice !== 'string' || !Object.hasOwn(q.criteria, a.choice))) return bad();
    if (q.type === 'score' && (!finite(a.score) || a.score < 0 || a.score > q.criteria.length - 1 || !record(a.legend) || !sameKeys(a.legend, options) || q.criteria.some((v, i) => !isDeepStrictEqual(v, (a.legend as Record<string, unknown>)[String(i)])))) return bad();
  }
  const answers = Object.fromEntries(Object.entries(value.answers).map(([id, raw]) => {
    const a = raw as Record<string, unknown>;
    if (a.type === 'noul') return [id, { type: a.type, noul: a.noul }];
    return [id, { type: a.type, confidence: a.confidence, probabilities: a.probabilities,
      ...(a.type === 'choice' ? { choice: a.choice } : { score: a.score, legend: a.legend }) }];
  }));
  return { model: value.model, answers, usage: { input_tokens: value.usage.input_tokens, output_tokens: value.usage.output_tokens } } as JevResponse;
}
export async function readJevConfig(dataDir: string): Promise<JevConfig> {
  try { return validateJevConfig(JSON.parse(await readFile(path.join(dataDir, 'jev-config.json'), 'utf8'))); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_CONFIG }; throw e; }
}
export async function writeJevConfig(dataDir: string, value: unknown): Promise<JevConfig> {
  const config = validateJevConfig(value);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, 'jev-config.json'), tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(config), { mode: 0o600 }); await rename(tmp, file); return config;
}
export async function jevStatus(dataDir: string, env: NodeJS.ProcessEnv = process.env): Promise<JevStatus> {
  const config = await readJevConfig(dataDir);
  const credential = (await readPublicByokCredentials(dataDir)).credentials.typesafe;
  const source = credential?.configured ? 'stored' : env.TYPESAFE_API_KEY?.trim() ? 'environment' : 'none';
  return { config, credentialSource: source, apiKeyTail: source === 'stored' ? credential?.apiKeyTail ?? '' : source === 'environment' ? env.TYPESAFE_API_KEY!.trim().slice(-4) : '', ready: config.backend === 'local' || source !== 'none' };
}
async function readJson(response: Response): Promise<unknown> {
  if (!response.body) throw new JevError('INVALID_RESPONSE', 'The decision server returned no response.', 502);
  const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 1024 * 1024) throw new Error('Response too large'); chunks.push(next.value); } return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new JevError('INVALID_RESPONSE', 'The decision server returned invalid or excessive JSON.', 502); }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
export async function jevProviderRequest(dataDir: string, endpoint: '/v1/systemone' | '/v1/models' | '/health', body?: JevRequest, options: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv; signal?: AbortSignal; timeoutMs?: number; config?: JevConfig } = {}): Promise<unknown> {
  const env = options.env ?? process.env, config = options.config ? validateJevConfig(options.config) : await readJevConfig(dataDir);
  let key = '';
  if (config.backend === 'typesafe') {
    if (endpoint === '/health') throw new JevError('INVALID_REQUEST', 'Local health is unavailable for hosted JEV.');
    const publicKeys = await readPublicByokCredentials(dataDir);
    key = publicKeys.credentials.typesafe?.configured ? await resolveByokApiKey(dataDir, 'typesafe', STORED_BYOK_API_KEY) : env.TYPESAFE_API_KEY?.trim() ?? '';
    if (!key) throw new JevError('AUTH_REQUIRED', 'TypeSafe JEV needs an API key. A local compatible server can run without a TypeSafe key.', 401);
  }
  const proxy = config.backend === 'typesafe' ? proxyDispatcherRequestInit(env) : null;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 45_000);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  try {
    const response = await (options.fetchImpl ?? fetch)((config.backend === 'typesafe' ? HOSTED_BASE : config.localBaseUrl) + endpoint, {
      ...proxy?.requestInit, redirect: 'error', signal, method: body ? 'POST' : 'GET',
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(key ? { authorization: `Bearer ${key}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if ([401, 403].includes(response.status)) throw new JevError('AUTH_REJECTED', 'The decision server rejected authentication.', 401);
      if (response.status === 429) throw new JevError('RATE_LIMITED', 'The decision server rate limit was reached. Retry later.', 429);
      if (response.status === 404) throw new JevError('UNAVAILABLE', 'This decision endpoint is unavailable.', 404);
      if ([400, 413, 422].includes(response.status)) throw new JevError('INVALID_REQUEST', 'The decision server rejected the input or model.', 400);
      throw new JevError('UNAVAILABLE', 'The decision server is unavailable.', 502);
    }
    const result = await readJson(response);
    if (signal.aborted) throw new JevError('TIMEOUT', 'The decision request timed out or was cancelled.', 504);
    return result;
  } catch (e) {
    if (signal.aborted) throw new JevError('TIMEOUT', 'The decision request timed out or was cancelled.', 504);
    if (e instanceof JevError) throw e;
    throw new JevError('UNAVAILABLE', 'Could not connect to the decision server. Check the server and network.', 502);
  } finally { await proxy?.close(); }
}
export async function jevModels(dataDir: string): Promise<JevModelsResponse> {
  const config = await readJevConfig(dataDir);
  try {
    const raw = await jevProviderRequest(dataDir, '/v1/models', undefined, { config });
    if (!record(raw) || !Array.isArray(raw.models) || raw.models.some(m => !record(m) || typeof m.name !== 'string' || !m.name || typeof m.description !== 'string')) throw new JevError('INVALID_RESPONSE', 'The decision server returned an invalid model list.', 502);
    return { models: raw.models.map(m => ({ name: m.name, description: m.description })), source: 'provider' };
  } catch (e) {
    if (!(e instanceof JevError) || e.status !== 404 || config.backend !== 'local') throw e;
    const health = await jevProviderRequest(dataDir, '/health', undefined, { config });
    if (!record(health) || health.status !== 'ok' || !Array.isArray(health.loaded) || !health.loaded.every(n => typeof n === 'string')) throw new JevError('INVALID_RESPONSE', 'The local server did not report loaded models.', 502);
    return { models: health.loaded.map(name => ({ name, description: 'Loaded model reported by the local server' })), source: 'local-health' };
  }
}
export async function evaluateJev(dataDir: string, value: unknown, options: Parameters<typeof jevProviderRequest>[3] = {}): Promise<JevEvaluation> {
  const request = validateJevRequest(value), config = await readJevConfig(dataDir), start = performance.now();
  const result = validateJevResponse(await jevProviderRequest(dataDir, '/v1/systemone', request, { ...options, config }), request);
  return { backend: config.backend, requestedModel: request.model, elapsedMs: Math.round(performance.now() - start), result };
}
