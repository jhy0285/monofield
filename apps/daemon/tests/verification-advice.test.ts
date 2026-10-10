import { describe, expect, it, vi } from 'vitest';
import type { JevEvaluation, JevRequest, VerificationCheck, VerificationSource } from '@open-design/contracts';
import { suggestVerification } from '../src/services/verification-advice.js';
import { assertVerificationAdviceSnapshot, verificationAdviceSnapshot } from '../src/services/verification-advice-snapshot.js';

const checks: VerificationCheck[] = [
  { id: 'node:test', label: 'test', kind: 'test', command: 'npm', args: ['run', 'test'], source: 'package.json', script: 'node --test', recommended: true },
  { id: 'node:build', label: 'build', kind: 'build', command: 'npm', args: ['run', 'build'], source: 'package.json', script: 'vite build', recommended: false },
];
const source: VerificationSource = { scope: 'git-visible-worktree', head: 'head', digest: 'digest', fileCount: 2, reason: null };
const response = (choice = 'C1', top = 0.94, fit = 0.95): JevEvaluation => ({ backend: 'local', requestedModel: 'fixture', elapsedMs: 5,
  result: { model: 'fixture', usage: { input_tokens: 91, output_tokens: 0 }, answers: {
    priority: { type: 'choice', choice, confidence: top, probabilities: choice === 'NONE'
      ? { C1: (1 - top) / 2, C2: (1 - top) / 2, NONE: top } : { C1: top, C2: 1 - top, NONE: 0 } },
    fit_C1: { type: 'noul', noul: fit }, fit_C2: { type: 'noul', noul: 0.25 },
  } } });
