import { afterEach, describe, expect, it, vi } from 'vitest';

import { runDatabaseCli } from '../src/database-cli.js';

const originalProjectDatabaseId = process.env.MONOFIELD_PROJECT_DATABASE_ID;
const originalToolToken = process.env.MONOFIELD_TOOL_TOKEN;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalProjectDatabaseId === undefined) delete process.env.MONOFIELD_PROJECT_DATABASE_ID;
  else process.env.MONOFIELD_PROJECT_DATABASE_ID = originalProjectDatabaseId;
  if (originalToolToken === undefined) delete process.env.MONOFIELD_TOOL_TOKEN;
  else process.env.MONOFIELD_TOOL_TOKEN = originalToolToken;
});

function helpers() {
  return {
    baseUrl: async () => 'http://127.0.0.1:7456',
    parseFlags: (args: string[]) => {
      const result: Record<string, unknown> = {};
      for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--json') result.json = true;
        if (arg === '--limit') result.limit = args[index + 1];
      }
      return result;
    },
    positionalArgs: (args: string[]) => args.filter((arg, index) => {
      if (arg.startsWith('--')) return false;
      if (index > 0 && args[index - 1] === '--limit') return false;
      return true;
    }),
  };
}

describe('database table CLI fast path', () => {
  it('inspects one table with the selected project connection in one request', async () => {
    process.env.MONOFIELD_PROJECT_DATABASE_ID = 'db-project';
    process.env.MONOFIELD_TOOL_TOKEN = 'run-token';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ tables: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await runDatabaseCli(['table', 'abtdb', 'tbpcl250', '--limit', '5', '--json'], helpers());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:7456/api/database/connections/db-project/inspect');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ authorization: 'Bearer run-token' });
    expect(JSON.parse(String(init.body))).toEqual({
      tables: [{ schema: 'abtdb', table: 'tbpcl250' }],
      limit: 5,
    });

    stdout.mockRestore();
  });

  it('hard-fails a broker error after one request instead of retrying or changing projects', async () => {
    process.env.MONOFIELD_PROJECT_DATABASE_ID = 'db-project';
    process.env.MONOFIELD_TOOL_TOKEN = 'run-token';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: { message: 'UNC working directory is unavailable' },
    }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      runDatabaseCli(['table', 'abtdb', 'tbpcl250', '--limit', '5', '--json'], helpers()),
    ).rejects.toThrow('UNC working directory is unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
