import { expect, test } from '@/playwright/suite';
import { waitForLoadingShell } from '@/playwright/entry';
import { ensureRailOpen } from '@/playwright/rail';
import type { Page, Route } from '@playwright/test';
import { openSettingsDialog } from '../lib/playwright/amr.js';

const STORAGE_KEY = 'open-design:config';

function baseConfig(): Record<string, unknown> {
  return {
    mode: 'daemon',
    apiKey: '',
    apiProtocol: 'anthropic',
    apiVersion: '',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
    apiProviderBaseUrl: 'https://api.anthropic.com',
    agentId: 'codex',
    skillId: null,
    designSystemId: null,
    onboardingCompleted: true,
    mediaProviders: {},
    agentModels: {},
    agentCliEnv: {},
  };
}

async function seedSettingsBase(page: Page, override?: Record<string, unknown>) {
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, { key: STORAGE_KEY, value: { ...baseConfig(), ...override } });
}

async function routeBootstrapApis(
  page: Page,
  options?: {
    mediaConfigGet?: (route: Route) => Promise<void>;
    mediaConfigPut?: (route: Route) => Promise<void>;
  },
) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const path = url.pathname;

    if (path === '/api/health') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      return;
    }
    if (path === '/api/agents') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          agents: [
            {
              id: 'codex',
              name: 'Codex CLI',
              bin: 'codex',
              available: true,
              version: '0.130.0',
              models: [{ id: 'default', label: 'Default' }],
            },
          ],
        }),
      });
      return;
    }
    if (path === '/api/app-config') {
      if (method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      return;
    }
    if (path === '/api/connectors/composio/config') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"configured":false,"apiKeyTail":""}' });
      return;
    }
    if (path === '/api/media/config' && method === 'GET') {
      if (options?.mediaConfigGet) {
        await options.mediaConfigGet(route);
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"providers":{}}' });
      return;
    }
    if (path === '/api/media/config' && method === 'PUT') {
      if (options?.mediaConfigPut) {
        await options.mediaConfigPut(route);
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      return;
    }
    if (path === '/api/skills') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"skills":[]}' });
      return;
    }
    if (path === '/api/design-systems') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"designSystems":[]}' });
      return;
    }
    if (path === '/api/projects') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"projects":[]}' });
      return;
    }
    if (path === '/api/templates') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"templates":[]}' });
      return;
    }
    if (path === '/api/prompt-templates') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"promptTemplates":[]}' });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function gotoEntryHome(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForLoadingShell(page);
}

async function openMediaSettings(page: Page) {
  await gotoEntryHome(page);
  return await openMediaSettingsFromCurrentPage(page);
}

async function openMediaSettingsFromCurrentPage(page: Page) {
  const dialog = await openSettingsDialog(page);
  await dialog.getByRole('button', { name: /^Media providers$/ }).click();
  await expect(dialog.getByRole('heading', { name: 'Media providers' })).toBeVisible();
  return dialog;
}

async function openNewProjectImageModelPicker(page: Page) {
  await ensureRailOpen(page);
  await page.getByTestId('entry-nav-new-project').click();
  await expect(page.getByTestId('new-project-modal')).toBeVisible();
  await page.getByTestId('new-project-tab-media').click();
  await page.getByTestId('new-project-media-surface-image').click();
  await page.getByTestId('model-picker-trigger').click();
  return page.locator('.ds-picker-group').filter({ has: page.getByText('OpenAI', { exact: true }) });
}

/**
 * Provider keys never stay in browser storage: local storage keeps only that a key
 * is configured and its last four characters, and the key itself goes to the
 * daemon with the config write. This stands in for the daemon: a PUT stores the
 * key, a GET reports it back as configured with its tail, as the real one does.
 */
function statefulMediaDaemon() {
  const stored: Record<string, { apiKey: string; baseUrl: string }> = {};
  const writes: Array<Record<string, unknown>> = [];
  return {
    stored,
    writes,
    mediaConfigPut: async (route: Route) => {
      const payload = route.request().postDataJSON() as {
        providers?: Record<string, { apiKey?: string; baseUrl?: string }>;
      };
      writes.push(payload as Record<string, unknown>);
      for (const [id, entry] of Object.entries(payload.providers ?? {})) {
        const previous = stored[id] ?? { apiKey: '', baseUrl: '' };
        stored[id] = {
          apiKey: entry.apiKey || previous.apiKey,
          baseUrl: entry.baseUrl ?? previous.baseUrl,
        };
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    },
    mediaConfigGet: async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          providers: Object.fromEntries(
            Object.entries(stored).map(([id, entry]) => [
              id,
              {
                configured: Boolean(entry.apiKey),
                apiKeyTail: entry.apiKey.slice(-4),
                baseUrl: entry.baseUrl,
              },
            ]),
          ),
        }),
      });
    },
  };
}

