// @vitest-environment jsdom
//
// MonoField's browser analytics client is inert: it never loads PostHog, never
// starts session replay, and never asks the daemon for an analytics key. The
// page is full of sensitive content (prompts, generated artifacts, BYOK keys),
// so a screen recording or event stream leaving the machine would be a privacy
// failure. This suite pins that nothing is initialised or fetched, whatever the
// caller passes in.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const posthogInit = vi.fn();
const posthogRegister = vi.fn();

vi.mock('posthog-js', () => ({
  default: {
    init: posthogInit,
    register: posthogRegister,
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    reset: vi.fn(),
    identify: vi.fn(),
  },
}));

const CONTEXT = {
  anonymousId: 'anon-1',
  sessionId: 'sess-1',
  clientType: 'web',
  locale: 'en',
  appVersion: '1.2.3',
};

describe('browser analytics client', () => {
  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));

  beforeEach(() => {
    posthogInit.mockReset();
    posthogRegister.mockReset();
    fetchMock.mockClear();
    vi.resetModules();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns no client, so no session replay can start', async () => {
    const { getAnalyticsClient } = await import('../src/analytics/client');
    await expect(getAnalyticsClient(CONTEXT)).resolves.toBeNull();
    expect(posthogInit).not.toHaveBeenCalled();
  });

  it('does not ask the daemon for an analytics key or any other endpoint', async () => {
    const { getAnalyticsClient, bootstrapExceptionTracking } = await import('../src/analytics/client');
    await getAnalyticsClient(CONTEXT);
    await bootstrapExceptionTracking(CONTEXT);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stays inert after consent is granted or an identity is applied', async () => {
    const { getAnalyticsClient, applyConsent, applyIdentity, getResolvedDeviceId, getResolvedAnonymousId, setAnalyticsUserId } =
      await import('../src/analytics/client');
    applyConsent(true);
    applyIdentity('install-123');
    setAnalyticsUserId('user-1');
    await expect(getAnalyticsClient(CONTEXT)).resolves.toBeNull();
    expect(getResolvedDeviceId()).toBeNull();
    expect(getResolvedAnonymousId()).toBeNull();
    expect(posthogInit).not.toHaveBeenCalled();
    expect(posthogRegister).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops a capture instead of sending it', async () => {
    const { capture } = await import('../src/analytics/client');
    capture(null, { event: 'ui_click', properties: { element: 'send' }, insertId: 'i-1', requestId: 'r-1' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the configure globals locally for the UI without sending them', async () => {
    const { getConfigureGlobals, setConfigureGlobals } = await import('../src/analytics/client');
    expect(getConfigureGlobals().runtime_type).toBe('none');
    setConfigureGlobals({ ...getConfigureGlobals(), runtime_type: 'local_cli', cli_runnable: true });
    expect(getConfigureGlobals()).toMatchObject({ runtime_type: 'local_cli', cli_runnable: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
