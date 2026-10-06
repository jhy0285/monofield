import { describe, expect, it } from 'vitest';
import { cumulativeDelta, providerUsage } from '../../lib/token-benchmark/usage.js';

describe('real benchmark usage accounting', () => {
  it('keeps cached input inside input rather than adding it to total', () => {
    expect(providerUsage({ input_tokens: 100, cached_input_tokens: 80, output_tokens: 5 }))
      .toEqual({ input: 100, cached: 80, output: 5, uncached: 20, total: 105 });
  });

  it('recognizes the daemon stream cache counter', () => {
    expect(providerUsage({ input_tokens: 100, cached_read_tokens: 0, output_tokens: 5 }).cached).toBe(0);
  });

  it.each([
    {}, { input_tokens: 100, output_tokens: 5 },
    { input_tokens: 100, cached_input_tokens: 101, output_tokens: 5 },
    { input_tokens: 100, cached_input_tokens: 10, output_tokens: -1 },
    { input_tokens: Number.NaN, cached_input_tokens: 0, output_tokens: 5 },
  ])('rejects incomplete or invalid usage instead of inventing zero counters: %j', value => {
    expect(() => providerUsage(value)).toThrow('Missing or invalid provider usage');
  });

  it('isolates a resumed turn from whole-session cumulative usage', () => {
    const before = providerUsage({ input_tokens: 100, cached_input_tokens: 80, output_tokens: 5 });
    const now = providerUsage({ input_tokens: 250, cached_input_tokens: 180, output_tokens: 12 });
    expect(cumulativeDelta(now, before)).toEqual({ input: 150, cached: 100, output: 7, uncached: 50, total: 157 });
  });

  it('rejects a fresh-session report passed as resumed cumulative usage', () => {
    const before = providerUsage({ input_tokens: 100, cached_input_tokens: 80, output_tokens: 5 });
    const now = providerUsage({ input_tokens: 90, cached_input_tokens: 10, output_tokens: 4 });
    expect(() => cumulativeDelta(now, before)).toThrow('not cumulative');
  });
});