test.describe('Settings media providers flows', () => {
  test('[P1] autosaves media provider edits and restores them after closing and reopening settings', async ({ page }) => {
    await seedSettingsBase(page);

    const daemon = statefulMediaDaemon();
    await routeBootstrapApis(page, daemon);

    let dialog = await openMediaSettings(page);

    await dialog.getByLabel('FishAudio API key').fill('fish-key');
    await dialog.getByLabel('FishAudio Base URL').fill('https://fish.example.com');

    await page.waitForFunction(
      ({ key }) => {
        const raw = window.localStorage.getItem(key);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        const fish = parsed.mediaProviders?.fishaudio;
        // Local storage keeps no key, only that one is configured.
        return fish?.apiKey === ''
          && fish?.apiKeyConfigured === true
          && fish?.baseUrl === 'https://fish.example.com';
      },
      { key: STORAGE_KEY },
    );

    await expect(dialog.getByText('All changes saved')).toBeVisible();
    expect(daemon.stored.fishaudio).toEqual({ apiKey: 'fish-key', baseUrl: 'https://fish.example.com' });

    await dialog.getByRole('button', { name: 'Close', exact: true }).click();

    dialog = await openMediaSettingsFromCurrentPage(page);
    await expect(dialog.getByLabel('FishAudio API key')).toHaveValue('fish-key');
    await expect(dialog.getByLabel('FishAudio Base URL')).toHaveValue('https://fish.example.com');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();

    // After a fresh load the key is gone from the browser: the field is empty and
    // says that one is saved on the daemon.
    dialog = await openMediaSettings(page);
    await expect(dialog.getByLabel('FishAudio API key')).toHaveValue('');
    await expect(dialog.getByText('Saved · ••••-key')).toBeVisible();
    await expect(dialog.getByLabel('FishAudio Base URL')).toHaveValue('https://fish.example.com');
  });

  test('[P1] reloads media provider settings from daemon after an initial load failure', async ({ page }) => {
    await seedSettingsBase(page);

    let daemonMediaStatus: 'error' | 'ok' = 'error';
    await routeBootstrapApis(page, {
      mediaConfigGet: async (route) => {
        if (daemonMediaStatus === 'error') {
          await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"daemon unavailable"}' });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            providers: {
              openai: {
                configured: true,
                apiKeyTail: '9876',
                baseUrl: 'https://daemon.example/v1',
              },
            },
          }),
        });
      },
    });

    const dialog = await openMediaSettings(page);

    await expect(
      dialog.getByText('Could not load media provider settings from the local daemon. Using browser-saved settings for now.'),
    ).toBeVisible();

    daemonMediaStatus = 'ok';
    await dialog.getByRole('button', { name: 'Reload from daemon' }).click();

    await expect(dialog.getByText('Reloaded media provider settings from the local daemon.')).toBeVisible();
    await expect(dialog.getByText('Saved · ••••9876')).toBeVisible();
    await expect(dialog.getByLabel('OpenAI Base URL')).toHaveValue('https://daemon.example/v1');
  });

  test('[P1] saved media provider config is consumed by the new-project media picker across pages', async ({ page }) => {
    await seedSettingsBase(page);
    await routeBootstrapApis(page, statefulMediaDaemon());

    const dialog = await openMediaSettings(page);
    await dialog.getByLabel('OpenAI API key').fill('sk-openai-cross-page');

    await page.waitForFunction(
      ({ key }) => {
        const raw = window.localStorage.getItem(key);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        return parsed.mediaProviders?.openai?.apiKeyConfigured === true;
      },
      { key: STORAGE_KEY },
    );
    await expect(dialog.getByText('All changes saved')).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();

    const openaiGroup = await openNewProjectImageModelPicker(page);
    await expect(openaiGroup).toContainText('Configured');
    await expect(openaiGroup).not.toContainText('Integrated');
  });
});
