import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runDocsCli } from '../src/docs-cli.js';

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('docs CLI manual interface-spec workflow', () => {
  it('converts a reviewed draft, previews it, and exports the selected XLSX template', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const dir = await mkdtemp(path.join(os.tmpdir(), 'open-docs-manual-interface-'));
    tempDirs.push(dir);
    const draftPath = path.join(dir, 'manual-interface-spec-draft.json');
    const docPath = path.join(dir, 'interface-spec.json');
    const previewPath = path.join(dir, 'preview.html');
    const workbookPath = path.join(dir, 'orders.xlsx');
    await writeFile(draftPath, JSON.stringify({
      documentName: '주문 API 인터페이스 명세서',
      version: '1.0',
      templatePreset: 'review',
      endpoints: [{
        interfaceName: '주문 생성',
        interfaceId: 'IF-ORD-001',
        method: 'POST',
        path: '/api/orders',
        businessPurpose: '고객과 상품 목록으로 주문을 생성합니다.',
        auth: 'bearer',
        requestFields: [
          { nameEn: 'customerId', dataType: 'UUID', minSize: '1', maxSize: '36', required: 'TBD' },
          { nameEn: 'items', dataType: '', required: 'TBD' },
        ],
        responseFields: [
          { nameEn: 'orderId', dataType: '', required: 'TBD' },
          { nameEn: 'status', dataType: '', required: 'TBD' },
        ],
      }],
    }), 'utf8');

    expect((await runDocsCli(['create-manual-interface-spec', '--input', draftPath, '--out', docPath])).exitCode).toBe(0);
    const document = JSON.parse(await readFile(docPath, 'utf8'));
    expect(document).toMatchObject({
      source: { mode: 'manual', collector: 'manual', codebasePath: '' },
      templatePreset: 'review',
      endpoints: [{
        method: 'POST',
        interfaceId: 'IF-ORD-001',
        businessPurpose: '고객과 상품 목록으로 주문을 생성합니다.',
        auth: { type: 'bearer' },
        requestFields: [
          { nameEn: 'customerId', minSize: '1', maxSize: '36' },
          { nameEn: 'items' },
        ],
      }],
    });

    expect((await runDocsCli(['preview-interface-spec', '--input', docPath, '--out', previewPath])).exitCode).toBe(0);
    const preview = await readFile(previewPath, 'utf8');
    expect(preview).toContain('#fff2cc');
    expect(preview).toContain('data-monofield-kind="interface-spec"');
    expect(preview).toContain('고객과 상품 목록으로 주문을 생성합니다.');
    expect(preview).toContain('data-od-id="interface-spec-0-request-field-1"');
    expect((await runDocsCli(['render-interface-spec', '--input', docPath, '--out', workbookPath])).exitCode).toBe(0);
    expect((await stat(workbookPath)).size).toBeGreaterThan(10_000);
  });

  it('does not write a canonical document from intake or unaccepted AI suggestions', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const dir = await mkdtemp(path.join(os.tmpdir(), 'open-docs-manual-interface-guard-'));
    tempDirs.push(dir);

    const cases = [
      {
        name: 'intake',
        draft: {
          documentName: 'Orders',
          reviewStage: 'intake',
          endpoints: [{ interfaceName: '주문 생성', method: 'POST', path: '/api/orders' }],
        },
      },
      {
        name: 'suggested',
        draft: {
          documentName: 'Orders',
          reviewStage: 'review',
          endpoints: [{
            interfaceName: '주문 생성',
            method: 'POST',
            path: '/api/orders',
            requestFields: [{ nameEn: 'customerId', suggested: true }],
          }],
        },
      },
    ];

    for (const testCase of cases) {
      const draftPath = path.join(dir, `${testCase.name}.json`);
      const outputPath = path.join(dir, `${testCase.name}-interface-spec.json`);
      await writeFile(draftPath, JSON.stringify(testCase.draft), 'utf8');

      await expect(
        runDocsCli(['create-manual-interface-spec', '--input', draftPath, '--out', outputPath]),
      ).resolves.toEqual({ exitCode: 1 });
      await expect(stat(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });
});
