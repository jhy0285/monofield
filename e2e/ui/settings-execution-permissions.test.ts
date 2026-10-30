import { expect, test } from '@/playwright/suite';
import type { APIRequestContext, Page } from '@playwright/test';
import { openSettingsDialog } from '../lib/playwright/amr.js';

const STORAGE_KEY = 'open-design:config';

async function savedLevel(request: APIRequestContext): Promise<string> {
  const response = await request.get('/api/execution-permissions');
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { level: string }).level;
}

async function openPermissions(page: Page) {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, JSON.stringify(value));
      window.localStorage.setItem('open-design:locale', 'en');
      window.localStorage.setItem('open-design:locale-source', 'manual');
    },
    {
      key: STORAGE_KEY,
      value: {
        mode: 'daemon',
        onboardingCompleted: true,
        privacyDecisionAt: 1,
        agentId: 'codex',
        skillId: null,
        designSystemId: null,
        mediaProviders: {},
        agentModels: {},
      },
    },
  );
  await page.goto('/');
  await openSettingsDialog(page);
  await page.getByTestId('settings-nav-permissions').click();
  return page.getByTestId('execution-permissions-section');
}

test.describe('Settings → Execution permissions', () => {
  test.afterEach(async ({ request }) => {
    await request.put('/api/execution-permissions', { data: { level: 'default' } });
  });

  test('[P1] saves the level through the daemon, asks before full access and shows the header badge', async ({
    page,
    request,
  }) => {
    expect(await savedLevel(request)).toBe('default');
    const section = await openPermissions(page);
    await expect(section.locator('[data-level="default"]')).toHaveAttribute('aria-checked', 'true');

    await section.locator('[data-level="read-only"]').click();
    await expect(section.locator('[data-level="read-only"]')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => savedLevel(request)).toBe('read-only');

    await section.locator('[data-level="full"]').click();
    const confirm = page.getByTestId('execution-permissions-confirm');
    await expect(confirm).toBeVisible();
    // Escape closes the confirmation only; nothing is saved and Settings stays open.
    await page.keyboard.press('Escape');
    await expect(confirm).toBeHidden();
    await expect(section).toBeVisible();
    expect(await savedLevel(request)).toBe('read-only');

    await section.locator('[data-level="full"]').click();
    await confirm.getByRole('button', { name: 'Turn on full access' }).click();
    await expect(section.locator('[data-level="full"]')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => savedLevel(request)).toBe('full');

    await page.locator('.settings-close').click();
    const badge = page.getByTestId('execution-permission-badge');
    await expect(badge).toBeVisible();
    await badge.click();
    await expect(page.getByTestId('execution-permissions-section')).toBeVisible();
  });

  test('[P2] a level saved through the HTTP API the CLI uses shows in Settings', async ({ page, request }) => {
    const put = await request.put('/api/execution-permissions', { data: { level: 'read-only' } });
    expect(put.ok()).toBe(true);
    const section = await openPermissions(page);
    await expect(section.locator('[data-level="read-only"]')).toHaveAttribute('aria-checked', 'true');
    const bad = await request.put('/api/execution-permissions', { data: { level: 'root' } });
    expect(bad.status()).toBe(400);
  });
});
