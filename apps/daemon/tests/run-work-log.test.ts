import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, insertConversation, insertProject, openDatabase, upsertMessage } from '../src/db.js';
import { createChatRunService } from '../src/runtimes/runs.js';
import { createRunOutputStore, type RunOutputStore } from '../src/services/run-outputs.js';
import { runFinishForWorkLog, runStartForWorkLog } from '../src/services/run-work-log.js';

// Every run goes through the run service, whichever route or scheduler created it. The work log hangs on the
// service's start and finish, so a chat turn, an automation and an MCP-started run are all written down.
describe('work log on the run service', () => {
  let data: string;
  let project: string;
  let db: ReturnType<typeof openDatabase>;
  let store: RunOutputStore;
  let runs: ReturnType<typeof createChatRunService>;

  beforeEach(async () => {
    data = await mkdtemp(path.join(os.tmpdir(), 'monofield-work-log-'));
    project = path.join(data, 'projects', 'p1');
    await mkdir(project, { recursive: true });
    db = openDatabase(data, { dataDir: data });
    insertProject(db, { id: 'p1', name: '주문 시스템', createdAt: 1, updatedAt: 1 });
    insertConversation(db, { id: 'c1', projectId: 'p1', title: null, createdAt: 1, updatedAt: 1 });
    store = createRunOutputStore({ db, dataDir: data });
    runs = createChatRunService({
      createSseResponse: () => ({ send() {}, end() {} }),
      createSseErrorPayload: (code: string, message: string) => ({ code, message }),
      onStart: (run) => store.start(runStartForWorkLog(db, run, {
        agentName: (agentId) => (agentId === 'codex' ? 'Codex CLI' : null),
        projectRoot: () => project,
      })),
      onFinish: (run) => { finished = store.finish(runFinishForWorkLog(run)); },
    });
  });
  let finished: Promise<unknown> = Promise.resolve();
  afterEach(async () => {
    closeDatabase();
    await rm(data, { recursive: true, force: true });
  });

  it('writes down a chat turn with its request, tool, usage and the file it left', async () => {
    const run = runs.create({ projectId: 'p1', conversationId: 'c1', agentId: 'codex', currentPrompt: '주문 명세서를\n만들어 줘', model: 'gpt-5.2' });
    runs.start(run, async () => {
      expect(store.runs({}).runs[0]).toMatchObject({ runId: run.id, status: 'running', request: '주문 명세서를 만들어 줘' });
      await writeFile(path.join(project, 'orders.md'), '# 주문');
      runs.emit(run, 'agent', { type: 'usage', usage: { input_tokens: 1200, output_tokens: 300, cached_input_tokens: 1000, total_tokens: 1500 } });
      runs.finish(run, 'succeeded', 0, null);
    });
    await runs.wait(run);
    await finished;

    expect(store.runs({}).runs[0]).toMatchObject({
      runId: run.id, status: 'succeeded', agentId: 'codex', agentName: 'Codex CLI', model: 'gpt-5.2', projectName: '주문 시스템', outputCount: 1,
      usage: { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 1000, totalTokens: 1500, measured: true },
    });
    expect(store.list({}).outputs.map((output) => [output.path, output.runId])).toEqual([['orders.md', run.id]]);
  });

  it('takes the request from the conversation when a scheduler created the run, and records a failure without usage', async () => {
    const run = runs.create({ projectId: 'p1', conversationId: 'c1', agentId: 'claude' });
    upsertMessage(db, 'c1', { id: 'u1', role: 'user', content: '매일 아침 상태판을 갱신해 줘' });
    runs.start(run, async () => { throw new Error('the CLI is not installed'); });
    await runs.wait(run);
    await finished;

    expect(store.runs({}).runs[0]).toMatchObject({
      status: 'failed', request: '매일 아침 상태판을 갱신해 줘', agentName: 'claude', outputCount: 0, usage: { measured: false, totalTokens: 0 },
    });
  });

  it('logs a run that has no project without looking at any folder', async () => {
    const run = runs.create({ agentId: 'codex', currentPrompt: '질문 하나' });
    runs.start(run, async () => { runs.finish(run, 'canceled', null, 'SIGTERM'); });
    await runs.wait(run);
    await finished;
    expect(store.runs({}).runs[0]).toMatchObject({ projectId: null, status: 'canceled', outputCount: 0 });
  });
});
