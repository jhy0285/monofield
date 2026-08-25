import { describe, expect, it } from 'vitest';

import { createOpenDocsPublicMetadataService } from '../src/services/open-design-public-metadata.js';

describe('MonoField public metadata service', () => {
  it('falls back to the GitHub repository page when the REST API is rate limited', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      calls.push(url);
      if (url === 'https://api.github.com/repos/jhy0285/monofield') {
        return new Response('rate limited', { status: 403 });
      }
      if (url === 'https://github.com/jhy0285/monofield') {
        return new Response(
          '<span id="repo-stars-counter-star" aria-label="1 user starred this repository" title="1">1</span>',
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    const service = createOpenDocsPublicMetadataService({
      fetchImpl,
      now: () => Date.parse('2026-07-03T00:00:00.000Z'),
    });

    const stats = await service.readGithubRepoStats();

    expect(stats).toMatchObject({
      stargazersCount: 1,
      stale: false,
    });
    expect(calls).toEqual([
      'https://api.github.com/repos/jhy0285/monofield',
      'https://github.com/jhy0285/monofield',
    ]);
  });
});