function setup() {
  return { discover: vi.fn(async () => structuredClone(checks)), source: vi.fn(async () => structuredClone(source)),
    config: vi.fn(async () => ({ backend: 'local' as const, model: 'fixture', localBaseUrl: 'http://127.0.0.1:8000' })),
    evaluate: vi.fn(async (_dir: string, _request: JevRequest, _options: { signal: AbortSignal; timeoutMs: number }) => response()) };
}
const brief = { request: 'Fix checkout totals', mode: 'model' };
describe('verification suggestions are bounded advisory decisions', () => {
  it('uses project defaults with zero evaluations and preserves a measurable snapshot', async () => {
    const deps = setup(), result = await suggestVerification('data', 'cwd', '.', { ...brief, mode: 'rules' }, deps);
    expect(result.suggestedCheckIds).toEqual(['node:test']); expect(result.evaluationAttempts).toBe(0);
    expect(result.usage).toBeNull(); expect(result.snapshotSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(deps.config).not.toHaveBeenCalled(); expect(deps.evaluate).not.toHaveBeenCalled();
  });
  it('batches priority and relevance once, returning only registered check IDs and actual usage', async () => {
    const deps = setup(), result = await suggestVerification('data', 'cwd', '.', brief, deps);
    expect(deps.evaluate).toHaveBeenCalledTimes(1);
    expect(Object.keys(deps.evaluate.mock.calls[0]![1].questions)).toEqual(['priority', 'fit_C1', 'fit_C2']);
    expect(result).toMatchObject({ reason: 'model', priorityCheckId: 'node:test', suggestedCheckIds: ['node:test'], evaluationAttempts: 1,
      usage: { input_tokens: 91, output_tokens: 0 } });
  });
  it.each([[0.79, 0.99], [0.99, 0.79]])('withholds weak priority or relevance (%s, %s)', async (top, fit) => {
    const deps = setup(); deps.evaluate.mockResolvedValue(response('C1', top, fit));
    const result = await suggestVerification('data', 'cwd', '.', brief, deps);
    expect(result.reason).toBe('uncertain'); expect(result.suggestedCheckIds).toEqual([]); expect(result.priorityCheckId).toBeNull();
  });
  it('supports NONE instead of forcing an irrelevant command', async () => {
    const deps = setup(); deps.evaluate.mockResolvedValue(response('NONE'));
    const result = await suggestVerification('data', 'cwd', '.', brief, deps);
    expect(result.reason).toBe('none'); expect(result.suggestedCheckIds).toEqual([]);
  });
  it('skips model calls for long briefs, large catalogs and unknown source', async () => {
    const deps = setup();
    expect((await suggestVerification('data', 'cwd', '.', { ...brief, request: 'x'.repeat(401) }, deps)).reason).toBe('long-request');
    deps.discover.mockResolvedValue(Array.from({ length: 7 }, (_, i) => ({ ...checks[0]!, id: `check-${i}` })));
    expect((await suggestVerification('data', 'cwd', '.', brief, deps)).reason).toBe('too-many-checks');
    deps.source.mockResolvedValue({ ...source, digest: null, reason: 'Unavailable' });
    const result = await suggestVerification('data', 'cwd', '.', brief, deps);
    expect(result.reason).toBe('source-unavailable'); expect(result.snapshotSha256).toBeNull();
    expect(deps.evaluate).not.toHaveBeenCalled();
  });
  it('keeps defaults when a provider fails and does not report unknown usage as zero', async () => {
    const deps = setup(); deps.evaluate.mockRejectedValue(new Error('server stopped'));
    const result = await suggestVerification('data', 'cwd', '.', brief, deps);
    expect(result).toMatchObject({ reason: 'provider-unavailable', suggestedCheckIds: ['node:test'], usage: null });
  });
  it.each(['config', 'evaluate'] as const)('bounds a hung %s, including setup before the network request', async target => {
    const deps = setup(); deps[target].mockImplementation(() => new Promise<never>(() => {}));
    const result = await suggestVerification('data', 'cwd', '.', brief, { ...deps, timeoutMs: 20 });
    expect(result.reason).toBe('timeout'); expect(result.usage).toBeNull();
    if (target === 'config') expect(deps.evaluate).not.toHaveBeenCalled();
  });
  it('returns no suggestion after caller cancellation', async () => {
    const deps = setup(), controller = new AbortController();
    deps.evaluate.mockImplementation(async () => { controller.abort(); return response(); });
    await expect(suggestVerification('data', 'cwd', '.', brief, { ...deps, signal: controller.signal })).rejects.toMatchObject({ status: 499 });
  });
  it.each([false, true])('rejects source changes even after failed inference (%s)', async failed => {
    const deps = setup(); deps.source.mockResolvedValueOnce(source).mockResolvedValueOnce({ ...source, digest: 'changed' });
    if (failed) deps.evaluate.mockRejectedValue(new Error('provider down'));
    await expect(suggestVerification('data', 'cwd', '.', brief, deps)).rejects.toMatchObject({ status: 409 });
  });
  it('rejects catalog changes when the source reader cannot see an ignored manifest edit', async () => {
    const deps = setup(); deps.discover.mockResolvedValueOnce(checks).mockResolvedValueOnce([{ ...checks[0]!, script: 'different' }, checks[1]!]);
    await expect(suggestVerification('data', 'cwd', '.', brief, deps)).rejects.toMatchObject({ status: 409 });
  });
  it('rejects invalid requests without inspecting a project or provider', async () => {
    const deps = setup();
    for (const input of [null, { request: '', mode: 'model' }, { ...brief, mode: 'automatic' }, { ...brief, request: 'x'.repeat(4001) }]) {
      await expect(suggestVerification('data', 'cwd', '.', input, deps)).rejects.toMatchObject({ status: 400 });
    }
    expect(deps.discover).not.toHaveBeenCalled();
  });
});
describe('execution snapshot guard', () => {
  it('binds exact commands, source and selected module, but not catalog ordering', () => {
    const snapshot = verificationAdviceSnapshot('.', checks, source)!;
    expect(verificationAdviceSnapshot('.', [...checks].reverse(), source)).toBe(snapshot);
    expect(() => assertVerificationAdviceSnapshot(snapshot, snapshot)).not.toThrow();
    for (const actual of [verificationAdviceSnapshot('other', checks, source), verificationAdviceSnapshot('.', checks, { ...source, digest: 'edit' }),
      verificationAdviceSnapshot('.', [{ ...checks[0]!, args: ['run', 'different'] }, checks[1]!], source), null]) {
      expect(() => assertVerificationAdviceSnapshot(snapshot, actual)).toThrow('changed');
    }
    expect(() => assertVerificationAdviceSnapshot('bad', snapshot)).toThrow('SHA-256');
    expect(() => assertVerificationAdviceSnapshot(undefined, null)).not.toThrow();
  });
});
