import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MonoFieldGithubLatestReleaseResponse } from '@open-design/contracts';

import { fetchLatestGithubReleaseInfo } from '../../src/providers/registry';

const originalFetch = globalThis.fetch;

describe('fetchLatestGithubReleaseInfo', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('reads the latest release metadata from the daemon endpoint', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        repo: 'jhy0285/monofield',
        tag_name: 'v0.11.1',
        html_url: 'https://github.com/jhy0285/monofield/releases/tag/v0.11.1',
        fetchedAt: Date.parse('2026-05-22T00:00:00.000Z'),
        stale: false,
      } satisfies MonoFieldGithubLatestReleaseResponse),
    } satisfies Partial<Response>) as typeof fetch;

    const result = await fetchLatestGithubReleaseInfo();

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/github/monofield/releases/latest');
    expect(result).toEqual({
      tagName: 'v0.11.1',
      htmlUrl: 'https://github.com/jhy0285/monofield/releases/tag/v0.11.1',
      stale: false,
    });
  });

  it('returns null when the daemon endpoint fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false } satisfies Partial<Response>) as typeof fetch;

    await expect(fetchLatestGithubReleaseInfo()).resolves.toBeNull();
  });
});
