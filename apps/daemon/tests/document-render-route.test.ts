import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase, insertProject, openDatabase } from '../src/db.js';
import { registerDocumentRenderRoutes } from '../src/routes/document-render.js';

describe('document render route', () => {
  let tempDir: string;
  let db: ReturnType<typeof openDatabase>;
  let files: Map<string, Buffer>;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'open-agent-document-render-'));
    db = openDatabase(path.join(tempDir, 'projects'), { dataDir: tempDir });
    insertProject(db, {
      id: 'project-1',
      name: 'Document project',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: { kind: 'document' },
    });
    files = new Map();
  });

  afterEach(() => {
    closeDatabase();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('renders an interface specification workbook into the project', async () => {
    files.set('orders.interface-spec.json', Buffer.from(JSON.stringify({
      schemaVersion: 1,
      kind: 'interface-spec',
      cover: { docName: 'Orders API' },
      source: { codebaseName: 'orders-service' },
      endpoints: [{
        interfaceId: 'IF-ORD-001',
        interfaceName: 'Create order',
        method: 'POST',
        path: '/api/orders',
        requestFields: [{ nameEn: 'customerId', dataType: 'String', required: 'Y' }],
        responseFields: [{ nameEn: 'orderId', dataType: 'String', required: 'Y' }],
      }],
    })));

    const response = await post({ inputFile: 'orders.interface-spec.json', action: 'export' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, kind: 'interface-spec', action: 'export', itemCount: 1 });
    const output = files.get(response.body.outputFile);
    expect(output?.subarray(0, 2).toString()).toBe('PK');
  });

  it('exports an interface specification as OpenAPI 3.1 JSON', async () => {
    files.set('orders.interface-spec.json', Buffer.from(JSON.stringify({
      schemaVersion: 1,
      kind: 'interface-spec',
      cover: { docName: 'Orders API', version: '1.2' },
      source: { codebaseName: 'orders-service' },
      auth: { type: 'bearer' },
      endpoints: [
        {
          interfaceId: 'IF-ORD-001', interfaceName: 'Create order', method: 'POST', path: '/api/orders', authRequired: true,
          requestFields: [{ nameEn: 'customerId', dataType: 'String', required: 'Y' }],
          responseFields: [{ nameEn: 'orderId', dataType: 'Long', required: 'Y' }],
        },
        { interfaceId: 'EV-ORD-001', method: 'PUBLISH', path: 'orders.created' },
      ],
    })));

    const response = await post({ inputFile: 'orders.interface-spec.json', action: 'export-openapi' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true, kind: 'interface-spec', action: 'export-openapi', outputFile: 'Orders_API_openapi.json', itemCount: 2,
      warnings: [expect.stringContaining('"PUBLISH" is not an HTTP method')],
    });
    const openapi = JSON.parse(files.get(response.body.outputFile)!.toString('utf8'));
    expect(openapi).toMatchObject({
      openapi: '3.1.0',
      info: { title: 'Orders API', version: '1.2' },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
      paths: { '/api/orders': { post: { operationId: 'IF-ORD-001', 'x-interface-id': 'IF-ORD-001', security: [{ bearerAuth: [] }] } } },
    });
    expect(openapi.paths['/api/orders'].post.requestBody.content['application/json'].schema).toEqual({
      type: 'object', required: ['customerId'], properties: { customerId: { type: 'string' } },
    });
  });

  it('refuses OpenAPI export for screen specifications', async () => {
    files.set('screens.screen-spec.json', Buffer.from(JSON.stringify({
      schemaVersion: 1, kind: 'screen-spec', name: 'Screens', screens: [],
    })));
    const response = await post({ inputFile: 'screens.screen-spec.json', action: 'export-openapi' });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ ok: false, code: 'INVALID_DOCUMENT' });
  });

  it('renders a screen specification preview and resolves project-relative images', async () => {
    files.set('spec/assets/login.png', Buffer.from('image-bytes'));
    files.set('spec/app.screen-spec.json', Buffer.from(JSON.stringify({
      schemaVersion: 1,
      kind: 'screen-spec',
      name: 'Login screens',
      screens: [{
        id: 'SCR-001',
        screenName: 'Login',
        imageRef: 'assets/login.png',
        callouts: [{ no: 1, label: 'Submit', description: 'Submits the form.', position: { x: 0.5, y: 0.5 } }],
      }],
    })));

    const response = await post({ inputFile: 'spec/app.screen-spec.json', action: 'preview' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, kind: 'screen-spec', action: 'preview', itemCount: 1 });
    const output = files.get(response.body.outputFile)?.toString('utf8') ?? '';
    expect(output).toContain('data:image/png;base64,aW1hZ2UtYnl0ZXM=');
    expect(output).toContain('Submit');
  });

  it('blocks path traversal before reading a project file', async () => {
    const response = await post({ inputFile: '../outside.json', action: 'preview' });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ ok: false, code: 'INVALID_DOCUMENT' });
  });

  it('resolves canonical project-relative images for a nested document before legacy relative images', async () => {
    files.set('spec/assets/login.png', Buffer.from('canonical-image'));
    files.set('spec/spec/assets/login.png', Buffer.from('wrong-relative-image'));
    files.set('spec/app.screen-spec.json', Buffer.from(JSON.stringify({
      schemaVersion: 1, kind: 'screen-spec', name: 'Nested specification',
      screens: [{ id: 'SCR-001', screenName: 'Login', imageRef: 'spec/assets/login.png' }],
    })));
    const response = await post({ inputFile: 'spec/app.screen-spec.json', action: 'preview' });
    expect(response.status).toBe(200);
    const html = files.get(response.body.outputFile)?.toString('utf8') ?? '';
    expect(html).toContain(Buffer.from('canonical-image').toString('base64'));
    expect(html).not.toContain(Buffer.from('wrong-relative-image').toString('base64'));
  });

  it('blocks export while a document has fatal validation issues', async () => {
    files.set('empty.interface-spec.json', Buffer.from(JSON.stringify({
      schemaVersion: 1,
      kind: 'interface-spec',
      source: { codebaseName: 'empty-service' },
      endpoints: [],
    })));

    const response = await post({ inputFile: 'empty.interface-spec.json', action: 'export' });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ ok: false, code: 'DOCUMENT_VALIDATION_FAILED' });
    expect(response.body.issues).toContainEqual(expect.objectContaining({ code: 'missing-endpoint', severity: 'fatal' }));
  });

  async function post(body: unknown): Promise<{ status: number; body: any }> {
    const app = express();
    app.use(express.json());
    registerDocumentRenderRoutes(app, {
      db,
      http: {
        requireLocalDaemonRequest: (_req: unknown, _res: unknown, next: () => void) => next(),
      },
      paths: { PROJECTS_DIR: path.join(tempDir, 'projects') },
      projectFiles: {
        readProjectFile: async (_root: string, _projectId: string, filePath: string) => {
          const buffer = files.get(filePath);
          if (!buffer) throw new Error(`Missing fixture: ${filePath}`);
          return { buffer };
        },
        writeProjectFile: async (
          _root: string,
          _projectId: string,
          filePath: string,
          buffer: Buffer,
        ) => {
          files.set(filePath, buffer);
        },
      },
    } as any);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/projects/project-1/documents/render`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  }
});
