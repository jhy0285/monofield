import { describe, expect, it, vi } from 'vitest';

import {
  BrowserVerificationEvidenceStore,
  runAutomaticBrowserVerification,
} from '../src/automatic-browser-verification.js';

describe('automatic browser verification', () => {
  const stepData = (action: string) => {
    if (action === 'navigate' || action === 'page-info') return { title: 'Orders', url: 'http://127.0.0.1:4173/orders' };
    if (action === 'snapshot') return { url: 'http://127.0.0.1:4173/orders', elements: [] };
    if (action === 'screenshot') return { dataUrl: 'data:image/png;base64,cG5n', width: 1280, height: 720, url: 'http://127.0.0.1:4173/orders' };
    if (action === 'assert-text') return { matched: true, url: 'http://127.0.0.1:4173/orders' };
    return {};
  };
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
      data: { results: input.steps.map((step: any) => ({ action: step.action, data: stepData(step.action), ok: true })) },
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
      outcomeVerified: false,
      interactionActions: ['click'],
      verifiedActions: ['navigate', 'page-info', 'snapshot', 'screenshot'],
    });
  });

  it('does not claim success when a required capture step fails', async () => {
    const evidence = new BrowserVerificationEvidenceStore();
    const result = await runAutomaticBrowserVerification({
      execute: async (input: any) => ({
        action: input.action,
        data: { results: input.steps.map((step: any) => ({ action: step.action, data: stepData(step.action), ok: step.action !== 'screenshot' })) },
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

  it('only claims the requested outcome when visible text was confirmed', async () => {
    const evidence = new BrowserVerificationEvidenceStore();
    const execute = vi.fn(async (input: any) => ({
      action: input.action,
      data: { results: input.steps.map((step: any) => ({ action: step.action, data: stepData(step.action), ok: true })) },
      ok: true,
      sessionId: input.sessionId,
    }));
    const result = await runAutomaticBrowserVerification({
      execute, evidence, sessionId: 'session_12345678901234567890', startedAt: 1,
      url: 'http://127.0.0.1:4173/orders', expectedText: 'Saved successfully',
    });
    expect(result.outcomeVerified).toBe(true);
    expect(execute.mock.calls[0]?.[0].steps).toContainEqual({ action: 'assert-text', text: 'Saved successfully' });

    execute.mockImplementationOnce(async (input: any) => ({
      action: input.action,
      data: { results: input.steps.map((step: any) => ({
        action: step.action,
        data: step.action === 'assert-text' ? undefined : stepData(step.action),
        error: step.action === 'assert-text' ? 'Expected text was not visible in the approved tab' : undefined,
        ok: step.action !== 'assert-text',
      })) },
      ok: true,
      sessionId: input.sessionId,
    }));
    const failed = await runAutomaticBrowserVerification({
      execute, evidence, sessionId: 'session_12345678901234567890', startedAt: 1,
      url: 'http://127.0.0.1:4173/orders', expectedText: 'Saved successfully',
    });
    expect(failed.ok).toBe(false);
    expect(failed.outcomeVerified).toBe(false);
    expect(failed.error).toContain('Expected text was not visible');
  });

  it('rejects evidence captured after a redirect to another route', async () => {
    const result = await runAutomaticBrowserVerification({
      execute: async (input: any) => ({
        action: input.action, ok: true, sessionId: input.sessionId,
        data: { results: input.steps.map((step: any) => ({
          action: step.action, ok: true,
          data: step.action === 'snapshot'
            ? { elements: [], url: 'http://127.0.0.1:4173/login' }
            : stepData(step.action),
        })) },
      }),
      evidence: new BrowserVerificationEvidenceStore(),
      sessionId: 'session_12345678901234567890', startedAt: 1,
      url: 'http://127.0.0.1:4173/orders',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('snapshot');
  });
});
