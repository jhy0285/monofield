import { createHash } from 'node:crypto';
import { buildDecisionReviewRequest, type DecisionReviewInput, type DecisionReviewResult } from '@open-design/contracts';
import { evaluateJev, readJevConfig, JevError } from '../integrations/jev.js';
import { redactSecrets } from '../redact.js';

type Options = { config?: typeof readJevConfig; evaluate?: typeof evaluateJev; timeoutMs?: number; signal?: AbortSignal };
const cache = new Map<string, { expires: number; result: DecisionReviewResult }>();
let active = 0;
export function validateDecisionReview(value: unknown): DecisionReviewInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new JevError('INVALID_REQUEST', 'Provide a review task, objective and observations.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['task', 'objective', 'evidence'].includes(key))
    || typeof input.task !== 'string' || !['implementation', 'design', 'transfer', 'classification'].includes(input.task)
    || typeof input.objective !== 'string' || !input.objective.trim() || input.objective.length > 200
    || typeof input.evidence !== 'string' || input.evidence.length > 600) {
    throw new JevError('INVALID_REQUEST', 'Use a supported task, objective up to 200 characters and evidence excerpt up to 600 characters.');
  }
  return { task: input.task as DecisionReviewInput['task'], objective: input.objective.trim(), evidence: input.evidence.trim() };
}
/** Opt-in semantic review only. No startup calls, code execution, image inference or action approval. */
export async function reviewDecisionEvidence(dataDir: string, value: unknown, options: Options = {}): Promise<DecisionReviewResult> {
  const input = validateDecisionReview(value), started = performance.now();
  const inputSha256 = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const result: DecisionReviewResult = { task: input.task, inputSha256, status: 'needs-evidence', suggestion: 'unknown',
    probabilities: null, elapsedMs: 0, evaluationAttempts: 0, cached: false, usage: null, advisory: true };
  const finish = () => ({ ...result, elapsedMs: Math.round(performance.now() - started) });
  if (!input.evidence) return finish();
  if (active >= 2) { result.status = 'unavailable'; return finish(); }
  active++;
  const controller = new AbortController(), signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const timeoutMs = options.timeoutMs ?? 2000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    const stopped = new Promise<never>((_, reject) => {
      abort = () => reject(new JevError('TIMEOUT', 'Review cancelled or timed out.', 504));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      timer = setTimeout(() => controller.abort(), timeoutMs);
    });
    return await Promise.race([(async () => {
      const config = await (options.config ?? readJevConfig)(dataDir);
      if (signal.aborted) throw new JevError('TIMEOUT', 'Review cancelled or timed out.', 504);
      const key = createHash('sha256').update(JSON.stringify([dataDir, config, input])).digest('hex');
      const saved = cache.get(key);
      if (saved && saved.expires > Date.now()) return { ...saved.result, cached: true, evaluationAttempts: 0 as const, usage: null, elapsedMs: Math.round(performance.now() - started) };
      cache.delete(key);
      const request = buildDecisionReviewRequest({ ...input, objective: redactSecrets(input.objective), evidence: redactSecrets(input.evidence) }, config.model);
      result.evaluationAttempts = 1;
      const evaluation = await (options.evaluate ?? evaluateJev)(dataDir, request, { config, signal, timeoutMs });
      if (signal.aborted) throw new JevError('TIMEOUT', 'Review cancelled or timed out.', 504);
      const answer = evaluation.result.answers.alignment;
      if (answer?.type !== 'choice') throw new JevError('INVALID_RESPONSE', 'Invalid alignment answer.', 502);
      const sorted = Object.entries(answer.probabilities).sort((a,b) => b[1]-a[1]);
      const accepted = sorted[0]?.[0] === answer.choice && sorted[0][1] >= .8 && sorted[0][1] - (sorted[1]?.[1] ?? 0) >= .4;
      result.suggestion = answer.choice === 'supported' || answer.choice === 'contradicted' ? answer.choice : 'unknown';
      result.status = accepted && result.suggestion !== 'unknown' ? 'suggestion' : 'uncertain';
      result.probabilities = answer.probabilities; result.usage = evaluation.result.usage;
      const completed = finish();
      cache.set(key, { expires: Date.now()+180000, result: completed });
      while (cache.size > 64) cache.delete(cache.keys().next().value!);
      return completed;
    })(), stopped]);
  } catch (error) {
    result.status = signal.aborted || (error as {code?: string})?.code === 'TIMEOUT' ? 'timeout' : 'unavailable';
    result.suggestion = 'unknown'; result.probabilities = null; result.usage = null;
    return finish();
  } finally {
    active--;
    if (timer !== undefined) clearTimeout(timer);
    if (abort) signal.removeEventListener('abort', abort);
  }
}
