// @vitest-environment jsdom
//
// MonoField's analytics provider is disabled, so the app version it reports is
// a fixed placeholder and the provider never asks the daemon for /api/version.
// The upstream behaviour this file used to pin (fetching the daemon version so
// every event carried it) is gone along with the events themselves; what must
// hold now is that the provider makes no request and that `track` goes nowhere.

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('analytics provider', () => {
  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));

  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockClear();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  async function loadProvider() {
    return import('../src/analytics/provider');
  }

  it('reports the 0.0.0 placeholder and never fetches the daemon version', async () => {
    const { useAppVersion } = await loadProvider();
    const { result } = renderHook(() => useAppVersion());
    await Promise.resolve();
    expect(result.current).toBe('0.0.0');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hands back the version a caller already has, without a request', async () => {
    const { resolveAppVersionForCapture } = await loadProvider();
    await expect(resolveAppVersionForCapture('0.0.0')).resolves.toBe('0.0.0');
    await expect(resolveAppVersionForCapture('9.9.9')).resolves.toBe('9.9.9');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives callers a working but disconnected analytics context', async () => {
    const { useAnalytics } = await loadProvider();
    const { result } = renderHook(() => useAnalytics());
    expect(() => {
      result.current.track('ui_click', { element: 'send' });
      result.current.setConsent(true);
      result.current.setIdentity('install-123');
      result.current.setUserId('user-1');
    }).not.toThrow();
    expect(result.current.anonymousId).toBe('disabled');
    expect(result.current.sessionId).toBe('disabled');
    expect(result.current.newRequestId()).toMatch(/[0-9a-f-]{8,}/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
