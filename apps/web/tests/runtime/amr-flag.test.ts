import { afterEach, describe, expect, it, vi } from 'vitest';

describe('ENABLE_AMR_RUNTIME', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  // The AMR cloud runtime is the upstream model router. MonoField ships it
  // switched off, the same way the daemon does (OD_ENABLE_AMR=1 turns it on).
  it('is off unless the renderer flag is exactly "1"', async () => {
    for (const value of [undefined, '', '0', 'true', 'yes']) {
      vi.resetModules();
      if (value === undefined) vi.unstubAllEnvs();
      else vi.stubEnv('NEXT_PUBLIC_OD_ENABLE_AMR', value);
      const { ENABLE_AMR_RUNTIME } = await import('../../src/runtime/amr-flag');
      expect(ENABLE_AMR_RUNTIME, String(value)).toBe(false);
    }
  });

  it('is on when the renderer flag is "1"', async () => {
    vi.stubEnv('NEXT_PUBLIC_OD_ENABLE_AMR', '1');
    vi.resetModules();
    const { ENABLE_AMR_RUNTIME } = await import('../../src/runtime/amr-flag');
    expect(ENABLE_AMR_RUNTIME).toBe(true);
  });
});
