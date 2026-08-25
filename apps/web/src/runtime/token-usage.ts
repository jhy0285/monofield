import { summarizeTokenUsage, type TokenUsageMetrics } from '@open-design/contracts';
import type { AgentEvent, ChatMessage } from '../types';

type UsageEvent = Extract<AgentEvent, { kind: 'usage' }>;

export function usageForEvents(
  events: readonly AgentEvent[] | undefined,
): TokenUsageMetrics | null {
  const reports = (events ?? []).filter(
    (event): event is UsageEvent => event.kind === 'usage',
  );
  return reports.length > 0 ? summarizeTokenUsage(reports) : null;
}

export interface ConversationUsageSummary {
  metrics: TokenUsageMetrics;
  assistantResponseCount: number;
  measuredResponseCount: number;
}

export function usageForConversation(
  messages: readonly ChatMessage[],
): ConversationUsageSummary {
  const assistantMessages = messages.filter((message) => message.role === 'assistant');
  const reports = assistantMessages.flatMap((message) => {
    const usage = usageForEvents(message.events);
    return usage ? [usage] : [];
  });
  return {
    metrics: summarizeTokenUsage(reports),
    assistantResponseCount: assistantMessages.length,
    measuredResponseCount: reports.filter(
      (report) => report.measurementSource !== 'unavailable',
    ).length,
  };
}

export function compactTokenCount(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 10_000 ? 1 : 0,
  }).format(value);
}

export function exactTokenCount(value: number | undefined): string {
  return value === undefined ? '—' : new Intl.NumberFormat().format(value);
}
