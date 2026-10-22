import { describe, expect, it, vi } from 'vitest';
import type { JevConfig, JevEvaluation, DecisionReviewInput } from '@open-design/contracts';
import { reviewDecisionEvidence, validateDecisionReview } from '../src/services/decision-review.js';

const config: JevConfig = { backend: 'local', localBaseUrl: 'http://127.0.0.1:8000', model: 'multilingual' };
const input: DecisionReviewInput = { task: 'design', objective: 'Keep the action visible at 375px.', evidence: 'At 375px the action is clipped outside the right edge.' };
const evaluation = (choice = 'contradicted', probabilities = { supported: .01, contradicted: .98, unknown: .01 }): JevEvaluation => ({
  backend: 'local', requestedModel: config.model, elapsedMs: 12,
  result: { model: 'fixture-not-live-inference', answers: { alignment: { type: 'choice', choice, confidence: .9, probabilities } }, usage: { input_tokens: 91, output_tokens: 0 } },
});
describe('opt-in semantic review boundaries, using protocol fixtures', () => {
  it('rejects unbounded or unsupported review input', () => {
    for (const value of [null, [], { ...input, objective: '' }, { ...input, evidence: 'x'.repeat(601) }, { ...input, objective: 'x'.repeat(201) }, { ...input, task: 'approve-deployment' }, { ...input, task: ['design'] }, { ...input, task: { name: 'design' } }, { ...input, execute: true }]) {
      expect(() => validateDecisionReview(value)).toThrow();
    }
  });
  it('does not load configuration or call a model without evidence', async () => {
    const read = vi.fn(async () => config), evaluate = vi.fn(async () => evaluation());
    expect(await reviewDecisionEvidence('missing', { ...input, evidence: '' }, { config: read, evaluate })).toMatchObject({ status: 'needs-evidence', evaluationAttempts: 0, usage: null, advisory: true });
    expect(read).not.toHaveBeenCalled(); expect(evaluate).not.toHaveBeenCalled();
  });
  it('masks known secrets and pins checked configuration through evaluation', async () => {
    const evaluate = vi.fn(async () => evaluation());
    const value = await reviewDecisionEvidence('mask', { ...input, evidence: 'Authorization: Bearer short-secret-12345678901234567890; email dev@example.test' }, { config: async () => config, evaluate });
    expect(JSON.stringify(evaluate.mock.calls)).not.toContain('short-secret'); expect(JSON.stringify(evaluate.mock.calls)).not.toContain('dev@example.test');
    const args = (evaluate.mock.calls as unknown as Array<[string, unknown, {config: JevConfig}]>)[0]!;
    expect(args[2].config).toEqual(config);
    expect(value).toMatchObject({ status: 'suggestion', suggestion: 'contradicted', evaluationAttempts: 1, advisory: true, usage: { input_tokens: 91, output_tokens: 0 } });
    expect(value).not.toHaveProperty('approved');
  });
  it('reuses only identical input and provider settings, with no new token usage', async () => {
    const evaluate = vi.fn(async () => evaluation());
    const options = { config: async () => config, evaluate };
    const first = await reviewDecisionEvidence('cache', input, options), second = await reviewDecisionEvidence('cache', input, options);
    expect(first.cached).toBe(false); expect(second).toMatchObject({ cached: true, evaluationAttempts: 0, usage: null });
    expect(evaluate).toHaveBeenCalledTimes(1);
    const changed = await reviewDecisionEvidence('cache', { ...input, evidence: 'At 375px the action is fully visible.' }, options);
    expect(changed.cached).toBe(false);
    await reviewDecisionEvidence('cache', input, { ...options, config: async () => ({ ...config, model: 'another-model' }) });
    expect(evaluate).toHaveBeenCalledTimes(3);
  });
  it('abstains for unknown or weak distributions even with a high reported confidence', async () => {
    const uncertain = await reviewDecisionEvidence('ambiguous', input, { config: async () => config, evaluate: async () => evaluation('supported', { supported: .4, contradicted: .3, unknown: .3 }) });
    expect(uncertain.status).toBe('uncertain');
    const unknown = await reviewDecisionEvidence('unknown', input, { config: async () => config, evaluate: async () => evaluation('unknown', { supported: .01, contradicted: .01, unknown: .98 }) });
    expect(unknown).toMatchObject({ status: 'uncertain', suggestion: 'unknown' });
  });
  it('bounds stalled configuration and unavailable inference without inventing usage', async () => {
    const evaluate = vi.fn(async () => evaluation());
    const stalled = await reviewDecisionEvidence('stalled', input, { config: () => new Promise<JevConfig>(() => undefined), evaluate, timeoutMs: 20 });
    expect(stalled).toMatchObject({ status: 'timeout', evaluationAttempts: 0, usage: null }); expect(evaluate).not.toHaveBeenCalled();
    const unavailable = await reviewDecisionEvidence('offline', input, { config: async () => config, evaluate: async () => { throw new Error('offline fixture'); } });
    expect(unavailable).toMatchObject({ status: 'unavailable', suggestion: 'unknown', evaluationAttempts: 1, usage: null });
  });
  it('limits concurrent reviews without queueing on the coding path', async () => {
    const resolve: Array<(value: JevEvaluation) => void> = [];
    const options = { config: async () => config, evaluate: () => new Promise<JevEvaluation>(done => resolve.push(done)) };
    const a = reviewDecisionEvidence('capacity-a', input, options), b = reviewDecisionEvidence('capacity-b', input, options);
    await vi.waitFor(() => expect(resolve).toHaveLength(2));
    expect(await reviewDecisionEvidence('capacity-c', input, options)).toMatchObject({ status: 'unavailable', evaluationAttempts: 0 });
    for (const done of resolve) done(evaluation());
    await Promise.all([a,b]);
  });
});
