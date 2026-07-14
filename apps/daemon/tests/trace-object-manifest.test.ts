import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const projectFileReadTracker = vi.hoisted(() => ({ calls: 0 }));

vi.mock('../src/projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/projects.js')>();
  return {
    ...actual,
    readProjectFile: async (...args: Parameters<typeof actual.readProjectFile>) => {
      projectFileReadTracker.calls += 1;
      return actual.readProjectFile(...args);
    },
  };
});

import { buildTraceObjectManifests } from '../src/trace-object-manifest.js';

describe('buildTraceObjectManifests', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-trace-objects-'));
    projectFileReadTracker.calls = 0;
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('does not read files or upload object manifests even when legacy relay env is present', async () => {
    const projectsRoot = path.join(dataDir, 'projects');
    const projectDir = path.join(projectsRoot, 'proj-1');
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, 'artifact.txt'), 'release artifact');
    const fetchSpy = vi.fn();

    const manifests = await buildTraceObjectManifests({
      installationId: 'install-1',
      projectId: 'proj-1',
      runId: 'run-1',
      projectsRoot,
      artifacts: [
        { summary: { slug: 'artifact.txt', type: 'text', sizeBytes: 'release artifact'.length } },
      ],
      prompt: 'prompt',
      prefs: { metrics: true, content: true, artifactManifest: true },
      fetchImpl: fetchSpy as any,
      env: {
        NODE_ENV: 'test',
        OPEN_DESIGN_OBJECT_RELAY_URL: 'https://telemetry.open-design.ai/api/objects/batch',
        OPEN_DESIGN_TELEMETRY_RELAY_URL: 'https://telemetry.open-design.ai/api/langfuse',
      },
      now: () => new Date('2026-06-08T00:00:00.000Z'),
    });

    expect(manifests).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(projectFileReadTracker.calls).toBe(0);
  });
});
