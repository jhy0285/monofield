import { createHash } from 'node:crypto';
import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

describe('project file optimistic write route', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const started = await startServer({ port: 0, returnServer: true }) as {
      server: http.Server;
      url: string;
    };
    server = started.server;
    baseUrl = started.url;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('returns 409 and preserves an interleaved disk update', async () => {
    const projectId = `file-cas-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const create = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: projectId, name: projectId }),
    });
    expect(create.status).toBe(200);

    const post = (content: string, expectedContentSha256?: string) => fetch(
      `${baseUrl}/api/projects/${projectId}/files`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'src/app.ts', content, expectedContentSha256 }),
      },
    );
    const original = 'export const value = 1;\n';
    expect((await post(original)).status).toBe(200);
    expect((await post('export const value = 2;\n')).status).toBe(200);

    const stale = await post(
      'export const local = true;\n',
      createHash('sha256').update(original).digest('hex'),
    );
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      error: { code: 'FILE_CHANGED' },
    });
    const latest = await fetch(`${baseUrl}/api/projects/${projectId}/files/src/app.ts`);
    await expect(latest.text()).resolves.toBe('export const value = 2;\n');
  });
});
