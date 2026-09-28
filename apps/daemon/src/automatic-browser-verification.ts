import type {
  DesktopBrowserAutomationInput,
  DesktopBrowserAutomationResult,
} from '@open-design/sidecar-proto';

const INTERACTION_ACTIONS = new Set(['click', 'drag', 'hover', 'scroll', 'type-text', 'upload']);
const REQUIRED_VERIFICATION_ACTIONS = ['page-info', 'snapshot', 'screenshot'] as const;
const MAX_EVIDENCE_PER_SESSION = 100;
const MAX_EVIDENCE_SESSIONS = 256;

export type BrowserVerificationEvidence = {
  action: string;
  at: number;
  ok: boolean;
};

export class BrowserVerificationEvidenceStore {
  readonly #sessions = new Map<string, BrowserVerificationEvidence[]>();

  record(sessionId: string, action: string, ok: boolean, at = Date.now()): void {
    if (!sessionId || !action) return;
    if (!this.#sessions.has(sessionId) && this.#sessions.size >= MAX_EVIDENCE_SESSIONS) {
      const oldestSession = this.#sessions.keys().next().value;
      if (typeof oldestSession === 'string') this.#sessions.delete(oldestSession);
    }
    const evidence = this.#sessions.get(sessionId) ?? [];
    evidence.push({ action, at, ok });
    this.#sessions.set(sessionId, evidence.slice(-MAX_EVIDENCE_PER_SESSION));
  }

  recordResult(input: DesktopBrowserAutomationInput, result: DesktopBrowserAutomationResult, at = Date.now()): void {
    if (input.action === 'batch') {
      const results = (result.data as { results?: Array<{ action?: unknown; ok?: unknown }> } | null)?.results;
      if (Array.isArray(results)) {
        for (const step of results) {
          if (typeof step.action === 'string') this.record(input.sessionId, step.action, step.ok === true, at);
        }
        return;
      }
    }
    this.record(input.sessionId, input.action, result.ok, at);
  }

  since(sessionId: string, startedAt: number): BrowserVerificationEvidence[] {
    return (this.#sessions.get(sessionId) ?? []).filter((item) => item.at >= startedAt);
  }

  clear(sessionId: string): void {
    this.#sessions.delete(sessionId);
  }
}

export type AutomaticBrowserVerificationResult = {
  error: string | null;
  interactionActions: string[];
  ok: boolean;
  outcomeVerified: boolean;
  verifiedActions: string[];
  artifacts?: { screenshotUrl: string; reportUrl: string };
};

export type BrowserVerificationCapture = {
  screenshot: { dataUrl: string; width: number; height: number; url: string };
  snapshot: Record<string, unknown>;
  result: AutomaticBrowserVerificationResult;
};

/**
 * Always performs an objective, read-only post-run pass in the approved tab.
 * The agent may additionally exercise task-specific interactions; those are
 * reported from the bounded evidence store instead of being assumed. Never
 * navigate here: reloading destroys transient results of those interactions.
 */
export async function runAutomaticBrowserVerification(options: {
  execute: (input: DesktopBrowserAutomationInput) => Promise<DesktopBrowserAutomationResult>;
  evidence: BrowserVerificationEvidenceStore;
  sessionId: string;
  startedAt: number;
  url: string;
  expectedText?: string;
  persistEvidence?: (capture: BrowserVerificationCapture) => Promise<NonNullable<AutomaticBrowserVerificationResult['artifacts']>>;
}): Promise<AutomaticBrowserVerificationResult> {
  const expectedText = options.expectedText?.trim();
  const input: DesktopBrowserAutomationInput = {
    action: 'batch',
    continueOnError: true,
    sessionId: options.sessionId,
    steps: [
      ...(expectedText ? [{ action: 'assert-text' as const, text: expectedText }] : []),
      { action: 'page-info' },
      { action: 'snapshot' },
      { action: 'screenshot' },
    ],
  };
  let result: DesktopBrowserAutomationResult;
  try {
    result = await options.execute(input);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      interactionActions: [],
      ok: false,
      outcomeVerified: false,
      verifiedActions: [],
    };
  }
  if (result.sessionId !== options.sessionId || result.action !== 'batch') {
    return {
      error: 'Browser evidence does not belong to the requested session and batch.',
      interactionActions: [], ok: false, outcomeVerified: false, verifiedActions: [],
    };
  }
  options.evidence.recordResult(input, result);
  const evidence = options.evidence.since(options.sessionId, options.startedAt);
  const steps = (result.data as { results?: Array<{ action?: string; data?: unknown; error?: string; ok?: boolean }> } | null)?.results;
  const completed = Array.isArray(steps) ? steps : [];
  const matchesTargetRoute = (observed: unknown): boolean => {
    if (typeof observed !== 'string') return false;
    try {
      const actual = new URL(observed);
      const target = new URL(options.url);
      const route = (url: URL) => url.pathname.replace(/\/+$/, '') || '/';
      return actual.origin === target.origin && route(actual) === route(target);
    } catch { return false; }
  };
  const validStep = (action: string): boolean => completed.some((step) => {
    if (step.action !== action || step.ok !== true) return false;
    const data = step.data as Record<string, unknown> | null;
    if (!data || typeof data !== 'object') return false;
    if (action === 'page-info') return matchesTargetRoute(data.url) && typeof data.title === 'string';
    if (action === 'snapshot') return Array.isArray(data.elements) && matchesTargetRoute(data.url);
    if (action === 'screenshot') return typeof data.dataUrl === 'string'
      && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data.dataUrl)
      && typeof data.width === 'number' && data.width > 0
      && typeof data.height === 'number' && data.height > 0 && matchesTargetRoute(data.url);
    if (action === 'assert-text') return data.matched === true && matchesTargetRoute(data.url);
    return false;
  });
  const verifiedActions = [...REQUIRED_VERIFICATION_ACTIONS, ...(expectedText ? ['assert-text' as const] : [])]
    .filter(validStep);
  const interactionActions = Array.from(new Set(
    evidence.filter((item) => item.ok && INTERACTION_ACTIONS.has(item.action)).map((item) => item.action),
  ));
  const required = [...REQUIRED_VERIFICATION_ACTIONS, ...(expectedText ? ['assert-text' as const] : [])];
  const failed = required.filter((action) => !verifiedActions.includes(action));
  const ok = result.ok && failed.length === 0;
  const stepError = completed.find((step) => failed.some((action) => action === step.action)
    && step.ok === false && typeof step.error === 'string')?.error;
  const verification: AutomaticBrowserVerificationResult = {
    error: ok ? null : result.error ?? stepError ?? (failed.length > 0
      ? `Browser evidence missing or invalid: ${failed.join(', ')}`
      : 'The approved browser tab did not complete the required verification actions.'),
    interactionActions,
    ok,
    outcomeVerified: ok && Boolean(expectedText),
    verifiedActions,
  };
  if (options.persistEvidence && validStep('screenshot') && validStep('snapshot')) {
    try {
      verification.artifacts = await options.persistEvidence({
        screenshot: completed.find((step) => step.action === 'screenshot' && step.ok)?.data as BrowserVerificationCapture['screenshot'],
        snapshot: completed.find((step) => step.action === 'snapshot' && step.ok)?.data as Record<string, unknown>,
        result: { ...verification },
      });
    } catch (error) {
      verification.ok = false;
      verification.outcomeVerified = false;
      verification.error = `Browser evidence could not be saved: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return verification;
}
