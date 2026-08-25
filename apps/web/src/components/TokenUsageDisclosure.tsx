import type { TokenUsageMetrics, TokenUsageMeasurementSource } from '@open-design/contracts';
import { useT } from '../i18n';
import { compactTokenCount, exactTokenCount } from '../runtime/token-usage';

interface Props {
  metrics: TokenUsageMetrics;
  variant: 'response' | 'conversation';
  measuredResponses?: number;
  totalResponses?: number;
}

function sourceLabel(
  source: TokenUsageMeasurementSource,
  t: ReturnType<typeof useT>,
): string {
  if (source === 'provider_usage') return t('assistant.usageMeasured');
  if (source === 'estimated') return t('assistant.usageEstimated');
  return t('assistant.usageUnavailable');
}

function formatCost(value: number | undefined, unavailable: string): string {
  if (value === undefined) return unavailable;
  if (value === 0) return '$0.00';
  if (value < 0.0001) return `$${value.toFixed(6)}`;
  return `$${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;
}

function UsageValue({
  value,
  unit,
}: {
  value: string;
  unit?: string;
}) {
  return (
    <dd>
      <span>{value}</span>
      {value !== '—' && unit ? <small>{unit}</small> : null}
    </dd>
  );
}

export function TokenUsageDisclosure({
  metrics,
  variant,
  measuredResponses,
  totalResponses,
}: Props) {
  const t = useT();
  const title = variant === 'conversation'
    ? t('assistant.usageConversation')
    : t('assistant.usage');
  const source = sourceLabel(metrics.measurementSource, t);
  const compactTotal = metrics.totalTokens === undefined
    ? null
    : compactTokenCount(metrics.totalTokens);
  const sourceHint = metrics.measurementSource === 'provider_usage'
    ? t('assistant.usageHintMeasured')
    : metrics.measurementSource === 'estimated'
      ? t('assistant.usageHintEstimated')
      : t('assistant.usageHintUnavailable');
  const hasReportedCost = metrics.costUsd !== undefined;
  const newInputTokens = metrics.inputTokens === undefined
    ? undefined
    : Math.max(0, metrics.inputTokens - (metrics.cachedInputTokens ?? 0));

  return (
    <details
      name="token-usage"
      className={`token-usage token-usage--${variant}`}
      data-testid={`${variant}-usage`}
    >
      <summary role="button" aria-label={`${title}: ${source}`}>
        <span>{title}</span>
        {compactTotal ? <strong>{compactTotal}</strong> : null}
        <em data-source={metrics.measurementSource}>{source}</em>
      </summary>
      <div className="token-usage__popover">
        <div className="token-usage__head">
          <strong>{title}</strong>
          <span data-source={metrics.measurementSource}>{source}</span>
        </div>
        {variant === 'conversation' && totalResponses !== undefined ? (
          <div className="token-usage__coverage">
            {t('assistant.usageCoverage', {
              measured: measuredResponses ?? 0,
              total: totalResponses,
            })}
          </div>
        ) : null}
        <p className="token-usage__scope">
          {variant === 'conversation'
            ? t('assistant.usageScopeConversation')
            : t('assistant.usageScopeResponse')}
        </p>
        <div className="token-usage__units" aria-label={t('assistant.usageUnits')}>
          <span>{t('assistant.usageUnits')}</span>
          <strong>{t('assistant.usageUnitTokens')}</strong>
          <i aria-hidden="true" />
          <strong>{hasReportedCost
            ? t('assistant.usageUnitUsd')
            : t('assistant.usageUnitUsdWhenAvailable')}</strong>
        </div>
        <dl className="token-usage__grid">
          <div><dt>{t('assistant.usageInput')}</dt><UsageValue value={exactTokenCount(newInputTokens)} unit={t('assistant.usageUnitTokens')} /></div>
          <div><dt>{t('assistant.usageCached')}</dt><UsageValue value={exactTokenCount(metrics.cachedInputTokens)} unit={t('assistant.usageUnitTokens')} /></div>
          <div><dt>{t('assistant.usageOutput')}</dt><UsageValue value={exactTokenCount(metrics.outputTokens)} unit={t('assistant.usageUnitTokens')} /></div>
          <div><dt>{t('assistant.usageReasoning')}</dt><UsageValue value={exactTokenCount(metrics.reasoningTokens)} unit={t('assistant.usageUnitTokens')} /></div>
          <div><dt>{t('assistant.usageTotal')}</dt><UsageValue value={exactTokenCount(metrics.totalTokens)} unit={t('assistant.usageUnitTokens')} /></div>
          <div data-cost-reported={hasReportedCost ? 'true' : 'false'}>
            <dt>{t('assistant.usageCost')}</dt>
            <UsageValue
              value={formatCost(metrics.costUsd, t('assistant.usageCostUnavailable'))}
              unit={hasReportedCost ? t('assistant.usageUnitUsd') : undefined}
            />
          </div>
        </dl>
        <p className="token-usage__hint">{sourceHint}</p>
        {!hasReportedCost ? (
          <p className="token-usage__cost-hint">{t('assistant.usageCostUnavailableHint')}</p>
        ) : null}
        <details className="token-usage__method">
          <summary>{t('assistant.usageMethod')}</summary>
          <div>
            <p>{t('assistant.usageTokenDefinition')}</p>
            <ul>
              <li>{t('assistant.usageTotalDefinition')}</li>
              <li>{t('assistant.usageCacheDefinition')}</li>
              <li>{t('assistant.usageReasoningDefinition')}</li>
              <li>{t('assistant.usageCostDefinition')}</li>
              <li>{t('assistant.usageContextDefinition')}</li>
              {metrics.measurementSource === 'estimated' ? (
                <li>{t('assistant.usageEstimateDefinition')}</li>
              ) : null}
            </ul>
          </div>
        </details>
      </div>
    </details>
  );
}
