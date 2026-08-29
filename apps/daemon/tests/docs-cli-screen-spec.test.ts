import { mkdtemp, mkdir, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runDocsCli } from '../src/docs-cli.js';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function screenSpecWithImage(imageRef: string) {
  return {
    schemaVersion: 1,
    kind: 'screen-spec',
    name: 'CLI image boundary',
    screens: [{
      id: 'SCR-001',
      screenName: 'Boundary screen',
      imageRef,
      callouts: [],
      calloutRelations: [],
      checkpoints: [],
    }],
  };
}

async function writeScreenSpec(root: string, imageRef: string): Promise<string> {
  const input = nodePath.join(root, 'screen-spec.json');
  await writeFile(input, JSON.stringify(screenSpecWithImage(imageRef)), 'utf8');
  return input;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('screen-spec CLI imageRef boundary', () => {
  it('inlines a supported image that is contained by the input directory', async () => {
    const root = await mkdtemp(nodePath.join(tmpdir(), 'monofield-screen-cli-'));
    try {
      const image = nodePath.join(root, 'screen.png');
      const output = nodePath.join(root, 'preview.html');
      await writeFile(image, TINY_PNG);
      const input = await writeScreenSpec(root, 'screen.png');
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});

      expect((await runDocsCli(['preview-screen-spec', '--input', input, '--out', output])).exitCode).toBe(0);
      expect(await readFile(output, 'utf8')).toContain('data:image/png;base64,');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects traversal to an image outside the input directory', async () => {
    const parent = await mkdtemp(nodePath.join(tmpdir(), 'monofield-screen-cli-'));
    const root = nodePath.join(parent, 'project');
    try {
      await mkdir(root);
      await writeFile(nodePath.join(parent, 'outside.png'), TINY_PNG);
      const input = await writeScreenSpec(root, '../outside.png');
      const output = nodePath.join(root, 'preview.html');
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect((await runDocsCli(['preview-screen-spec', '--input', input, '--out', output])).exitCode).toBe(1);
      expect(error.mock.calls.flat().join(' ')).toContain('must stay inside');
      await expect(readFile(output)).rejects.toThrow();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('rejects unsupported extensions and mismatched image contents', async () => {
    const root = await mkdtemp(nodePath.join(tmpdir(), 'monofield-screen-cli-'));
    try {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});

      await writeFile(nodePath.join(root, 'screen.gif'), TINY_PNG);
      const unsupportedInput = await writeScreenSpec(root, 'screen.gif');
      expect((await runDocsCli(['preview-screen-spec', '--input', unsupportedInput])).exitCode).toBe(1);
      expect(error.mock.calls.flat().join(' ')).toContain('only .png, .jpg, .jpeg, and .webp');

      error.mockClear();
      await writeFile(nodePath.join(root, 'screen.png'), 'not an image', 'utf8');
      const mismatchedInput = await writeScreenSpec(root, 'screen.png');
      expect((await runDocsCli(['preview-screen-spec', '--input', mismatchedInput])).exitCode).toBe(1);
      expect(error.mock.calls.flat().join(' ')).toContain('do not match');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects directories and images above the size limit before reading them', async () => {
    const root = await mkdtemp(nodePath.join(tmpdir(), 'monofield-screen-cli-'));
    try {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});

      await mkdir(nodePath.join(root, 'folder.png'));
      const directoryInput = await writeScreenSpec(root, 'folder.png');
      expect((await runDocsCli(['preview-screen-spec', '--input', directoryInput])).exitCode).toBe(1);
      expect(error.mock.calls.flat().join(' ')).toContain('not a regular file');

      error.mockClear();
      const largeImage = nodePath.join(root, 'large.png');
      await writeFile(largeImage, TINY_PNG);
      await truncate(largeImage, (20 * 1024 * 1024) + 1);
      const largeInput = await writeScreenSpec(root, 'large.png');
      expect((await runDocsCli(['preview-screen-spec', '--input', largeInput])).exitCode).toBe(1);
      expect(error.mock.calls.flat().join(' ')).toContain('exceeds');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
