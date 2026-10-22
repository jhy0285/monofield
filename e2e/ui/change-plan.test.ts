import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@/playwright/suite';
import { T } from '@/timeouts';
import type { ChangePlanResponse, VerificationStatus } from '@open-design/contracts';

test('[P1] plans a legacy storefront change, simulates impact and invalidates real receipts', async ({ page, toolsDev }, testInfo) => {
  test.setTimeout(3 * T.xlong);
  const root = join(toolsDev.root, 'scratch', 'legacy-store-plan');
  await mkdir(root, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: root });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'legacy-store', private: true, type: 'module', scripts: { test: 'node --test prices.test.mjs' } }));
  await writeFile(join(root, 'prices.mjs'), 'export const price = (amount, discount) => amount - discount;');
  await writeFile(join(root, 'prices.test.mjs'), "import { test } from 'node:test'; import { strict as assert } from 'node:assert'; import { price } from './prices.mjs'; test('discount price', () => assert.equal(price(100, 20), 80));");
  const imported = await page.request.post('/api/import/folder', { data: { baseDir: root, name: 'Legacy storefront' } });
  expect(imported.ok()).toBeTruthy(); const { project } = await imported.json() as { project: { id: string } };
  const config = { mode: 'daemon', onboardingCompleted: true, privacyDecisionAt: 1, telemetry: { metrics: false, content: false, artifactManifest: false }, skillId: null, designSystemId: null };
  await page.request.put('/api/app-config', { data: config });
  await page.addInitScript(saved => {
    localStorage.setItem('open-design:config', JSON.stringify(saved));
    if (!localStorage.getItem('open-design:locale')) localStorage.setItem('open-design:locale', 'en');
    localStorage.setItem('open-design:locale-source', 'manual');
  }, config);
  for (const [name, kind, content] of [
    ['api.json', 'interface-spec', { schemaVersion: 1, kind: 'interface-spec', source: { codebaseName: 'Legacy store' }, endpoints: [{ method: 'GET', path: '/prices', interfaceId: 'PRICE', interfaceName: 'Price API', sourceFile: 'prices.mjs' }] }],
    ['screens.json', 'screen-spec', { schemaVersion: 1, kind: 'screen-spec', name: 'Storefront', screens: [{ id: 'SHOP', screenName: 'Storefront', evidenceRefs: [{ kind: 'requirement', ref: 'Price API', document: { path: 'api.json', itemId: 'PRICE' } }] }] }],
  ] as const) {
    const saved = await page.request.post(`/api/projects/${project.id}/files`, { data: { name, content: JSON.stringify(content), artifactManifest: { version: 1, kind, renderer: kind, entry: name, title: 'Legacy storefront', status: 'complete', exports: kind === 'interface-spec' ? ['xlsx'] : ['pptx'] } } });
    expect(saved.ok(), await saved.text()).toBeTruthy();
  }
  await writeFile(join(root, 'change-policy.json'), JSON.stringify({ schemaVersion: 1, bindings: [
    { target: { kind: 'code', pathPrefix: 'prices.mjs' }, checkIds: ['node:test'] },
    { target: { kind: 'api', documentFile: 'api.json', itemId: 'PRICE' }, checkIds: ['node:test'] },
  ], rules: [{ id: 'store-design', when: { kind: 'screen', itemId: 'SHOP' }, require: { checkIds: [], reviews: ['contrast'] } }] }));
  git('init', '--quiet'); git('add', '.'); git('commit', '--quiet', '--no-verify', '-m', 'Legacy storefront');
  await writeFile(join(root, 'prices.mjs'), 'export const price = (amount, discount) => Math.max(0, amount - discount);');
  await writeFile(join(root, 'prices.test.mjs'), (await readFile(join(root, 'prices.test.mjs'), 'utf8')) + "\ntest('price never negative', () => assert.equal(price(10, 20), 0));");
  const inputs = { inputFiles: ['api.json', 'screens.json'], rulesFile: 'change-policy.json', request: 'Prevent negative prices and review storefront design' };
  await page.goto(`/projects/${project.id}/files/api.json`);
  const dependencies = page.getByRole('region', { name: 'Screen, API and database dependencies' });
  await expect(dependencies).toBeVisible({ timeout: T.xlong });
  await dependencies.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('01-entry.png') });
  const panel = page.getByRole('region', { name: 'Change impact and verification plan' });
  await panel.getByRole('button', { name: 'Change impact and verification plan' }).click();
  await panel.getByLabel('Change to develop').fill(inputs.request);
  await panel.getByLabel('Project policy JSON (optional)').fill('change-policy.json');
  await panel.getByRole('button', { name: 'Build change plan' }).click();
  await expect(panel).toContainText('3 affected'); await expect(panel).toContainText('Required check unavailable');
  await panel.getByText('Why this is required').first().click();
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('02-rules-and-obligations.png') });
  await panel.getByRole('button', { name: 'Prepare development request' }).click();
  await expect(page.locator('.composer-input-wrap [contenteditable="true"]')).toContainText('Prevent negative prices');
  await page.screenshot({ path: testInfo.outputPath('03-development-draft.png') });
  await panel.getByText('What if a file or database target changes?').click();
  await panel.getByRole('checkbox', { name: 'code · prices.mjs' }).check();
  await panel.getByRole('button', { name: 'Simulate selected changes' }).click();
  await expect(panel).toContainText('What-if simulation');
  await page.screenshot({ path: testInfo.outputPath('04-simulation.png') });
  const before = await readFile(join(root, 'prices.mjs'), 'utf8');
  expect(before).toContain('Math.max');
  const verification = await page.request.post(`/api/projects/${project.id}/development/verification`, { data: { checkIds: ['node:test'] } });
  expect(verification.status()).toBe(202);
  await expect.poll(async () => {
    const response = await page.request.get(`/api/projects/${project.id}/development/verification?live=1`);
    return ((await response.json()) as VerificationStatus).run?.state;
  }, { timeout: T.long }).toBe('passed');
  await panel.getByRole('button', { name: 'Build change plan' }).click();
  await expect(panel).toContainText('Command passed on current source');
  await expect(panel).toContainText('Manual review needed');
  await page.screenshot({ path: testInfo.outputPath('05-real-pass-with-review-debt.png') });
  await writeFile(join(root, 'prices.mjs'), before + '\n// New source requires rerunning the checks.');
  await panel.getByRole('button', { name: 'Build change plan' }).click();
  await expect(panel).toContainText('Previous pass is stale');
  await page.screenshot({ path: testInfo.outputPath('06-stale-receipt.png') });
  const samples: Array<{ elapsedMs: number; mode: string; modelCalls: number; passed: number; outstanding: number; handoffCharacters: number }> = [];
  for (let index = 0; index < 10; index++) {
    const response = await page.request.post(`/api/projects/${project.id}/documents/plan`, { data: inputs });
    expect(response.ok()).toBeTruthy(); const report = await response.json() as ChangePlanResponse;
    samples.push({ elapsedMs: report.elapsedMs, mode: report.mode, modelCalls: report.modelCalls, passed: report.summary.passed, outstanding: report.summary.outstanding, handoffCharacters: report.handoff.length });
  }
  await writeFile(testInfo.outputPath('measurements.json'), JSON.stringify({ fixture: 'Actual local Node legacy-store fixture; no AI implementation benchmark and no real DB connection', samples }, null, 2));
  await page.evaluate(() => localStorage.setItem('open-design:locale', 'ko'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  const korean = page.getByRole('region', { name: '변경 영향 · 검증 계획' });
  await korean.getByRole('button', { name: '변경 영향 · 검증 계획' }).click();
  await korean.getByLabel('개발할 변경').fill('가격이 음수가 되지 않도록 수정하고 상품 화면을 검토');
  await korean.getByLabel('프로젝트 규칙 JSON (선택)').fill('change-policy.json');
  await korean.getByRole('button', { name: '변경 계획 분석' }).click();
  await expect(korean).toContainText('이전 통과 결과 만료');
  await korean.getByText('필요한 이유와 영향 경로').first().click();
  await korean.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('07-korean-source-evidence.png') });
  await korean.locator('ol').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await korean.getByText('필요한 이유와 영향 경로').last().click();
  await page.screenshot({ path: testInfo.outputPath('08-korean-design-review.png') });
});
