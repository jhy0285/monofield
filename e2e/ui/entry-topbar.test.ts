import { expect, test } from '@/playwright/suite';
import { markFeatureGuidesSeen } from '@/playwright/feature-guides';
import { waitForLoadingShell } from '@/playwright/entry';
import { ensureRailOpen } from '@/playwright/rail';
import { APP_CONFIG_URL, routeAgents } from '@/playwright/mock-factory';
import type { Page } from '@playwright/test';

const STORAGE_KEY = 'open-design:config';
const LOCAL_CLI_LABEL = /Local CLI|本机 CLI|本地 CLI/i;
const OPEN_SETTINGS_LABEL = /Open settings|打开设置|開啟設定/i;

test.describe.configure({ timeout: 30_000 });

async function gotoEntryHome(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForLoadingShell(page);
  await expect(page.getByRole('button', { name: OPEN_SETTINGS_LABEL })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(
      key,
      JSON.stringify({
        mode: 'daemon',
        apiKey: '',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-5',
        agentId: 'codex',
        skillId: null,
        designSystemId: null,
        onboardingCompleted: true,
        agentModels: { codex: { model: 'default', reasoning: 'default' } },
        privacyDecisionAt: 1,
        telemetry: { metrics: false, content: false, artifactManifest: false },
      }),
    );
  }, STORAGE_KEY);
  // The init script above wipes localStorage, so mark the first-visit tours as seen again.
  await markFeatureGuidesSeen(page);

  await routeAgents(page, [
    {
      id: 'codex',
      name: 'Codex CLI',
      bin: 'codex',
      available: true,
      version: '0.80.0',
      path: '/usr/local/bin/codex',
      models: [{ id: 'default', label: 'Default' }],
    },
    {
      id: 'mock',
      name: 'Mock Agent',
      bin: 'mock-agent',
      available: true,
      version: 'test',
      models: [{ id: 'default', label: 'Default' }],
    },
  ]);

  await page.route(APP_CONFIG_URL, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      json: {
        config: {
          onboardingCompleted: true,
          agentId: 'codex',
          skillId: null,
          designSystemId: null,
          mode: 'daemon',
          agentModels: { codex: { model: 'default', reasoning: 'default' } },
          privacyDecisionAt: 1,
          telemetry: { metrics: false, content: false, artifactManifest: false },
        },
      },
    });
  });
});

test('[P2] home topbar shows the entry chips and settings button', async ({ page }) => {
  await gotoEntryHome(page);

  const topbar = page.locator('.entry-main__topbar');
  await expect(topbar).toBeVisible();

  await expect(page.getByTestId('inline-model-switcher-chip')).toBeVisible();
  await expect(page.getByTestId('entry-use-everywhere-button')).toBeVisible();
  await expect(page.getByRole('button', { name: OPEN_SETTINGS_LABEL })).toBeVisible();
});

test('[P1] home topbar execution pill reflects the selected Local CLI agent and opens the switcher', async ({ page }) => {
  await gotoEntryHome(page);

  const pill = page.getByTestId('inline-model-switcher-chip');
  await expect(pill).toContainText(LOCAL_CLI_LABEL);
  await expect(pill).toContainText(/Codex CLI/i);
  await expect(pill).toContainText(/default/i);

  await pill.click();

  const popover = page.getByTestId('inline-model-switcher-popover');
  await expect(popover).toBeVisible();
  await expect(page.getByTestId('inline-model-switcher-mode-daemon')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByTestId('inline-model-switcher-agent-codex')).toBeVisible();
  await expect(page.getByTestId('inline-model-switcher-agent-mock')).toBeVisible();
  await expect(popover.getByRole('radio', { name: /Codex CLI/i })).toBeVisible();
});

test('[P2] home topbar Use everywhere navigates to Integrations with the tab selected', async ({ page }) => {
  await gotoEntryHome(page);

  await page.getByTestId('entry-use-everywhere-button').click();
  await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();
  await expect(page.getByTestId('integrations-tab-use-everywhere')).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('[P1] home topbar settings menu opens settings and closes the execution popover', async ({ page }) => {
  await gotoEntryHome(page);

  const pill = page.getByTestId('inline-model-switcher-chip');
  const popover = page.getByTestId('inline-model-switcher-popover');

  await pill.click();
  await expect(popover).toBeVisible();

  // Settings is a menu now: the trigger opens it and "details" opens the dialog.
  await page.getByTestId('entry-settings-menu-trigger').click();
  await page.getByTestId('entry-settings-open-details').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(popover).toHaveCount(0);
});

// The rail lost its Home item and the brand logo now collapses the rail on hover, so this flow
// needs a new way back to Home before it can run again.
test.fixme('[P2] returning from another entry view via the home nav reaches the home hero', async ({ page }) => {
  await gotoEntryHome(page);

  await page.getByTestId('entry-use-everywhere-button').click();
  await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();

  await ensureRailOpen(page);
  await page.getByTestId('entry-nav-home').click();
  await expect(page.getByTestId('home-hero')).toBeVisible();
  await expect(page.getByTestId('home-hero-input')).toBeVisible();
  await expect(page.getByTestId('home-hero-type-tabs')).toBeVisible();
});
