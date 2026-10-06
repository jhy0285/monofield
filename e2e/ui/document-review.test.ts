import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@/playwright/suite';
import { T } from '@/timeouts';

for (const proposalFormat of ['complete', 'changes'] as const) {
test(`[P1] reviews Git impact and saves evidence from a ${proposalFormat} proposal`, async ({ page, toolsDev }, testInfo) => {
  test.setTimeout(2 * T.xlong);
  const root = join(toolsDev.root, 'scratch', 'orders-fixture');
  await mkdir(root, { recursive: true });
  function git(...args: string[]) {
    return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: root, encoding: 'utf8' }).trim();
  }
  git('init', '--quiet'); await writeFile(join(root, 'orders.ts'), 'export const id = 1;');
  git('add', '.'); git('commit', '--quiet', '--no-verify', '-m', 'initial');
  const revision = git('rev-parse', 'HEAD');
  await writeFile(join(root, 'orders.ts'), 'export const id = "order";');
  const imported = await page.request.post('/api/import/folder', { data: { baseDir: root, name: 'Evidence review' } });
  expect(imported.ok()).toBeTruthy();
  const { project } = await imported.json() as { project: { id: string } };
  const config = { mode: 'daemon', onboardingCompleted: true, privacyDecisionAt: 1,
    telemetry: { metrics: false, content: false, artifactManifest: false }, skillId: null, designSystemId: null };
  await page.request.put('/api/app-config', { data: config });
  await page.addInitScript((saved) => {
    localStorage.setItem('open-design:config', JSON.stringify(saved));
    localStorage.setItem('open-design:locale', 'en');
    localStorage.setItem('open-design:locale-source', 'manual');
  }, config);
  const doc = { schemaVersion: 1, kind: 'interface-spec', cover: { docName: 'Orders' },
    source: { codebaseName: 'Orders', revision }, endpoints: [{ method: 'GET', path: '/orders',
      interfaceId: 'IF-001', interfaceName: 'Orders', sourceFile: 'orders.ts',
      responseFields: [{ nameEn: 'id', dataType: 'Number', required: 'Y' }],
    }],
  };
  async function saveFile(name: string, content: unknown) {
    const response = await page.request.post(`/api/projects/${project.id}/files`, { data: {
      name, content: JSON.stringify(content), artifactManifest: { version: 1, kind: 'interface-spec', renderer: 'interface-spec', entry: name, title: 'Orders', status: 'complete', exports: ['xlsx'] },
    } });
    expect(response.ok()).toBeTruthy();
  }
  await saveFile('orders.interface-spec.json', doc);
  const screenSaved = await page.request.post(`/api/projects/${project.id}/files`, { data: {
    name: 'orders.screen-spec.json', content: JSON.stringify({ schemaVersion: 1, kind: 'screen-spec', name: 'Orders screen', screens: [
      { id: 'SCR-001', screenName: 'Orders screen', evidenceRefs: [{ kind: 'requirement', ref: 'Orders API', document: { path: 'orders.interface-spec.json', itemId: 'IF-001' } }] },
    ] }),
    artifactManifest: { version: 1, kind: 'screen-spec', renderer: 'screen-spec', entry: 'orders.screen-spec.json', title: 'Orders screen', status: 'complete', exports: ['pptx'] },
  } });
  expect(screenSaved.ok()).toBeTruthy();
  await page.goto(`/projects/${project.id}/files/orders.interface-spec.json`);
  await expect(page.getByRole('heading', { name: 'Document change review' })).toBeVisible({ timeout: 60_000 });
  const dependencies = page.getByRole('region', { name: 'Screen, API and database dependencies' });
  await expect(dependencies).toBeVisible();
  await dependencies.getByRole('button', { name: 'Analyze dependencies' }).click();
  await expect(dependencies).toContainText('2 documents · 2 affected items · 0 items without dependencies');
  await expect(dependencies).toContainText('orders.ts → Orders → Orders screen');
  await dependencies.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('dependency-graph.png'), fullPage: true });
  await page.getByRole('button', { name: 'Analyze Git changes' }).click();
  await expect(page.getByText('Affected: 1 · No code references: 0')).toBeVisible();
  await page.getByRole('button', { name: 'Prepare AI update request' }).click();
  await expect(page.locator('.composer-input-wrap [contenteditable="true"]')).toContainText('orders.interface-spec.proposed.json');
  const completeProposal = { ...doc, endpoints: [{ ...doc.endpoints[0],
    responseFields: [{ nameEn: 'id', dataType: 'String', required: 'Y', reviewStatus: 'unreviewed',
      evidenceRefs: [{ kind: 'code', ref: 'orders.ts', line: 1, revision, summary: 'Identifier is now a string' }],
    }],
  }] };
  if (proposalFormat === 'changes') {
    const analyzed = await page.request.post(`/api/projects/${project.id}/documents/impact`, { data: { inputFile: 'orders.interface-spec.json' } });
    expect(analyzed.ok()).toBeTruthy();
    const report = await analyzed.json() as { contentSha256: string };
    await saveFile('orders.interface-spec.proposed.json', { schemaVersion: 1, kind: 'interface-spec-proposal',
      baseContentSha256: report.contentSha256, changes: [
        { op: 'test', path: '/endpoints/0/interfaceId', value: 'IF-001' },
        { op: 'replace', path: '/endpoints/0/responseFields/0/dataType', value: 'String' },
        { op: 'add', path: '/endpoints/0/responseFields/0/reviewStatus', value: 'unreviewed' },
        { op: 'add', path: '/endpoints/0/responseFields/0/evidenceRefs', value: completeProposal.endpoints[0]!.responseFields[0]!.evidenceRefs },
      ],
    });
  } else await saveFile('orders.interface-spec.proposed.json', completeProposal);
  await page.getByRole('button', { name: 'Review AI proposal' }).click();
  await expect(page.getByRole('columnheader', { name: 'AI proposal', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'String', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('document-change-review.png'), fullPage: true });
  await page.getByRole('button', { name: 'Apply reviewed proposal' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const raw = await page.request.get(`/api/projects/${project.id}/raw/orders.interface-spec.json`);
  const saved = await raw.json() as { endpoints: Array<{ responseFields: Array<{ dataType: string; reviewStatus: string; evidenceRefs: Array<{ ref: string }> }> }> };
  expect(saved.endpoints[0]?.responseFields[0]).toMatchObject({ dataType: 'String', reviewStatus: 'accepted', evidenceRefs: [{ ref: 'orders.ts' }] });
  const rendered = await page.request.post(`/api/projects/${project.id}/documents/render`, { data: { inputFile: 'orders.interface-spec.json', action: 'export' } });
  expect(rendered.ok()).toBeTruthy();
  const output = await rendered.json() as { outputUrl: string };
  const workbook = await page.request.get(output.outputUrl);
  expect((await workbook.body()).subarray(0, 2).toString()).toBe('PK');
});
}
