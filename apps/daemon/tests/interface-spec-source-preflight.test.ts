import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { preflightInterfaceSpecSource } from '../src/interface-spec-source-preflight.js';

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'monofield-interface-source-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('preflightInterfaceSpecSource', () => {
  it('rejects a missing or empty folder', async () => {
    const root = await temporaryRoot();

    await expect(preflightInterfaceSpecSource(path.join(root, 'missing'))).resolves.toMatchObject({
      ok: false,
      reason: 'missing',
    });
    await expect(preflightInterfaceSpecSource(root)).resolves.toMatchObject({
      ok: false,
      reason: 'no-analyzable-source',
    });
  });

  it('accepts readable route source discovered below the selected root', async () => {
    const root = await temporaryRoot();
    const sourceDir = path.join(root, 'services', 'orders', 'src');
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      path.join(sourceDir, 'app.ts'),
      "router.post('/api/orders', createOrder);\n",
      'utf8',
    );

    await expect(preflightInterfaceSpecSource(root)).resolves.toMatchObject({
      ok: true,
      root,
    });
  });

  it('accepts a DTO/controller filename even when the route is declared elsewhere', async () => {
    const root = await temporaryRoot();
    await writeFile(path.join(root, 'CreateOrderDto.java'), 'public record CreateOrderDto(String id) {}', 'utf8');

    await expect(preflightInterfaceSpecSource(root)).resolves.toMatchObject({ ok: true });
  });

  it('accepts a JSON OpenAPI contract as analyzable API source', async () => {
    const root = await temporaryRoot();
    await writeFile(
      path.join(root, 'openapi.json'),
      JSON.stringify({ openapi: '3.1.0', paths: { '/api/orders': { post: {} } } }),
      'utf8',
    );

    await expect(preflightInterfaceSpecSource(root)).resolves.toMatchObject({ ok: true });
  });

  it('does not treat ignored dependency sources as the selected codebase', async () => {
    const root = await temporaryRoot();
    const dependencyDir = path.join(root, 'node_modules', 'example');
    await mkdir(dependencyDir, { recursive: true });
    await writeFile(path.join(dependencyDir, 'router.ts'), "router.get('/dependency', handler);", 'utf8');
    await writeFile(path.join(root, 'README.md'), '# empty workspace', 'utf8');

    await expect(preflightInterfaceSpecSource(root)).resolves.toMatchObject({
      ok: false,
      reason: 'no-analyzable-source',
    });
  });

  it('still finds a named controller after the generic source-content quota', async () => {
    const root = await temporaryRoot();
    const controllerDir = path.join(root, 'zz-api');
    await mkdir(controllerDir, { recursive: true });
    await Promise.all(Array.from({ length: 513 }, async (_, index) => {
      await writeFile(path.join(root, `ordinary-${String(index).padStart(3, '0')}.ts`), 'export const value = 1;\n', 'utf8');
    }));
    await writeFile(
      path.join(controllerDir, 'OrderController.java'),
      'public class OrderController {}\n',
      'utf8',
    );

    await expect(preflightInterfaceSpecSource(root)).resolves.toMatchObject({
      ok: true,
      signal: expect.stringContaining('OrderController.java'),
    });
  });
});
