import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, deleteProject, insertProject, openDatabase } from '../src/db.js';
import { createRunOutputStore, type RunOutputStore } from '../src/services/run-outputs.js';

// The work log and the result shelf: every run is written down with what was asked and what it used, and every
// file it created or changed is copied, so a result is still there after a later run overwrote it.
describe('run outputs', () => {
  let data: string;
  let project: string;
  let store: RunOutputStore;
  let db: ReturnType<typeof openDatabase>;
  let clock: number;

  beforeEach(async () => {
    data = await mkdtemp(path.join(os.tmpdir(), 'monofield-run-outputs-'));
    project = path.join(data, 'projects', 'p1');
    await mkdir(project, { recursive: true });
    db = openDatabase(data, { dataDir: data });
    insertProject(db, { id: 'p1', name: '주문 시스템', createdAt: 1, updatedAt: 1 });
    clock = 1_000;
    store = createRunOutputStore({ db, dataDir: data, now: () => (clock += 1_000) });
  });
  afterEach(async () => {
    closeDatabase();
    await rm(data, { recursive: true, force: true });
  });

  async function put(relative: string, body: string) {
    const file = path.join(project, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }
  /** One run: `work` is what the AI tool does to the project folder. */
  async function run(runId: string, work: () => Promise<void>, extra: { agentId?: string; request?: string; status?: 'succeeded' | 'failed'; usage?: Record<string, number>; development?: boolean } = {}) {
    store.start({
      runId, projectId: 'p1', conversationId: 'c1', agentId: extra.agentId ?? 'codex', agentName: extra.agentId === 'claude' ? 'Claude Code' : 'Codex',
      model: null, request: extra.request ?? '주문 API 명세서를 만들어 줘', root: project, development: extra.development ?? false,
    });
    await work();
    return store.finish({ runId, status: extra.status ?? 'succeeded', usage: extra.usage ?? null });
  }

  it('keeps a copy of each file a run created or changed, and leaves untouched files alone', async () => {
    await put('notes.md', '# before');
    const kept = await run('r1', async () => {
      await put('docs/orders.interface-spec.json', '{"v":1}');
      await put('out/orders.xlsx', 'xlsx-1');
      await put('src/Main.java', 'class Main {}');
    });
    expect(kept.map((output) => `${output.path} v${output.version} ${output.change}`).sort())
      .toEqual(['docs/orders.interface-spec.json v1 created', 'out/orders.xlsx v1 created']);

    const list = store.list({});
    expect(list.total).toBe(2);
    expect(list.outputs[0]).toMatchObject({ projectName: '주문 시스템', agentName: 'Codex', request: '주문 API 명세서를 만들어 줘', runId: 'r1', latest: true, stored: true });
    expect(store.runs({}).runs[0]).toMatchObject({ runId: 'r1', status: 'succeeded', outputCount: 2 });
  });

  it('groups later copies of the same file as versions and still serves the old content', async () => {
    await run('r1', () => put('out/orders.xlsx', 'xlsx-1'));
    await run('r2', () => put('out/orders.xlsx', 'xlsx-2 with a new sheet'), { agentId: 'claude', request: '환불 시트를 추가해 줘' });
    // a run that rewrites the same bytes made nothing new
    const again = await run('r3', async () => {
      await put('out/orders.xlsx', 'xlsx-2 with a new sheet');
      const later = new Date(Date.now() + 60_000);
      await utimes(path.join(project, 'out/orders.xlsx'), later, later);
    });
    expect(again).toEqual([]);

    const latest = store.list({});
    expect(latest.outputs.map((output) => [output.version, output.versionCount, output.agentName])).toEqual([[2, 2, 'Claude Code']]);
    const all = store.list({ allVersions: true });
    expect(all.outputs.map((output) => output.version)).toEqual([2, 1]);

    const first = all.outputs[1]!;
    expect((await store.content(first.id))?.toString()).toBe('xlsx-1');
    const detail = await store.detail(first.id);
    expect(detail).toMatchObject({ current: 'changed', run: { runId: 'r1' } });
    expect(detail?.versions.map((output) => output.version)).toEqual([2, 1]);
  });

  it('finds results by request text, tool, format and project', async () => {
    await run('r1', async () => {
      await put('out/orders.xlsx', 'a');
      await put('out/flow.png', 'png');
    });
    await run('r2', () => put('out/refund-report.md', '# 환불'), { agentId: 'claude', request: '환불 보고서를 써 줘' });

    expect(store.list({ q: '환불' }).outputs.map((output) => output.path)).toEqual(['out/refund-report.md']);
    expect(store.list({ q: 'flow' }).outputs.map((output) => output.path)).toEqual(['out/flow.png']);
    expect(store.list({ agentId: 'codex' }).total).toBe(2);
    expect(store.list({ format: 'image' }).outputs.map((output) => output.name)).toEqual(['flow.png']);
    expect(store.list({ runId: 'r1' }).total).toBe(2);
    const facets = store.list({}).facets;
    expect(facets.agents).toEqual([{ id: 'codex', label: 'Codex', count: 2 }, { id: 'claude', label: 'Claude Code', count: 1 }]);
    expect(facets.formats.map((facet) => `${facet.id} ${facet.count}`).sort()).toEqual(['document 1', 'image 1', 'sheet 1']);
    expect(facets.projects).toEqual([{ id: 'p1', label: '주문 시스템', count: 3 }]);
  });

  it('puts an old version back and keeps what it replaced', async () => {
    await run('r1', () => put('out/report.md', 'first'));
    await run('r2', () => put('out/report.md', 'second'));
    await put('out/report.md', 'edited by hand');
    const first = store.list({ allVersions: true }).outputs.find((output) => output.version === 1)!;

    const result = await store.restore(first.id, project);
    expect(await readFile(path.join(project, 'out/report.md'), 'utf8')).toBe('first');
    expect(result.savedBefore).toMatchObject({ change: 'before-restore', version: 3, runId: null });
    expect((await store.content(result.savedBefore!.id))?.toString()).toBe('edited by hand');
    expect((await store.detail(first.id))?.current).toBe('same');

    // restoring when the file already is a kept version saves nothing extra
    const second = store.list({ allVersions: true }).outputs.find((output) => output.version === 2)!;
    expect((await store.restore(second.id, project)).savedBefore).toBeNull();
  });

  it('adds up what the tools reported and says how many runs reported nothing', async () => {
    await run('r1', () => put('a.md', 'a'), { usage: { inputTokens: 1000, outputTokens: 20, cacheReadTokens: 900, cacheWriteTokens: 0, totalTokens: 1020 } });
    await run('r2', () => put('b.md', 'b'), { agentId: 'claude', usage: { inputTokens: 90, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 40 } });
    await run('r3', async () => {}, { status: 'failed' });

    const summary = store.usage({});
    expect(summary.totals).toMatchObject({ runs: 3, succeeded: 2, failed: 1, unmeasuredRuns: 1, inputTokens: 1090, outputTokens: 30, cacheReadTokens: 900, cacheWriteTokens: 40, totalTokens: 1120, outputs: 2 });
    expect(summary.byAgent.map((bucket) => [bucket.key, bucket.runs, bucket.totalTokens])).toEqual([['codex', 2, 1020], ['claude', 1, 100]]);
    expect(summary.byProject).toMatchObject([{ key: 'p1', label: '주문 시스템', runs: 3 }]);
    expect(summary.byDay).toHaveLength(1);
    expect(store.runs({ status: 'failed' }).runs.map((entry) => entry.runId)).toEqual(['r3']);
    expect(store.runs({ q: '명세서' }).total).toBe(3);
  });

  it('never copies hidden files: they are tool configuration and may hold credentials', async () => {
    const kept = await run('r1', async () => {
      await put('.mcp.json', '{"token":"secret"}');
      await put('.claude/settings.json', '{}');
      await put('out/report.md', '# report');
    });
    expect(kept.map((output) => output.path)).toEqual(['out/report.md']);
  });

  it('treats a source tree differently: configuration there is not a result', async () => {
    const kept = await run('r1', async () => {
      await put('package.json', '{}');
      await put('index.html', '<html>');
      await put('docs/api.interface-spec.json', '{}');
      await put('README.md', '# readme');
    }, { development: true });
    expect(kept.map((output) => output.path).sort()).toEqual(['README.md', 'docs/api.interface-spec.json']);
  });

  it('closes runs a stopped daemon left open, and forgets a deleted project\'s files but not its usage', async () => {
    store.start({ runId: 'r-open', projectId: 'p1', conversationId: null, agentId: 'codex', agentName: 'Codex', model: null, request: '중단된 요청', root: project, development: false });
    await run('r1', () => put('a.md', 'a'), { usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 2 } });

    const reopened = createRunOutputStore({ db, dataDir: data, now: () => (clock += 1_000) });
    expect(reopened.runs({}).runs.find((entry) => entry.runId === 'r-open')).toMatchObject({ status: 'failed' });

    deleteProject(db, 'p1');
    expect(reopened.list({}).total).toBe(0);
    expect(reopened.runs({}).runs.find((entry) => entry.runId === 'r1')).toMatchObject({ projectName: null, usage: { totalTokens: 2 } });
    expect(await reopened.prune()).toBe(1);
  });
});
