import { describe, expect, it, vi } from 'vitest';

import {
  BrowserVerificationEvidenceStore,
  runAutomaticBrowserVerification,
} from '../src/automatic-browser-verification.js';

describe('automatic browser verification', () => {
  it('clears completed session evidence without affecting other sessions', () => {
    const evidence = new BrowserVerificationEvidenceStore();
    evidence.record('session-a', 'click', true, 10);
    evidence.record('session-b', 'hover', true, 11);
    evidence.clear('session-a');
    expect(evidence.since('session-a', 0)).toEqual([]);
    expect(evidence.since('session-b', 0)).toHaveLength(1);
  });

  it('reloads and captures objective page evidence after a successful run', async () => {
    const evidence = new BrowserVerificationEvidenceStore();
    evidence.record('session_12345678901234567890', 'click', true, 10);
    const execute = vi.fn(async (input: any) => ({
      action: input.action,
      data: { results: input.steps.map((step: any) => ({ action: step.action, ok: true })) },
      ok: true,
      sessionId: input.sessionId,
    }));

    const result = await runAutomaticBrowserVerification({
      execute,
      evidence,
      sessionId: 'session_12345678901234567890',
      startedAt: 1,
      url: 'http://127.0.0.1:4173/orders',
    });

    expect(result).toMatchObject({
      ok: true,
      interactionActions: ['click'],
      verifiedActions: ['navigate', 'page-info', 'snapshot', 'screenshot'],
    });
  });

  it('does not claim success when a required capture step fails', async () => {
    const evidence = new BrowserVerificationEvidenceStore();
    const result = await runAutomaticBrowserVerification({
      execute: async (input: any) => ({
        action: input.action,
        data: { results: input.steps.map((step: any) => ({ action: step.action, ok: step.action !== 'screenshot' })) },
        ok: true,
        sessionId: input.sessionId,
      }),
      evidence,
      sessionId: 'session_12345678901234567890',
      startedAt: 1,
      url: 'http://127.0.0.1:4173/orders',
    });

    expect(result.ok).toBe(false);
    expect(result.verifiedActions).not.toContain('screenshot');
    expect(result.error).toContain('screenshot');
  });
});
