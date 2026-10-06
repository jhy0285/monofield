export type Usage = { input: number; cached: number; output: number; uncached: number; total: number };

/** Missing provider counters are unknown, including the cached-input counter. */
export function providerUsage(value: unknown): Usage {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const input = record.input_tokens;
  const cached = record.cached_read_tokens ?? record.cached_input_tokens;
  const output = record.output_tokens;
  if (typeof input !== 'number' || typeof cached !== 'number' || typeof output !== 'number'
    || ![input, cached, output].every(n => Number.isSafeInteger(n) && n >= 0)
    || input <= 0 || cached > input || !Number.isSafeInteger(input + output)) {
    throw new Error('Missing or invalid provider usage; not counted as zero.');
  }
  return { input, cached, output, uncached: input - cached, total: input + output };
}

/** Subtract a verified previous total only within the same resumed session. */
export function cumulativeDelta(now: Usage, before: Usage | null): Usage {
  if (!before) return now;
  if (now.input < before.input || now.cached < before.cached || now.output < before.output) {
    throw new Error('Resume usage is not cumulative as expected; inspect raw events before comparison.');
  }
  return providerUsage({ input_tokens: now.input - before.input, cached_input_tokens: now.cached - before.cached,
    output_tokens: now.output - before.output });
}
