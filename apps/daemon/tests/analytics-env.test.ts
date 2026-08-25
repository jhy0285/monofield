import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const posthogCapture = vi.hoisted(() => vi.fn());
const posthogCtor = vi.hoisted(() =>
  vi.fn(function PostHogMock(_key: string, _options?: Record<string, unknown>) {
    return {
      capture: posthogCapture,
      on: vi.fn(),
      shutdown: vi.fn(async () => undefined),
    };
  }),
);

vi.mock('posthog-node', () => ({
  PostHog: posthogCtor,
}));

// MonoField disables product telemetry at the daemon boundary (see
// src/analytics.ts). These tests guard that boundary: even with a PostHog key
// in the environment, the public config must report disabled and no PostHog
// client may ever be constructed or receive events.
describe('analytics telemetry environment', () => {
  it('reports telemetry disabled in public analytics config even when a key is set', async () => {
    const { readPublicConfigResponse } = await import('../src/analytics.js');

    expect(readPublicConfigResponse({
      POSTHOG_KEY: 'phc_test',
      OD_TELEMETRY_ENV: 'local_development',
    })).toMatchObject({
      enabled: false,
      key: null,
      host: null,
    });
  });

  it('never reads a PostHog config from the environment', async () => {
    const { readPosthogConfig } = await import('../src/analytics.js');

    expect(readPosthogConfig({
      POSTHOG_KEY: 'phc_test',
      POSTHOG_HOST: 'https://posthog.example',
      OD_TELEMETRY_ENV: 'local_development',
    })).toBeNull();
  });

  it('capture is a no-op: no PostHog client is constructed and no event is sent', async () => {
    posthogCtor.mockClear();
    posthogCapture.mockClear();
    const dataDir = await mkdtemp(path.join(tmpdir(), 'od-analytics-noop-'));
    const { createAnalyticsService } = await import('../src/analytics.js');
    const analytics = createAnalyticsService({
      dataDir,
      env: { POSTHOG_KEY: 'phc_test', OD_TELEMETRY_ENV: 'local_development' },
    });

    analytics.capture({
      eventName: 'unit_event',
      appVersion: '1.2.3',
      context: {
        deviceId: 'device-1',
        sessionId: 'session-1',
        clientType: 'web',
        locale: 'en',
        requestId: null,
      },
      insertId: 'insert-1',
      properties: {},
    });
    await analytics.captureSafety({
      eventName: 'safety_event',
      appVersion: '1.2.3',
      properties: {},
    });
    await analytics.shutdown();

    expect(posthogCtor).not.toHaveBeenCalled();
    expect(posthogCapture).not.toHaveBeenCalled();
  });
});
