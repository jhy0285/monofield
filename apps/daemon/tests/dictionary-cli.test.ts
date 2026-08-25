import { afterEach, describe, expect, it, vi } from 'vitest';
import { runDictionaryCli } from '../src/dictionaries/cli.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('dictionary CLI', () => {
  it('attaches the latest global dictionary version to a project by default', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/dictionaries/dictionary-1')) {
        return new Response(JSON.stringify({ dictionary: { latestVersion: { id: 'version-2' } } }), { status: 200 });
      }
      if (url.endsWith('/api/projects/project-1/dictionaries/attach')) {
        return new Response(JSON.stringify({ snapshot: { path: '_open-docs/dictionaries/terms-v2.xlsx' } }), { status: 201 });
      }
      return new Response('{}', { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await runDictionaryCli(['attach', 'dictionary-1', '--project', 'project-1'], {
      baseUrl: async () => 'http://127.0.0.1:7456',
      parseFlags: () => ({ project: 'project-1' }),
      positionalArgs: () => ['dictionary-1'],
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:7456/api/dictionaries/dictionary-1',
      'http://127.0.0.1:7456/api/projects/project-1/dictionaries/attach',
    ]);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'POST' });
    expect(write).toHaveBeenCalledWith(expect.stringContaining('terms-v2.xlsx'));
  });
});
