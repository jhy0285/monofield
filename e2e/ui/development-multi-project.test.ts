import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '@/playwright/suite';
import { T } from '@/timeouts';

const MODULES = ['member-web', 'order-api', 'settle-svc'] as const;

async function createMultiProjectWorkspace(root: string): Promise<void> {
  for (const module of MODULES) {
    const dir = join(root, module);
    const webapp = join(dir, 'src', 'main', 'webapp');
    await mkdir(join(webapp, 'resources', 'css'), { recursive: true });
    await writeFile(join(dir, 'pom.xml'), `<project><modelVersion>4.0.0</modelVersion><groupId>kr.demo</groupId><artifactId>${module}</artifactId><version>1</version><packaging>war</packaging></project>`);
    await writeFile(join(webapp, 'resources', 'css', 'common.css'), 'body{font:14px sans-serif;padding:24px}');
    await writeFile(join(webapp, 'index.html'), `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${module}</title><link rel="stylesheet" href="resources/css/common.css"></head><body><h1>${module} 관리 콘솔</h1></body></html>`);
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: dir });
    git('init', '--quiet'); git('add', '.'); git('commit', '--quiet', '--no-verify', '-m', 'baseline');
  }
}

async function openDevelopmentWorkspace(page: Page, root: string): Promise<string> {
  const imported = await page.request.post('/api/import/folder', { data: { baseDir: root, name: 'SI 다중 프로젝트 작업공간' } });
  expect(imported.ok()).toBeTruthy();
  const { project } = await imported.json();
  await page.request.patch(`/api/projects/${project.id}`, { data: { metadata: { ...project.metadata, workMode: 'development', development: { autoVerify: false } } } });
  const config = { mode: 'daemon', onboardingCompleted: true, privacyDecisionAt: 1, telemetry: { metrics: false, content: false, artifactManifest: false }, skillId: null, designSystemId: null };
  await page.request.put('/api/app-config', { data: config });
  await page.addInitScript(saved => {
    localStorage.setItem('open-design:config', JSON.stringify(saved)); localStorage.setItem('open-design:locale', 'ko'); localStorage.setItem('open-design:locale-source', 'manual');
    localStorage.setItem('monofield:development-workspace-tutorial:v2', 'done'); localStorage.setItem('monofield:ontology-tutorial-dismissed:v1', 'true');
  }, config);
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByTestId('development-tools-dock')).toBeVisible({ timeout: T.xlong });
  await expect(page.getByTestId('development-active-project')).toBeVisible({ timeout: T.xlong });
  return project.id as string;
}

test('[P1] a development workspace holding several projects does not auto-open an arbitrary file preview', async ({ page, toolsDev }, testInfo) => {
  test.setTimeout(4 * T.xlong); await page.setViewportSize({ width: 1500, height: 1000 });
  const root = join(toolsDev.root, 'scratch', 'si-multi-no-auto-preview'); await mkdir(root, { recursive: true });
  await createMultiProjectWorkspace(root);
  await openDevelopmentWorkspace(page, root);
  for (const module of MODULES) await expect(page.getByTestId(`design-file-row-${module}/src/main/webapp/index.html`)).toBeAttached({ timeout: T.long });
  await expect(page.getByTestId('design-file-preview')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('01-no-auto-preview.png'), fullPage: true, animations: 'disabled' });
});

