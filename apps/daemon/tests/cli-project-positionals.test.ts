import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const tsx = fileURLToPath(new URL('../../../node_modules/tsx/dist/cli.mjs', import.meta.url));

describe('project CLI positional arguments', () => {
  let server: http.Server;
  let baseUrl: string;
  const requests: Array<{ method: string; url: string }> = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      requests.push({ method: req.method ?? '', url: req.url ?? '' });
      req.resume();
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ project: { id: 'review-project' }, ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => { requests.length = 0; });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  async function runCli(args: string[]) {
    return await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      const env = { ...process.env };
      delete env.NODE_OPTIONS;
      const child = spawn(process.execPath, [tsx, cli, 'project', ...args], {
        env,
        stdio: ['ignore', 'ignore', 'pipe'],
        timeout: 15_000,
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stderr }));
    });
  }

  it.each([
    ['info', 'GET', ''],
    ['delete', 'DELETE', ''],
    ['open-in', 'POST', '/open-in'],
  ])('%s targets the project when options precede its ID', async (command, method, suffix) => {
    const result = await runCli([
      command, '--daemon-url', baseUrl,
      ...(command === 'open-in' ? ['--editor', 'vscode'] : []),
      'review-project', '--json',
    ]);
    expect(result.code, result.stderr).toBe(0);
    expect(requests).toEqual([{ method, url: `/api/projects/review-project${suffix}` }]);
  });

  it('does not send a delete request when only an option value is supplied', async () => {
    const result = await runCli(['delete', '--daemon-url', baseUrl]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Usage: monofield project delete <id>');
    expect(requests).toEqual([]);
  });

  it('keeps accepting an ID before equals-form options', async () => {
    const result = await runCli(['info', 'review-project', `--daemon-url=${baseUrl}`, '--json']);
    expect(result.code, result.stderr).toBe(0);
    expect(requests).toEqual([{ method: 'GET', url: '/api/projects/review-project' }]);
  });

  it('uses the shared verification endpoint with flags before the project ID', async () => {
    expect((await runCli(['verify', '--daemon-url', baseUrl, '--script', 'test', 'review-project', '--json'])).code).toBe(0);
    expect(requests).toEqual([{ method: 'POST', url: '/api/projects/review-project/development/verification' }]);
    requests.length = 0;
    expect((await runCli(['verify', '--daemon-url', baseUrl, '--project-path', 'packages/app', 'review-project', '--json'])).code).toBe(0);
    expect(requests).toEqual([{ method: 'GET', url: '/api/projects/review-project/development/verification?projectPath=packages%2Fapp' }]);
  });
});
