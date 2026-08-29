import type {
  DesktopBrowserAutomationInput,
  DesktopBrowserAutomationResult,
} from '@open-design/sidecar-proto';

const INTERACTION_ACTIONS = new Set(['click', 'drag', 'hover', 'scroll', 'type-text', 'upload']);
const REQUIRED_VERIFICATION_ACTIONS = ['navigate', 'page-info', 'snapshot', 'screenshot'] as const;
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
  verifiedActions: string[];
};

/**
 * Always performs an objective, read-only post-run pass in the approved tab.
 * The agent may additionally exercise task-specific interactions; those are
 * reported from the bounded evidence store instead of being assumed.
 */
export async function runAutomaticBrowserVerification(options: {
  execute: (input: DesktopBrowserAutomationInput) => Promise<DesktopBrowserAutomationResult>;
  evidence: BrowserVerificationEvidenceStore;
  sessionId: string;
  startedAt: number;
  url: string;
}): Promise<AutomaticBrowserVerificationResult> {
  const input: DesktopBrowserAutomationInput = {
    action: 'batch',
    continueOnError: true,
    sessionId: options.sessionId,
    steps: [
      { action: 'navigate', url: options.url },
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
      verifiedActions: [],
    };
  }
  options.evidence.recordResult(input, result);
  const evidence = options.evidence.since(options.sessionId, options.startedAt);
  const verifiedActions = REQUIRED_VERIFICATION_ACTIONS
    .filter((action) => evidence.some((item) => item.action === action && item.ok));
  const interactionActions = Array.from(new Set(
    evidence.filter((item) => item.ok && INTERACTION_ACTIONS.has(item.action)).map((item) => item.action),
  ));
  const failed = evidence.filter((item) =>
    !item.ok && REQUIRED_VERIFICATION_ACTIONS.some((action) => action === item.action));
  const ok = result.ok && verifiedActions.length === REQUIRED_VERIFICATION_ACTIONS.length;
  return {
    error: ok ? null : result.error ?? (failed.length > 0
      ? `Failed browser actions: ${failed.map((item) => item.action).join(', ')}`
      : 'The approved browser tab did not complete the required verification actions.'),
    interactionActions,
    ok,
    verifiedActions,
  };
}
