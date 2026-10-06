import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InterfaceSpecDocumentSchema } from '@open-design/contracts';
import { analyzeDocumentImpact } from '../src/services/document-impact.js';

describe('document change impact', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'monofield-impact-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  function git(...args: string[]) {
    return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: root, encoding: 'utf8' }).trim();
  }
  function document(revision?: string) {
    return InterfaceSpecDocumentSchema.parse({ schemaVersion: 1, kind: 'interface-spec',
      source: { codebaseName: 'orders', ...(revision ? { revision } : {}) },
      endpoints: [
        { method: 'GET', path: '/orders', sourceFile: 'orders.ts' },
        { method: 'POST', path: '/orders', responseFields: [{ nameEn: 'id', evidenceRefs: [{ kind: 'code', ref: 'dto.ts', line: 1 }] }] },
        { method: 'GET', path: '/unknown' },
      ],
    });
  }
  async function analyze(revision?: string) {
    const doc = document(revision);
    return analyzeDocumentImpact({ projectRoot: root, inputFile: 'docs/orders.json', content: Buffer.from(JSON.stringify(doc)), doc });
  }

  it('includes committed changes since collection, working changes and untracked DTOs', async () => {
    git('init', '--quiet');
    await writeFile(path.join(root, 'orders.ts'), 'old'); git('add', '.'); git('commit', '--quiet', '--no-verify', '-m', 'initial');
    const baseline = git('rev-parse', 'HEAD');
    await writeFile(path.join(root, 'orders.ts'), 'new'); git('add', '.'); git('commit', '--quiet', '--no-verify', '-m', 'change');
    await writeFile(path.join(root, 'dto.ts'), 'new DTO');
    const report = await analyze(baseline);
    expect(report.changedFiles).toEqual(['dto.ts', 'orders.ts']);
    expect(report.affected.map((item) => item.endpointIndex)).toEqual([0, 1]);
    expect(report.untrackedEndpointIndexes).toEqual([2]);
    expect(report.proposalFile).toBe('docs/orders.proposed.json');
    expect(report.updatePrompt).toContain('Do not overwrite the original');
    expect(report.contentSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('tracks deletion through a staged rename', async () => {
    git('init', '--quiet'); await writeFile(path.join(root, 'orders.ts'), 'same');
    git('add', '.'); git('commit', '--quiet', '--no-verify', '-m', 'initial');
    git('mv', 'orders.ts', 'renamed.ts');
    expect((await analyze()).affected[0]?.changedFiles).toEqual(['orders.ts']);
  });

  it('keeps large change lists in the report while bounding the agent prompt', async () => {
    git('init', '--quiet');
    await writeFile(path.join(root, 'orders.ts'), 'old'); git('add', '.'); git('commit', '--quiet', '--no-verify', '-m', 'initial');
    await Promise.all(Array.from({ length: 60 }, (_, index) => writeFile(path.join(root, `${index}-${'long-reference-'.repeat(13)}.ts`), 'new')));
    const report = await analyze();
    expect(report.changedFiles).toHaveLength(60);
    expect(report.updatePrompt.length).toBeLessThan(8500);
    expect(report.updatePrompt).toContain('retrieve the complete report');
    expect(report.updatePrompt).toContain('interface-spec-proposal');
    expect(report.updatePrompt).toContain('not the complete document');
  });

  it('reports a non-Git project without claiming that the specification is current', async () => {
    const report = await analyze();
    expect(report.repository).toBe(false); expect(report.headRevision).toBeNull();
    expect(report.untrackedEndpointIndexes).toEqual([2]);
  });

  it('rejects codebase path traversal and a symlink outside the project', async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), 'monofield-outside-'));
    try {
      const doc = document(); doc.source.codebasePath = '../';
      const options = { projectRoot: root, inputFile: 'orders.json', content: Buffer.from('{}'), doc };
      await expect(analyzeDocumentImpact(options)).rejects.toThrow('inside the project');
      await symlink(outside, path.join(root, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
      doc.source.codebasePath = 'external';
      await expect(analyzeDocumentImpact(options)).rejects.toThrow('inside the project');
    } finally { await rm(outside, { recursive: true, force: true }); }
  });

  it('limits a nested codebase scan to the selected directory', async () => {
    git('init', '--quiet'); await mkdir(path.join(root, 'service')); await writeFile(path.join(root, 'service/orders.ts'), 'old');
    await writeFile(path.join(root, 'outside.ts'), 'old'); git('add', '.'); git('commit', '--quiet', '--no-verify', '-m', 'initial');
    await writeFile(path.join(root, 'outside.ts'), 'changed'); await writeFile(path.join(root, 'service/orders.ts'), 'changed');
    const doc = document(); doc.source.codebasePath = 'service';
    const report = await analyzeDocumentImpact({ projectRoot: root, inputFile: 'orders.json', content: Buffer.from('{}'), doc });
    expect(report.changedFiles).toEqual(['orders.ts']); expect(report.affected).toHaveLength(1);
  });
});
