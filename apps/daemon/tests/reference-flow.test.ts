import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addReference, applyReferences, removeReference, type ReferenceFileAccess } from '../src/services/references.js';
import { recordReferenceFlow, referenceFlowRequestText, type ReferenceFlowDeps } from '../src/services/reference-flow.js';

// A real REA 6.7.0 capture of a synthetic order screen (GET /api/orders, POST /api/orders/{id}/settle 201/409, GET /api/settlements).
const FIXTURE = path.resolve('tests/fixtures/rea/browser-scenario-capture.json');

function folderAccess(root: string): ReferenceFileAccess {
  return {
    root: async () => root,
    read: async (name) => readFile(path.join(root, name)).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; }),
    write: async (name, body) => { await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await writeFile(path.join(root, name), body); },
    remove: async (name) => rm(path.join(root, name)),
  };
}

describe('recording a reference flow with REA', () => {
  let root: string;
  let files: ReferenceFileAccess;
  let deps: ReferenceFlowDeps;
  let scenarios: Array<Record<string, unknown>>;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'ref-flow-'));
    files = folderAccess(root);
    scenarios = [];
    deps = {
      runRea: vi.fn(async (scenario) => { scenarios.push(scenario); return readFile(FIXTURE); }),
      findBrowser: async () => '/opt/chromium/chrome',
      exists: async (file) => file === '/usr/bin/edge',
      now: () => new Date('2026-11-06T09:00:00.000Z'),
    };
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('runs REA with the steps, keeps the evidence beside the board and links a summary to the card', async () => {
    const item = await addReference(files, 'p', { url: 'http://127.0.0.1:4318/', title: 'Orders' });
    const result = await recordReferenceFlow(files, 'p', item.id, { steps: [{ kind: 'click', target: '정산' }, { kind: 'wait-text', target: '정산 완료' }] }, deps);
    expect(scenarios[0]).toMatchObject({ browser: { executable_path: '/opt/chromium/chrome' }, start_url: { url: 'http://127.0.0.1:4318/' },
      actions: [{ step_id: 'step-1', action: 'click' }, { step_id: 'step-2', action: 'wait_for' }] });
    const saved = await readFile(path.join(root, `references/${item.id}.flow.json`));
    expect(saved.equals(await readFile(FIXTURE))).toBe(true);
    expect(result.flow).toMatchObject({
      file: `references/${item.id}.flow.json`, evidenceId: expect.stringMatching(/^ev_/), browser: 'chrome', recordedAt: '2026-11-06T09:00:00.000Z',
      completeness: 'incomplete',
    });
    // The fixture's own step IDs are kept; labels come from the steps that were asked for when the IDs match.
    expect(result.flow.total).toBe(result.flow.steps.length);
    expect(result.flow.completed).toBe(result.flow.total);
    expect(result.flow.apiCalls).toEqual(expect.arrayContaining([
      { method: 'GET', path: '/api/orders', status: 200 },
      { method: 'POST', path: '/api/orders/{id}/settle', status: 201 },
      { method: 'POST', path: '/api/orders/{id}/settle', status: 409 },
      { method: 'GET', path: '/api/settlements', status: 200 },
    ]));
    const board = JSON.parse(await readFile(path.join(root, 'references/board.json'), 'utf8'));
    expect(board.items[0].flow.file).toBe(`references/${item.id}.flow.json`);
    const block = (await applyReferences(files, { referenceIds: [item.id] })).block;
    expect(block).toContain(`flow: references/${item.id}.flow.json`);
    expect(block).toContain('POST /api/orders/{id}/settle → 201');
    // The fixture keeps no screenshots (they were removed to keep it small), so there is no last screen.
    expect(result.flow.screenshot).toBeUndefined();
    expect(result.flow.steps.find((step) => step.request)).toBeUndefined(); // the fixture's own step IDs are not ours
    expect(await removeReference(files, 'p', item.id)).toEqual({ removed: item.id, files: [`references/${item.id}.flow.json`] });
    expect(existsSync(path.join(root, `references/${item.id}.flow.json`))).toBe(false);
  });

  it('keeps the last captured screen only when its bytes match the hash REA recorded, and removes it with the card', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const evidence = JSON.parse(await readFile(FIXTURE, 'utf8'));
    const steps = evidence.normalized_result.steps;
    const shot = (bytes: Buffer, sha: string) => ({ screenshot: { state: 'captured', value: { sha256: sha, bytes: bytes.length, media_type: 'image/png', data_base64: bytes.toString('base64') } } });
    const { createHash } = await import('node:crypto');
    const good = createHash('sha256').update(png).digest('hex');
    steps[1].artifacts = shot(png, good);
    steps[steps.length - 1].artifacts = shot(Buffer.from('not the recorded bytes'), good); // the newest screen does not match: skipped
    const item = await addReference(files, 'p', { url: 'https://a.example/' });
    const result = await recordReferenceFlow(files, 'p', item.id, {}, { ...deps, runRea: async () => Buffer.from(JSON.stringify(evidence)) });
    expect(result.flow.screenshot).toBe(`references/${item.id}.flow.png`);
    expect((await readFile(path.join(root, result.flow.screenshot!))).equals(png)).toBe(true);
    expect((await applyReferences(files, { referenceIds: [item.id] })).block).toContain(`last screen: references/${item.id}.flow.png`);
    expect(await removeReference(files, 'p', item.id)).toEqual({ removed: item.id, files: [`references/${item.id}.flow.json`, `references/${item.id}.flow.png`] });
    expect(existsSync(path.join(root, `references/${item.id}.flow.png`))).toBe(false);
  });

  it('refuses bad steps, a missing browser, a relative browser path and REA output that is not a browser capture', async () => {
    const item = await addReference(files, 'p', { url: 'https://a.example/' });
    await expect(recordReferenceFlow(files, 'p', item.id, { steps: [{ kind: 'fill', target: '비밀번호', value: 'x' }] }, deps)).rejects.toThrow('does not type');
    await expect(recordReferenceFlow(files, 'p', item.id, {}, { ...deps, findBrowser: async () => null })).rejects.toMatchObject({ status: 409, code: 'REFERENCE_FLOW_NO_BROWSER' });
    await expect(recordReferenceFlow(files, 'p', item.id, { browserPath: 'chrome.exe' }, deps)).rejects.toThrow('absolute');
    await expect(recordReferenceFlow(files, 'p', item.id, { browserPath: '/nowhere/chrome' }, deps)).rejects.toMatchObject({ status: 404 });
    await recordReferenceFlow(files, 'p', item.id, { browserPath: '/usr/bin/edge' }, deps);
    expect(scenarios.at(-1)).toMatchObject({ browser: { executable_path: '/usr/bin/edge' } });
    await expect(recordReferenceFlow(files, 'p', item.id, {}, { ...deps, runRea: async () => Buffer.from('{"predicate_type":"rea.sqlite-inspection"}') })).rejects.toMatchObject({ status: 502 });
    await expect(recordReferenceFlow(files, 'p', 'ref-missing', {}, deps)).rejects.toMatchObject({ status: 404 });
  });

  it('runs one recording per reference at a time', async () => {
    const item = await addReference(files, 'p', { url: 'https://a.example/' });
    let release!: () => void;
    const slow: ReferenceFlowDeps = { ...deps, runRea: () => new Promise((resolve) => { release = () => void readFile(FIXTURE).then(resolve); }) };
    const first = recordReferenceFlow(files, 'p', item.id, {}, slow);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await expect(recordReferenceFlow(files, 'p', item.id, {}, slow)).rejects.toMatchObject({ code: 'REFERENCE_FLOW_RUNNING' });
    release();
    await expect(first).resolves.toMatchObject({ flow: { file: `references/${item.id}.flow.json` } });
  });

  it('writes the agent request without running anything', async () => {
    const item = await addReference(files, 'p', { url: 'https://a.example/join', note: '가입 2단계' });
    const { text } = await referenceFlowRequestText(files, item.id, { steps: [{ kind: 'click', target: '다음' }], request: '흐름 기록' });
    expect(text).toContain(`save: the evidence JSON as references/${item.id}.flow.json`);
    expect(text).toContain('request: 흐름 기록');
    expect(text).toContain('note: 가입 2단계');
    expect(deps.runRea).not.toHaveBeenCalled();
  });
});
