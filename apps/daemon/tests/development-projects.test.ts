import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { discoverDevelopmentProjects } from '../src/development-projects.js';

const roots: string[] = [];

async function workspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'monofield-modules-'));
  roots.push(root);
  return root;
}

async function write(root: string, relative: string, content: string): Promise<void> {
  const target = path.join(root, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

async function discoveredPaths(root: string): Promise<string[]> {
  return (await discoverDevelopmentProjects(root, true)).map((project) => project.path);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

// A folder of several projects is the common SI layout: every project is its own
// Git repository, and a multi-module Maven or Gradle project keeps its modules
// inside that repository.
describe('module discovery in a folder of projects', () => {
  it('lists the Maven modules declared by a project that is its own Git repository', async () => {
    const root = await workspace();
    await write(root, 'legacy-ear/.git/HEAD', 'ref: refs/heads/main\n');
    await write(root, 'legacy-ear/pom.xml', '<project><packaging>pom</packaging><modules><module>ear-web</module><module>ear-ejb</module></modules></project>');
    await write(root, 'legacy-ear/ear-web/pom.xml', '<project><packaging>war</packaging></project>');
    await write(root, 'legacy-ear/ear-ejb/pom.xml', '<project />');
    await write(root, 'portal/.git/HEAD', 'ref: refs/heads/main\n');
    await write(root, 'portal/package.json', '{"name":"portal"}');

    expect(await discoveredPaths(root)).toEqual([
      'legacy-ear',
      'legacy-ear/ear-ejb',
      'legacy-ear/ear-web',
      'portal',
    ]);
  });

  it('lists the Gradle and npm workspace members declared inside a project repository', async () => {
    const root = await workspace();
    await write(root, 'batch/.git/HEAD', 'ref: refs/heads/main\n');
    await write(root, 'batch/settings.gradle', "rootProject.name = 'batch'\ninclude 'core', 'worker'\n");
    await write(root, 'batch/build.gradle', "plugins { id 'java' }");
    await write(root, 'batch/core/build.gradle', "plugins { id 'java' }");
    await write(root, 'batch/worker/build.gradle', "plugins { id 'java' }");
    await write(root, 'console/.git/HEAD', 'ref: refs/heads/main\n');
    await write(root, 'console/package.json', '{"name":"console","workspaces":["packages/*"]}');
    await write(root, 'console/packages/ui/package.json', '{"name":"ui"}');
    await write(root, 'console/packages/api/package.json', '{"name":"api"}');

    expect(await discoveredPaths(root)).toEqual([
      'batch',
      'batch/core',
      'batch/worker',
      'console',
      'console/packages/api',
      'console/packages/ui',
    ]);
  });

  // The repository boundary still applies to everything a manifest does not name:
  // fixtures and leaf packages inside a project are not modules of the workspace.
  it('keeps undeclared folders inside a project repository out of the module list', async () => {
    const root = await workspace();
    await write(root, 'console/.git/HEAD', 'ref: refs/heads/main\n');
    await write(root, 'console/package.json', '{"name":"console","workspaces":["packages/*"]}');
    await write(root, 'console/packages/ui/package.json', '{"name":"ui"}');
    await write(root, 'console/public/package.json', '{"name":"static-fixture"}');
    await write(root, 'console/test/fixtures/app/package.json', '{"name":"fixture"}');

    expect(await discoveredPaths(root)).toEqual(['console', 'console/packages/ui']);
  });

  it('still lists plain sibling projects without a Git repository', async () => {
    const root = await workspace();
    await write(root, 'a/package.json', '{"name":"a"}');
    await write(root, 'b/pom.xml', '<project />');

    expect(await discoveredPaths(root)).toEqual(['a', 'b']);
  });
});
