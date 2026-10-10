import type { JevEvaluation, JevRequest, VerificationAdvice, VerificationCheck, VerificationSource } from '@open-design/contracts';
import { buildVerificationAdviceRequest, verificationManualReview } from '@open-design/contracts';
import { evaluateJev, readJevConfig } from '../integrations/jev.js';
import { discoverVerificationChecks, verificationScriptNeedsManualSelection } from './verification-discovery.js';
import { verificationSource } from './verification-source.js';
import { verificationAdviceSnapshot } from './verification-advice-snapshot.js';

type Options = {
  signal?: AbortSignal;
  /** Internal seams keep timeout and source races observable without a provider. */
  timeoutMs?: number;
  discover?: (cwd: string) => Promise<VerificationCheck[]>;
  source?: (cwd: string) => Promise<VerificationSource>;
  config?: typeof readJevConfig;
  evaluate?: (dataDir: string, request: JevRequest, options: { signal: AbortSignal; timeoutMs: number }) => Promise<JevEvaluation>;
};
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
const cancelled = () => fail('Suggestion cancelled', 499);
const valid = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Suggestions never run commands or set a verification verdict. */
export async function suggestVerification(dataDir: string, cwd: string, projectPath: string, value: unknown, options: Options = {}): Promise<VerificationAdvice> {
  if (!valid(value) || typeof value.request !== 'string' || !value.request.trim() || value.request.length > 4_000
    || !['rules', 'model'].includes(String(value.mode))) throw fail('Provide a 1–4000 character request and rules or model mode');
  const request = value.request.trim(), started = performance.now();
  const discover = options.discover ?? discoverVerificationChecks, source = options.source ?? verificationSource;
  const checkCancelled = () => { if (options.signal?.aborted) throw cancelled(); };
  checkCancelled();
  const checks = await discover(cwd), before = await source(cwd);
  checkCancelled();
  const snapshotSha256 = verificationAdviceSnapshot(projectPath, checks, before);
  // Watching and auto-fixing scripts remain explicit manual selections.
  const candidates = checks.filter(c => !verificationScriptNeedsManualSelection(c.script));
  const advice: VerificationAdvice = { schemaVersion: 1, projectPath, availableCheckIds: checks.map(c => c.id),
    suggestedCheckIds: checks.filter(c => c.recommended).map(c => c.id), priorityCheckId: null,
    snapshotSha256, source: before, reason: 'rules', manualReview: verificationManualReview(request),
    elapsedMs: 0, evaluationAttempts: 0, usage: null, probabilities: null, relevance: null };
  if (!snapshotSha256) advice.reason = 'source-unavailable';
  else if (!candidates.length) advice.reason = 'none';
  else if (value.mode === 'model' && request.length > 400) advice.reason = 'long-request';
  else if (value.mode === 'model' && candidates.length > 6) advice.reason = 'too-many-checks';
  else if (value.mode === 'model') {
    const timeoutMs = options.timeoutMs ?? 2_000;
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    advice.evaluationAttempts = 1;
    try {
      const stop = new Promise<never>((_, reject) => {
        onAbort = () => reject(options.signal?.aborted ? cancelled() : fail('Decision deadline exceeded', 504));
        signal.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => controller.abort(), timeoutMs);
      });
      const evaluation = await Promise.race([(async () => {
        const config = await (options.config ?? readJevConfig)(dataDir);
        if (signal.aborted) throw options.signal?.aborted ? cancelled() : fail('Decision deadline exceeded', 504);
        return (options.evaluate ?? evaluateJev)(dataDir, buildVerificationAdviceRequest(request, candidates, config.model), { signal, timeoutMs });
      })(), stop]);
      checkCancelled();
      const result = evaluation.result;
      advice.usage = result.usage;
      const answer = result.answers.priority;
      if (answer?.type !== 'choice') throw fail('Invalid priority response');
      const ordered = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]);
      advice.probabilities = Object.fromEntries(ordered.map(([id, score]) => [id === 'NONE' ? 'NONE' : candidates[Number(id.slice(1)) - 1]?.id ?? id, score]));
      const relevance = Object.fromEntries(candidates.map((check, i) => {
        const fit = result.answers[`fit_C${i + 1}`];
        if (fit?.type !== 'noul') throw fail('Invalid relevance response');
        return [check.id, fit.noul];
      }));
      advice.relevance = relevance;
      const winner = ordered[0], next = ordered[1]?.[1] ?? 0;
      const candidate = candidates[Number(answer.choice.slice(1)) - 1];
      // Thresholds are conservative heuristics, not cross-model calibrated confidence.
      const accepted = candidate && winner?.[0] === answer.choice && winner[1] >= 0.8
        && winner[1] - next >= 0.5 && relevance[candidate.id]! >= 0.8;
      advice.suggestedCheckIds = accepted
        ? [candidate.id, ...candidates.filter(c => c.id !== candidate.id && relevance[c.id]! >= 0.8).map(c => c.id)]
        : [];
      advice.priorityCheckId = accepted ? candidate.id : null;
      advice.reason = answer.choice === 'NONE' && winner?.[0] === 'NONE' && winner[1] >= 0.8 ? 'none' : accepted ? 'model' : 'uncertain';
    } catch (e) {
      checkCancelled();
      advice.reason = signal.aborted || (e as { code?: string })?.code === 'TIMEOUT' ? 'timeout' : 'provider-unavailable';
      // Rules remain available; no usage is invented for an unsuccessful evaluation.
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  }
  checkCancelled();
  // Even failed inference cannot return advice for a catalog/source that changed meanwhile.
  const afterChecks = await discover(cwd), after = await source(cwd);
  checkCancelled();
  if (snapshotSha256 && verificationAdviceSnapshot(projectPath, afterChecks, after) !== snapshotSha256) {
    throw fail('Source or checks changed during the suggestion. Refresh and try again.', 409);
  }
  advice.elapsedMs = Math.round(performance.now() - started);
  return advice;
}
