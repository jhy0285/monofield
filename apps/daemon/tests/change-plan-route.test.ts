import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChangePlanResponse, VerificationStatus } from '@open-design/contracts';
import { startServer, type StartServerResult } from '../src/server.js';

const run = promisify(execFile);
describe('real change planner API, CLI and command receipts', () => {
  let started: StartServerResult, root: string, projectId: string;
  const inputFiles = ['api.json', 'screens.json'];
  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'monofield-change-plan-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'legacy-store', private: true, type: 'module', scripts: { test: 'node --test prices.test.mjs' } }));
    await writeFile(path.join(root, 'prices.mjs'), 'export const price = (amount, discount) => amount - discount;');
    await writeFile(path.join(root, 'prices.test.mjs'), "import { test } from 'node:test'; import { strict as assert } from 'node:assert'; import { price } from './prices.mjs'; test('discount price', () => assert.equal(price(100, 20), 80));");
    await writeFile(path.join(root, 'api.json'), JSON.stringify({ schemaVersion: 1, kind: 'interface-spec', source: { codebaseName: 'Legacy store' },
      endpoints: [{ method: 'GET', path: '/prices', interfaceId: 'PRICE', interfaceName: 'Price API', sourceFile: 'prices.mjs' }] }));
    await writeFile(path.join(root, 'screens.json'), JSON.stringify({ schemaVersion: 1, kind: 'screen-spec', name: 'Storefront', screens: [
      { id: 'SHOP', screenName: 'Storefront', evidenceRefs: [{ kind: 'requirement', ref: 'Price API response', document: { path: 'api.json', itemId: 'PRICE' } }] },
    ] }));
    await writeFile(path.join(root, 'change-policy.json'), JSON.stringify({ schemaVersion: 1, bindings: [
      { target: { kind: 'code', pathPrefix: 'prices.mjs' }, checkIds: ['node:test'] },
      { target: { kind: 'api', documentFile: 'api.json', itemId: 'PRICE' }, checkIds: ['node:test'] },
    ], rules: [{ id: 'store-design', when: { kind: 'screen', itemId: 'SHOP' }, require: { checkIds: [], reviews: ['contrast'] } }] }));
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: root });
    git('init', '--quiet'); git('add', '.'); git('commit', '--quiet', '--no-verify', '-m', 'legacy store');
    await writeFile(path.join(root, 'prices.mjs'), 'export const price = (amount, discount) => Math.max(0, amount - discount);');
    await writeFile(path.join(root, 'prices.test.mjs'), (await readFile(path.join(root, 'prices.test.mjs'), 'utf8')) + "\ntest('price never negative', () => assert.equal(price(10, 20), 0));");
    started = await startServer({ port: 0, returnServer: true }) as StartServerResult;
    const response = await fetch(`${started.url}/api/import/folder`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseDir: root, name: 'Legacy store plan' }) });
    expect(response.ok).toBe(true); projectId = ((await response.json()) as { project: { id: string } }).project.id;
  });
  afterAll(async () => {
    await started?.shutdown?.(); started?.server.close(); started?.server.closeAllConnections?.();
    if (root) await rm(root, { recursive: true, force: true });
  });
  const post = (suffix: string, body: unknown, origin?: string) => fetch(`${started.url}/api/projects/${projectId}/${suffix}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body),
  });
  const plan = (extra = {}) => post('documents/plan', { inputFiles, rulesFile: 'change-policy.json', request: 'Prevent negative prices and review storefront design', ...extra });
  it('uses real imported project relationships through HTTP and CLI without starting checks', async () => {
    const response = await plan(); expect(response.ok).toBe(true); expect(response.headers.get('cache-control')).toBe('no-store');
    const report = await response.json() as ChangePlanResponse;
    expect(report.summary.affected).toBe(3); expect(report.summary.passed).toBe(0);
    expect(report.obligations.some(item => item.review === 'contrast')).toBe(true);
    expect(report.ontology.edges.filter(edge => edge.relation === 'verified-by')).toHaveLength(2);
    const status = await fetch(`${started.url}/api/projects/${projectId}/development/verification`).then(r => r.json()) as VerificationStatus;
    expect(status.run).toBeNull();
    const inputsFile = path.join(root, 'inputs.txt'); await writeFile(inputsFile, JSON.stringify(inputFiles));
    const { stdout } = await run(process.execPath, [process.env.OD_DAEMON_CLI_PATH!, 'docs', 'plan', '--project', projectId,
      '--inputs-file', inputsFile, '--rules-file', 'change-policy.json', '--daemon-url', started.url, '--json']);
    const cliReport = JSON.parse(stdout) as ChangePlanResponse;
    expect(cliReport.affectedNodeIds).toEqual(report.affectedNodeIds);
    expect(cliReport.obligations.map(item => [item.ruleId, item.checkId, item.review])).toEqual(report.obligations.map(item => [item.ruleId, item.checkId, item.review]));
    expect(cliReport.modelCalls).toBe(0);
    const stdinOutput = await new Promise<string>((resolve, reject) => {
      const child = execFile(process.execPath, [process.env.OD_DAEMON_CLI_PATH!, 'docs', 'plan', '--project', projectId,
        '--inputs-file', inputsFile, '--rules-file', 'change-policy.json', '--prompt-file', '-', '--daemon-url', started.url, '--json'],
      (error, stdout) => error ? reject(error) : resolve(stdout));
      child.stdin?.end('Design review from stdin');
    });
    expect((JSON.parse(stdinOutput) as ChangePlanResponse).handoff).toContain('Design review from stdin');
    await rm(inputsFile);
  });
  it('credits an actual completed Node test but keeps browser, missing types and assertion gaps outstanding', async () => {
    const response = await post('development/verification', { checkIds: ['node:test'] }); expect(response.status).toBe(202);
    let status: VerificationStatus;
    do {
      await new Promise(resolve => setTimeout(resolve, 50));
      status = await fetch(`${started.url}/api/projects/${projectId}/development/verification?live=1`).then(r => r.json()) as VerificationStatus;
    } while (status.run?.state === 'running');
    expect(status.run?.state).toBe('passed');
    const report = await plan().then(r => r.json()) as ChangePlanResponse;
    expect(report.summary.passed).toBeGreaterThan(0); expect(report.summary.outstanding).toBeGreaterThan(0);
    expect(report.obligations.filter(item => item.review).every(item => item.state === 'manual-review')).toBe(true);
    expect(report.obligations.some(item => item.ruleId === 'builtin:types' && item.state === 'missing-check')).toBe(true);
    const codeId = report.graph.nodes.find(node => node.kind === 'code')!.id;
    const original = await readFile(path.join(root, 'prices.mjs'), 'utf8');
    const simulated = await plan({ simulateNodeIds: [codeId] }).then(r => r.json()) as ChangePlanResponse;
    expect(simulated.mode).toBe('simulation'); expect(simulated.summary.passed).toBe(0);
    expect(await readFile(path.join(root, 'prices.mjs'), 'utf8')).toBe(original);
    await writeFile(path.join(root, 'prices.mjs'), original + '\n// A new code change invalidates the receipt.');
    const stale = await plan().then(r => r.json()) as ChangePlanResponse;
    expect(stale.summary.passed).toBe(0); expect(stale.obligations.some(item => item.state === 'stale')).toBe(true);
  });
  it('rejects cross-origin requests, policy traversal, executable hooks and invented graph nodes', async () => {
    expect((await post('documents/plan', {}, 'https://evil.invalid')).status).toBe(403);
    expect((await plan({ rulesFile: '../secrets.json' })).status).toBe(400);
    expect((await plan({ simulateNodeIds: ['invented'] })).status).toBe(400);
    await writeFile(path.join(root, 'invalid-policy.json'), JSON.stringify({ schemaVersion: 1, bindings: [], rules: [], execute: 'echo unsafe' }));
    expect((await plan({ rulesFile: 'invalid-policy.json' })).status).toBe(400);
  });
});
