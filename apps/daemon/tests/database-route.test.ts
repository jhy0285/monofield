import http from 'node:http';

import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerDatabaseRoutes } from '../src/routes/database.js';

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function fixture() {
  const app = express();
  app.use(express.json());
  const broker = vi.fn(async (request: { action: string; connectionId?: string }) => {
    if (request.action === 'list') return { connections: [{ id: 'db-1', label: 'Allowed' }, { id: 'db-2', label: 'Other' }] };
    return { tables: [{ schema: 'public', table: 'orders' }] };
  });
  registerDatabaseRoutes(app, {
    desktopDatabaseBroker: broker,
    authorizeRead: (req, res) => {
      if (req.headers.authorization !== 'Bearer project-token') {
        res.status(401).json({ error: { code: 'TOOL_TOKEN_MISSING' } });
        return null;
      }
      return { connectionId: 'db-1', projectId: 'project-1' };
    },
  });
  const server = http.createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  return { broker, url: `http://127.0.0.1:${address.port}` };
}

describe('database route capability boundary', () => {
  it('rejects local reads without a project tool token', async () => {
    const { broker, url } = await fixture();
    const response = await fetch(`${url}/api/database/connections`);
    expect(response.status).toBe(401);
    expect(broker).not.toHaveBeenCalled();
  });

  it('returns only the database bound to the active project token', async () => {
    const { url } = await fixture();
    const response = await fetch(`${url}/api/database/connections`, { headers: { authorization: 'Bearer project-token' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ connections: [{ id: 'db-1', label: 'Allowed' }] });
  });

  it('blocks a token from reading another connection id', async () => {
    const { broker, url } = await fixture();
    const response = await fetch(`${url}/api/database/connections/db-2/schemas`, { headers: { authorization: 'Bearer project-token' } });
    expect(response.status).toBe(403);
    expect(broker).not.toHaveBeenCalled();
  });
});
