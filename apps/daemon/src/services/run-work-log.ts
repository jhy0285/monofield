import type Database from 'better-sqlite3';
import { getProject } from '../db.js';
import { scanRunEventsForUsageAnalytics } from '../run-analytics-observability.js';
import type { RunFinish, RunStart } from './run-outputs.js';

/** The fields of the in-memory run object (runtimes/runs.ts) the work log reads. */
export interface WorkLogRun {
  id: string;
  projectId: string | null;
  conversationId: string | null;
  agentId: string | null;
  request: string | null;
  requestedModel: string | null;
  status: string;
  events: Array<{ event?: string; data?: unknown }>;
}

/**
 * What the work log writes down when a run starts. The request is the person's words for this turn; schedulers
 * that create a run without them have just saved the prompt as the conversation's newest user message.
 */
export function runStartForWorkLog(db: Database.Database, run: WorkLogRun, deps: {
  agentName: (agentId: string) => string | null;
  projectRoot: (projectId: string, metadata: unknown) => string | null;
}): RunStart {
  const project = run.projectId ? getProject(db, run.projectId) : null;
  const newestUserMessage = () => run.conversationId
    ? (db.prepare(`SELECT content FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY position DESC LIMIT 1`).get(run.conversationId) as { content?: string } | undefined)?.content
    : undefined;
  const metadata = project?.metadata as { workMode?: string } | undefined;
  return {
    runId: run.id,
    projectId: project ? run.projectId : null,
    conversationId: run.conversationId,
    agentId: run.agentId,
    agentName: run.agentId ? deps.agentName(run.agentId) ?? run.agentId : null,
    model: run.requestedModel,
    request: run.request ?? newestUserMessage() ?? '',
    root: project && run.projectId ? deps.projectRoot(run.projectId, project.metadata) : null,
    development: metadata?.workMode === 'development',
  };
}

/**
 * How a run ended and what its tool reported using: the last usage the tool sent for the run. Input counts the whole
 * prompt, cached part included, whichever way the provider reports it.
 */
export function runFinishForWorkLog(run: WorkLogRun): RunFinish {
  const usage = scanRunEventsForUsageAnalytics(run.events as Parameters<typeof scanRunEventsForUsageAnalytics>[0], run.requestedModel, 0);
  const input = usage.input_tokens_effective ?? usage.input_tokens;
  const measured = input !== undefined || usage.output_tokens !== undefined || usage.total_tokens !== undefined;
  return {
    runId: run.id,
    status: run.status === 'succeeded' || run.status === 'canceled' ? run.status : 'failed',
    usage: measured ? {
      inputTokens: input ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      ...(usage.total_tokens !== undefined ? { totalTokens: usage.total_tokens } : {}),
    } : null,
  };
}