test('[P1] the file preview stays inside its column when a bottom tool opens beneath it', async ({ page, toolsDev }, testInfo) => {
  test.setTimeout(4 * T.xlong); await page.setViewportSize({ width: 1500, height: 1000 });
  const root = join(toolsDev.root, 'scratch', 'si-multi-preview-dock'); await mkdir(root, { recursive: true });
  await createMultiProjectWorkspace(root);
  await openDevelopmentWorkspace(page, root);
  const row = page.getByTestId(`design-file-row-${MODULES[0]}/src/main/webapp/index.html`);
  await expect(row).toBeVisible({ timeout: T.long });
  await row.locator('.df-row-icon').click();
  const preview = page.getByTestId('design-file-preview');
  await expect(preview).toBeVisible();
  await page.getByTestId('development-open-changes').click();
  const dock = page.getByTestId('development-tools-dock');
  await expect(page.getByTestId('git-changes-panel')).toBeVisible({ timeout: T.long });
  await page.screenshot({ path: testInfo.outputPath('02-preview-above-dock.png'), fullPage: true, animations: 'disabled' });

  const leaked = await page.evaluate(() => {
    const dockBox = document.querySelector('[data-testid="development-tools-dock"]')!.getBoundingClientRect();
    const column = document.querySelector('.df-preview')!;
    const columnBox = column.getBoundingClientRect();
    const parts = [...document.querySelectorAll('.df-preview-name, .df-preview-kind, .df-preview-stats, .df-preview-download')];
    const hits: string[] = [];
    for (const part of parts) {
      const box = part.getBoundingClientRect();
      const x = box.left + box.width / 2; const y = box.top + box.height / 2;
      const insideDock = y >= dockBox.top && y <= dockBox.bottom && x >= dockBox.left && x <= dockBox.right;
      if (insideDock && column.contains(document.elementFromPoint(x, y))) hits.push(part.className);
    }
    return { hits, columnBottom: Math.round(columnBox.bottom), dockTop: Math.round(dockBox.top) };
  });
  expect(leaked.hits, `preview content painted over the tools dock (preview bottom ${leaked.columnBottom}, dock top ${leaked.dockTop})`).toEqual([]);
  await expect(dock).toBeVisible();
});

test('[P1] the module picker finds a module declared inside a project and switches to it', async ({ page, toolsDev }, testInfo) => {
  test.setTimeout(4 * T.xlong); await page.setViewportSize({ width: 1500, height: 1000 });
  const root = join(toolsDev.root, 'scratch', 'si-multi-module-picker'); await mkdir(root, { recursive: true });
  const git = (dir: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: dir });
  for (let index = 1; index <= 8; index += 1) {
    const dir = join(root, `svc-0${index}`); await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: `svc-0${index}` }));
    git(dir, 'init', '--quiet'); git(dir, 'add', '.'); git(dir, 'commit', '--quiet', '--no-verify', '-m', 'baseline');
  }
  const ear = join(root, 'legacy-ear');
  await mkdir(join(ear, 'ear-web'), { recursive: true }); await mkdir(join(ear, 'ear-ejb'), { recursive: true });
  await writeFile(join(ear, 'pom.xml'), '<project><modelVersion>4.0.0</modelVersion><packaging>pom</packaging><modules><module>ear-web</module><module>ear-ejb</module></modules></project>');
  await writeFile(join(ear, 'ear-web', 'pom.xml'), '<project><modelVersion>4.0.0</modelVersion><packaging>war</packaging></project>');
  await writeFile(join(ear, 'ear-ejb', 'pom.xml'), '<project><modelVersion>4.0.0</modelVersion></project>');
  git(ear, 'init', '--quiet'); git(ear, 'add', '.'); git(ear, 'commit', '--quiet', '--no-verify', '-m', 'baseline');
  await openDevelopmentWorkspace(page, root);

  const trigger = page.getByTestId('development-active-project');
  await expect(trigger).toContainText('11');
  await trigger.click();
  const search = page.getByRole('searchbox');
  await expect(search).toBeVisible();
  await search.fill('ear-web');
  const match = page.getByRole('menuitemradio', { name: /ear-web/ });
  await expect(match).toHaveCount(1);
  await expect(match).toContainText('legacy-ear');
  await expect(match).toContainText('Maven');
  await page.screenshot({ path: testInfo.outputPath('03-module-picker-search.png'), animations: 'disabled' });
  await match.click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger).toContainText('ear-web');
  await trigger.click();
  await expect(page.getByRole('menuitemradio', { name: /ear-web/ })).toHaveAttribute('aria-checked', 'true');
});
