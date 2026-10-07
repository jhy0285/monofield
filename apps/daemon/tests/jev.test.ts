import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildJevTriageRequest, type JevRequest } from '@open-design/contracts';
import { evaluateJev, jevProviderRequest, jevStatus, readJevConfig, validateJevConfig, validateJevRequest, validateJevResponse, writeJevConfig } from '../src/integrations/jev.js';

vi.mock('../src/byok-credentials.js', () => ({
  readPublicByokCredentials: vi.fn(async () => ({ credentials: {} })),
  resolveByokApiKey: vi.fn(async () => 'stored-test-secret'),
}));
import { readPublicByokCredentials } from '../src/byok-credentials.js';

const request: JevRequest = { model: 'test-model', state: 'A refund request', questions: {
  team: { type: 'choice', criteria: { billing: 'Refunds', support: 'Technical help' } },
  risk: { type: 'score', criteria: ['low', 'high'] },
  yes: { type: 'noul', instructions: 'Does it ask for a refund?' },
} };
const response = () => ({ model: 'provider-real-name', answers: {
  team: { type: 'choice', choice: 'billing', confidence: 0.8, probabilities: { billing: 0.9, support: 0.1 } },
  risk: { type: 'score', score: 0.1, confidence: 0.8, probabilities: { '0': 0.9, '1': 0.1 }, legend: { '0': 'low', '1': 'high' } },
  yes: { type: 'noul', noul: 0.9 },
}, usage: { input_tokens: 43, output_tokens: 0 } });
let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'monofield-jev-')); vi.mocked(readPublicByokCredentials).mockResolvedValue({ credentials: {} }); });
afterEach(async () => { vi.unstubAllGlobals(); await rm(dir, { recursive: true, force: true }); });

