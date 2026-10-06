import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DocumentImpactResponse, DocumentProposalResponse } from '@open-design/contracts';
import { startServer, type StartServerResult } from '../src/server.js';

const runFile = promisify(execFile);

describe('document impact API and CLI', () => {
  let started: StartServerResult;
  let root: string;
  let projectId: string;
  let revision: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'monofield-impact-route-'));
    const git = (...args: string[]) => execFileSync('git', [
      '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args,
    ], { cwd: root, encoding: 'utf8' }).trim();
    git('init', '--quiet');
    await writeFile(path.join(root, 'orders.ts'), 'export const id = 1;');
    git('add', '.');
    git('commit', '--quiet', '--no-verify', '-m', 'initial');
    revision = git('rev-parse', 'HEAD');
    await writeFile(path.join(root, 'orders.ts'), 'export const id = "order";');
    await writeFile(path.join(root, 'orders.json'), JSON.stringify({
      schemaVersion: 1, kind: 'interface-spec', source: { codebaseName: 'Orders', revision },
      endpoints: [{ method: 'GET', path: '/orders', interfaceId: 'IF-001', sourceFile: 'orders.ts',
        responseFields: [{ nameEn: 'id', dataType: 'Number', evidence: 'Approved requirement', reviewStatus: 'edited' }],
      }],
    }));
    started = await startServer({ port: 0, returnServer: true }) as StartServerResult;
    const imported = await fetch(`${started.url}/api/import/folder`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseDir: root, name: 'Document impact route' }),
    });
    expect(imported.ok).toBe(true);
    const result = await imported.json() as { project: { id: string } };
    projectId = result.project.id;
  });

  afterAll(async () => {
    if (started) {
      await started.shutdown?.();
      started.server.close();
      started.server.closeAllConnections?.();
    }
    if (root) await rm(root, { recursive: true, force: true });
  });

  function analyze(inputFile: string, id = projectId) {
    return fetch(`${started.url}/api/projects/${id}/documents/impact`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inputFile }),
    });
  }

  it('returns the same document revision and affected interfaces through the CLI', async () => {
    const response = await analyze('orders.json');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const report = await response.json() as DocumentImpactResponse;
    expect(report.baselineRevision).toBe(revision);
    expect(report.affected).toMatchObject([{ endpointIndex: 0, changedFiles: ['orders.ts'] }]);
    const cliPath = process.env.OD_DAEMON_CLI_PATH;
    if (!cliPath) throw new Error('The test setup must build the daemon CLI.');
    const { stdout } = await runFile(process.execPath, [cliPath, 'docs', 'impact',
      '--project', projectId, '--input', 'orders.json', '--daemon-url', started.url, '--json',
    ]);
    const cliReport = JSON.parse(stdout) as DocumentImpactResponse;
    expect(cliReport.contentSha256).toBe(report.contentSha256);
    expect(cliReport.affected).toEqual(report.affected);
    expect(cliReport.updatePrompt).toBe(report.updatePrompt);
  });

  it('rejects traversal before reading a document and rejects missing projects', async () => {
    const traversal = await analyze('../orders.json');
    expect(traversal.status).toBe(400);
    await expect(traversal.json()).resolves.toMatchObject({ error: { code: 'INVALID_DOCUMENT' } });
    const missing = await analyze('orders.json', 'missing-impact-project');
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ error: { code: 'PROJECT_NOT_FOUND' } });
  });

  it('rejects malformed documents instead of reporting them as unaffected', async () => {
    await writeFile(path.join(root, 'invalid.json'), JSON.stringify({ kind: 'interface-spec', endpoints: [] }));
    const response = await analyze('invalid.json');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'DOCUMENT_IMPACT_FAILED' } });
  });

  it('validates a small proposal through HTTP and CLI while preserving the original', async () => {
    const original = await readFile(path.join(root, 'orders.json'), 'utf8');
    const report = await analyze('orders.json').then((response) => response.json()) as DocumentImpactResponse;
    await writeFile(path.join(root, report.proposalFile), JSON.stringify({ schemaVersion: 1, kind: 'interface-spec-proposal',
      baseContentSha256: report.contentSha256, changes: [
        { op: 'test', path: '/endpoints/0/interfaceId', value: 'IF-001' },
        { op: 'replace', path: '/endpoints/0/responseFields/0/dataType', value: 'String' },
      ],
    }));
    const response = await fetch(`${started.url}/api/projects/${projectId}/documents/proposal`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        inputFile: 'orders.json', proposalFile: report.proposalFile, expectedContentSha256: report.contentSha256,
      }),
    });
    expect(response.status).toBe(200);
    const result = await response.json() as DocumentProposalResponse;
    expect(result).toMatchObject({ format: 'changes', changesApplied: 1 });
    expect(result.document?.endpoints[0]?.responseFields[0]).toMatchObject({
      dataType: 'String', evidence: 'Approved requirement', reviewStatus: 'edited',
    });
    const cliPath = process.env.OD_DAEMON_CLI_PATH;
    if (!cliPath) throw new Error('The test setup must build the daemon CLI.');
    const { stdout } = await runFile(process.execPath, [cliPath, 'docs', 'proposal', '--project', projectId,
      '--input', 'orders.json', '--proposal', report.proposalFile, '--expected-sha', report.contentSha256,
      '--daemon-url', started.url, '--json',
    ]);
    const summary = JSON.parse(stdout) as DocumentProposalResponse;
    expect(summary).toMatchObject({ format: 'changes', changesApplied: 1, contentSha256: report.contentSha256 });
    expect(summary.document).toBeUndefined();
    expect(await readFile(path.join(root, 'orders.json'), 'utf8')).toBe(original);
    const conflict = await fetch(`${started.url}/api/projects/${projectId}/documents/proposal`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        inputFile: 'orders.json', proposalFile: report.proposalFile, expectedContentSha256: 'b'.repeat(64),
      }),
    });
    expect(conflict.status).toBe(409);
  });
});
