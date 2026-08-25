export type TokenUsageMeasurementSource =
  | 'provider_usage'
  | 'estimated'
  | 'unavailable';

export interface TokenUsageMetrics {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  durationMs?: number;
  measurementSource: TokenUsageMeasurementSource;
}

export interface ProviderTokenUsagePayload {
  input_tokens?: number;
  prompt_tokens?: number;
  output_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  totalTokens?: number;
  thought_tokens?: number;
  reasoning_output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_write_input_tokens?: number;
  cached_input_tokens?: number;
  cached_read_tokens?: number;
  cached_write_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const normalized = finiteNonNegative(value);
    if (normalized !== undefined) return normalized;
  }
  return undefined;
}

/**
 * Normalizes the provider/CLI aliases MonoField currently receives.
 * `inputTokens` is effective input: Anthropic's separately reported cache
 * reads/writes are folded in, while OpenAI-compatible cached input remains a
 * subset of prompt tokens and is therefore not double-counted.
 */
export function normalizeProviderTokenUsage(
  raw: ProviderTokenUsagePayload | Record<string, unknown> | null | undefined,
  extras: {
    costUsd?: number | null;
    durationMs?: number | null;
    measurementSource?: TokenUsageMeasurementSource;
  } = {},
): TokenUsageMetrics {
  const usage = (raw && typeof raw === 'object' ? raw : {}) as ProviderTokenUsagePayload;
  const providerInputTokens = firstNumber(usage.input_tokens, usage.prompt_tokens);
  const outputTokens = firstNumber(usage.output_tokens, usage.completion_tokens);
  const reasoningTokens = firstNumber(
    usage.thought_tokens,
    usage.reasoning_output_tokens,
    usage.output_tokens_details?.reasoning_tokens,
  );
  const anthropicCacheRead = finiteNonNegative(usage.cache_read_input_tokens);
  const anthropicCacheWrite = firstNumber(
    usage.cache_creation_input_tokens,
    usage.cache_write_input_tokens,
  );
  const normalizedCacheRead = firstNumber(
    usage.cached_input_tokens,
    usage.cached_read_tokens,
    usage.cache_read_tokens,
    usage.prompt_tokens_details?.cached_tokens,
  );
  const normalizedCacheWrite = firstNumber(
    usage.cached_write_tokens,
    usage.cache_write_tokens,
  );
  const cachedInputTokens =
    anthropicCacheRead !== undefined || anthropicCacheWrite !== undefined
      ? (anthropicCacheRead ?? 0) + (anthropicCacheWrite ?? 0)
      : normalizedCacheRead !== undefined || normalizedCacheWrite !== undefined
        ? (normalizedCacheRead ?? 0) + (normalizedCacheWrite ?? 0)
        : undefined;
  const inputTokens =
    providerInputTokens !== undefined
      ? anthropicCacheRead !== undefined || anthropicCacheWrite !== undefined
        ? providerInputTokens + (anthropicCacheRead ?? 0) + (anthropicCacheWrite ?? 0)
        : providerInputTokens
      : undefined;
  const providerTotal = firstNumber(usage.total_tokens, usage.totalTokens);
  const totalTokens =
    providerTotal ??
    (inputTokens !== undefined || outputTokens !== undefined
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined);
  const costUsd = finiteNonNegative(extras.costUsd);
  const durationMs = finiteNonNegative(extras.durationMs);
  const hasTokenMeasurement =
    inputTokens !== undefined ||
    outputTokens !== undefined ||
    reasoningTokens !== undefined ||
    totalTokens !== undefined;

  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    measurementSource:
      extras.measurementSource ?? (hasTokenMeasurement ? 'provider_usage' : 'unavailable'),
  };
}

export function summarizeTokenUsage(
  reports: ReadonlyArray<Partial<TokenUsageMetrics> | null | undefined>,
): TokenUsageMetrics {
  const usable = reports.filter(
    (report): report is Partial<TokenUsageMetrics> => report != null,
  );
  const sum = (key: keyof TokenUsageMetrics): number | undefined => {
    let total = 0;
    let found = false;
    for (const report of usable) {
      const value = finiteNonNegative(report[key]);
      if (value === undefined) continue;
      total += value;
      found = true;
    }
    return found ? total : undefined;
  };
  const durationMs = usable.reduce<number | undefined>((max, report) => {
    const value = finiteNonNegative(report.durationMs);
    return value === undefined ? max : Math.max(max ?? 0, value);
  }, undefined);
  const hasReportedTokens = usable.some((report) =>
    finiteNonNegative(report.inputTokens) !== undefined ||
    finiteNonNegative(report.cachedInputTokens) !== undefined ||
    finiteNonNegative(report.outputTokens) !== undefined ||
    finiteNonNegative(report.reasoningTokens) !== undefined ||
    finiteNonNegative(report.totalTokens) !== undefined
  );
  const sources = usable.map((report) => report.measurementSource).filter(Boolean);
  const measurementSource: TokenUsageMeasurementSource = sources.includes('estimated')
    ? 'estimated'
    : sources.includes('provider_usage')
      ? 'provider_usage'
      : hasReportedTokens
        ? 'provider_usage'
        : 'unavailable';
  const inputTokens = sum('inputTokens');
  const cachedInputTokens = sum('cachedInputTokens');
  const outputTokens = sum('outputTokens');
  const reasoningTokens = sum('reasoningTokens');
  const reportedTotalTokens = sum('totalTokens');
  const totalTokens = reportedTotalTokens ?? (
    inputTokens !== undefined || outputTokens !== undefined
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined
  );
  const costUsd = sum('costUsd');

  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    measurementSource,
  };
}