describe('JEV protocol and backend boundaries', () => {
  it('accepts all three official answer types and strips unknown provider fields', () => {
    expect(validateJevResponse({ ...response(), debug: 'not an app field' }, request)).toEqual(response());
    expect(validateJevRequest({ ...request, hooks: 'not callable over HTTP' })).toEqual(request);
  });
  it.each(['extra', 'missing', 'unknown-choice', 'wrong-type', 'bad-probability', 'wrong-legend', 'negative-usage'])('refuses a malformed provider answer: %s', defect => {
    const r = response();
    if (defect === 'extra') Object.assign(r.answers, { unexpected: { type: 'noul', noul: 1 } });
    if (defect === 'missing') delete (r.answers as Record<string, unknown>).yes;
    if (defect === 'unknown-choice') r.answers.team.choice = 'invented';
    if (defect === 'wrong-type') r.answers.yes.type = 'choice';
    if (defect === 'bad-probability') r.answers.team.probabilities.billing = NaN;
    if (defect === 'wrong-legend') r.answers.risk.legend['0'] = 'changed';
    if (defect === 'negative-usage') r.usage.input_tokens = -1;
    expect(() => validateJevResponse(r, request)).toThrow('invalid typed response');
  });
  it('validates request limits, JSON and the actual option schema', () => {
    expect(() => validateJevRequest({ ...request, questions: {} })).toThrow('1–16');
    expect(() => validateJevRequest({ ...request, state: null })).toThrow('state');
    expect(() => validateJevRequest({ ...request, state: 'x'.repeat(256 * 1024) })).toThrow('256 KiB');
    expect(() => validateJevRequest({ ...request, questions: { a: { type: 'noul', criteria: { true: 'yes' } } } })).toThrow('true and false');
    expect(() => validateJevRequest({ ...request, questions: { a: { type: 'score', criteria: [] } } })).toThrow('ordered criteria');
  });
  it.each(['https://example.com', 'http://127.0.0.2', 'http://user:pass@localhost', 'http://localhost?key=x', 'file:///etc/passwd'])('blocks a non-local or credential-bearing local URL: %s', localBaseUrl => {
    expect(() => validateJevConfig({ backend: 'local', model: 'multilingual', localBaseUrl })).toThrow('loopback');
  });
  it('stores configuration without credentials and preserves a prefix', async () => {
    const c = { backend: 'local', localBaseUrl: 'http://[::1]:8000/laya/', model: 'multilingual', apiKey: 'must-not-persist' };
    await writeJevConfig(dir, c);
    expect(await readJevConfig(dir)).toEqual({ backend: 'local', localBaseUrl: 'http://[::1]:8000/laya', model: 'multilingual' });
    expect(await readFile(path.join(dir, 'jev-config.json'), 'utf8')).not.toContain('must-not-persist');
  });
  it('does not fabricate success or issue a hosted request without authentication', async () => {
    const fetchImpl = vi.fn();
    await expect(evaluateJev(dir, request, { env: {}, fetchImpl })).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await jevStatus(dir, {})).ready).toBe(false);
  });
  it('uses environment auth for the fixed hosted origin and refuses redirect following', async () => {
    const fetchImpl = vi.fn(async () => Response.json(response()));
    const result = await evaluateJev(dir, request, { env: { TYPESAFE_API_KEY: 'test-environment-secret' }, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.typesafe.ai/v1/systemone', expect.objectContaining({ redirect: 'error', headers: expect.objectContaining({ authorization: 'Bearer test-environment-secret' }) }));
    expect(result.backend).toBe('typesafe'); expect(result.result.usage.input_tokens).toBe(43);
  });
  it('prefers encrypted auth and returns only the masked tail', async () => {
    vi.mocked(readPublicByokCredentials).mockResolvedValue({ credentials: { typesafe: { configured: true, apiKeyTail: 'cret' } } });
    const fetchImpl = vi.fn(async () => Response.json(response()));
    await evaluateJev(dir, request, { env: { TYPESAFE_API_KEY: 'env-secret' }, fetchImpl });
    expect(fetchImpl.mock.calls[0]).toEqual(['https://api.typesafe.ai/v1/systemone', expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer stored-test-secret' }) })]);
    expect(await jevStatus(dir, {})).toMatchObject({ credentialSource: 'stored', apiKeyTail: 'cret' });
  });
  it('never sends a TypeSafe credential to a local compatible server', async () => {
    await writeJevConfig(dir, { backend: 'local', model: 'multilingual', localBaseUrl: 'http://localhost:12345' });
    const fetchImpl = vi.fn(async () => Response.json(response()));
    const result = await evaluateJev(dir, request, { env: { TYPESAFE_API_KEY: 'never-forward-this' }, fetchImpl });
    expect(fetchImpl.mock.calls[0]).toEqual(['http://localhost:12345/v1/systemone', expect.objectContaining({ headers: { 'content-type': 'application/json' } })]);
    expect(result.backend).toBe('local');
  });
  it.each([[401, 'AUTH_REJECTED'], [403, 'AUTH_REJECTED'], [429, 'RATE_LIMITED'], [500, 'UNAVAILABLE'], [422, 'INVALID_REQUEST']])('categorizes HTTP %s without echoing provider secrets', async (status, code) => {
    await expect(evaluateJev(dir, request, { env: { TYPESAFE_API_KEY: 'secret' }, fetchImpl: async () => new Response('your secret is secret', { status: Number(status) }) })).rejects.toMatchObject({ code });
  });
  it('reports real timeout and malformed JSON separately', async () => {
    const fetchImpl: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('secret transport message'))); });
    await expect(evaluateJev(dir, request, { env: { TYPESAFE_API_KEY: 'secret' }, fetchImpl, timeoutMs: 5 })).rejects.toMatchObject({ code: 'TIMEOUT' });
    await expect(jevProviderRequest(dir, '/v1/models', undefined, { env: { TYPESAFE_API_KEY: 'secret' }, fetchImpl: async () => new Response('not json') })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('builds an advisory triage request with no permission or executable action', () => {
    const q = buildJevTriageRequest('Fix login', 'multilingual');
    expect(Object.keys(q.questions)).toEqual(['kind', 'risk', 'clarification']);
    expect(validateJevRequest(q)).toEqual(q);
  });
});
