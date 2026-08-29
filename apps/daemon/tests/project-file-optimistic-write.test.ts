import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { writeProjectFile } from '../src/projects.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('project file optimistic writes', () => {
  it('rejects an interleaved stale save without overwriting the newer disk content', async () => {
    const projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'monofield-file-cas-'));
    temporaryRoots.push(projectsRoot);
    const projectId = 'project-1';
    const name = 'src/app.ts';
    const original = Buffer.from('export const value = 1;\n');
    const external = Buffer.from('export const value = 2;\n');
    const staleDraft = Buffer.from('export const local = true;\n');

    await writeProjectFile(projectsRoot, projectId, name, original);
    const expectedContentSha256 = createHash('sha256').update(original).digest('hex');
    await writeProjectFile(projectsRoot, projectId, name, external);

    await expect(writeProjectFile(
      projectsRoot,
      projectId,
      name,
      staleDraft,
      { expectedContentSha256 },
    )).rejects.toMatchObject({ code: 'ESTALE' });

    await expect(readFile(path.join(projectsRoot, projectId, name), 'utf8'))
      .resolves.toBe(external.toString('utf8'));
  });

  it('writes when the expected SHA-256 still matches', async () => {
    const projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'monofield-file-cas-'));
    temporaryRoots.push(projectsRoot);
    const original = Buffer.from('before\n');
    await writeProjectFile(projectsRoot, 'project-1', 'notes.txt', original);

    await expect(writeProjectFile(
      projectsRoot,
      'project-1',
      'notes.txt',
      Buffer.from('after\n'),
      { expectedContentSha256: createHash('sha256').update(original).digest('hex') },
    )).resolves.toMatchObject({ name: 'notes.txt' });
  });
});
