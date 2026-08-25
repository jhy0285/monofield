import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const daemonRoot = fileURLToPath(new URL('..', import.meta.url));
const cliEntry = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
let daemonUrl = '';
let requestCount = 0;
const daemon = http.createServer((req, res) => {
  requestCount += 1;
  req.resume();
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end('{}');
});

beforeAll(async () => {
  await new Promise<void>((resolve) => daemon.listen(0, '127.0.0.1', resolve));
  const address = daemon.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  daemonUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => daemon.close(() => resolve()));
});

describe('managed plugin publication CLI policy', () => {
  it.each([
    [
      'plugin publish',
      () => ['plugin', 'publish', 'company/sample', '--to', 'open-design', '--daemon-url', daemonUrl, '--json'],
    ],
    [
      'plugin publish-repo',
      () => ['plugin', 'publish-repo', '__missing_managed_publish_repo__', '--json'],
    ],
    [
      'plugin open-design-pr',
      () => ['plugin', 'open-design-pr', '__missing_managed_open_docs_pr__', '--json'],
    ],
  ])('blocks %s before network or source-folder access', async (_name, makeArgs) => {
    const requestsBefore = requestCount;
    const result = await runCli(makeArgs(), ' MaNaGeD ');

    expect(result.code).toBe(4);
    expect(requestCount).toBe(requestsBefore);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: {
        code: 'managed-publication-disabled',
        message: expect.stringContaining('approved company marketplace promotion workflow'),
      },
    });
    expect(`${result.stdout}\n${result.stderr}`).not.toMatch(
      /ENOENT|ECONNREFUSED|failed to reach daemon|GitHub CLI is required/iu,
    );
  });

  it('preserves public publication links in open mode', async () => {
    const result = await runCli([
      'plugin',
      'publish',
      'company/sample',
      '--to',
      'skills-sh',
      '--repo',
      'https://github.com/company/sample',
      '--daemon-url',
      daemonUrl,
      '--json',
    ], 'open');

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      catalog: 'skills-sh',
      url: 'https://skills.sh/',
    });
  });

  it('allows managed mode to update a company-owned marketplace JSON catalog', async () => {
    const root = await mkdtemp(join(tmpdir(), 'od-managed-marketplace-publish-'));
    const catalogPath = join(root, 'company-marketplace.json');

    try {
      const result = await runCli([
        'plugin',
        'publish',
        'company/sample',
        '--to',
        'marketplace-json',
        '--catalog',
        catalogPath,
        '--repo',
        'https://github.com/company/sample',
        '--daemon-url',
        daemonUrl,
        '--json',
      ], 'managed');

      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        catalogPath,
        inserted: true,
        entry: {
          name: 'company/sample',
          source: 'github:company/sample',
        },
      });
      expect(JSON.parse(await readFile(catalogPath, 'utf8'))).toMatchObject({
        plugins: [
          {
            name: 'company/sample',
            source: 'github:company/sample',
          },
        ],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function runCli(args: string[], installMode: string): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  try {
    const result = await execFileAsync(
      process.execPath,
      ['--import', 'tsx', cliEntry, ...args],
      {
        cwd: daemonRoot,
        env: {
          ...process.env,
          OD_PLUGIN_INSTALL_MODE: installMode,
        },
      },
    );
    return {
      code: 0,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  } catch (error: unknown) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof failed.code === 'number' ? failed.code : -1,
      stdout: failed.stdout ?? '',
      stderr: failed.stderr ?? '',
    };
  }
}
