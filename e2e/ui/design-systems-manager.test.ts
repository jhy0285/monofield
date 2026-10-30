import { expect, test } from '@/playwright/suite';
import { gotoEntryHome } from '@/playwright/entry';
import { ensureRailOpen } from '@/playwright/rail';
import type { Page } from '@playwright/test';

const STORAGE_KEY = 'open-design:config';

type UserSystem = {
  id: string;
  title: string;
  category: string;
  summary: string;
  surface: 'web' | 'image' | 'video' | 'audio';
  source: 'user';
  status: 'draft' | 'published';
  updatedAt: string;
};

function requireSystem(system: UserSystem | undefined): UserSystem {
  if (!system) throw new Error('design system fixture missing');
  return system;
}

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
    privacyDecisionAt: 1,
    mediaProviders: {},
    agentModels: {},
    agentCliEnv: {},
  };
}

async function seedEntryBase(page: Page, override?: Record<string, unknown>) {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, JSON.stringify(value));
    },
    { key: STORAGE_KEY, value: { ...baseConfig(), ...override } },
  );
}

async function routeDesignSystemsManager(
  page: Page,
  systems: UserSystem[],
  {
    initialConfig,
  }: {
    initialConfig?: Partial<Record<string, unknown>>;
  } = {},
) {
  const persistedConfigs: Array<{ designSystemId?: string | null }> = [];
  let currentConfig = { ...baseConfig(), ...(initialConfig ?? {}) };

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
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ config: currentConfig }),
        });
        return;
      }
      if (method === 'PUT') {
        const body = route.request().postDataJSON() as { designSystemId?: string | null };
        persistedConfigs.push(body);
        currentConfig = { ...currentConfig, ...body };
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
        return;
      }
    }
    if (path === '/api/connectors/composio/config') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"configured":false,"apiKeyTail":""}',
      });
      return;
    }
    if (path === '/api/media/config' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"providers":{}}' });
      return;
    }
    if (path === '/api/media/config' && method === 'PUT') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      return;
    }
    if (path === '/api/skills') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"skills":[]}' });
      return;
    }
    if (path === '/api/design-systems' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ designSystems: systems }),
      });
      return;
    }
    if (/^\/api\/design-systems\/[^/]+$/.test(path) && method === 'PATCH') {
      const id = decodeURIComponent(path.split('/').at(-1) ?? '');
      const body = route.request().postDataJSON() as { status?: 'draft' | 'published' };
      const system = systems.find((entry) => entry.id === id);
      if (system && body.status) {
        system.status = body.status;
      }
      const responseSystem = requireSystem(system ?? systems[0]);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          designSystem: {
            ...responseSystem,
            body: `# ${responseSystem.title}`,
          },
        }),
      });
      return;
    }
    if (/^\/api\/design-systems\/[^/]+$/.test(path) && method === 'DELETE') {
      const id = decodeURIComponent(path.split('/').at(-1) ?? '');
      const index = systems.findIndex((entry) => entry.id === id);
      if (index >= 0) systems.splice(index, 1);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"ok":true}',
      });
      return;
    }
    if (/^\/api\/design-systems\/[^/]+$/.test(path) && method === 'GET') {
      const id = decodeURIComponent(path.split('/').at(-1) ?? '');
      const system = requireSystem(systems.find((entry) => entry.id === id) ?? systems[0]);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          designSystem: {
            ...system,
            body: `# ${system.title}`,
          },
        }),
      });
      return;
    }
    if (path === '/api/projects') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"projects":[]}' });
      return;
    }
    if (path === '/api/plugins') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"plugins":[]}' });
      return;
    }
    if (path === '/api/prompt-templates') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"promptTemplates":[]}' });
      return;
    }
    if (path === '/api/templates') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"templates":[]}' });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  return { persistedConfigs };
}

test('[P1] publishing a user design system promotes it to the default system in the manager', async ({ page }) => {
  await seedEntryBase(page);
  const systems: UserSystem[] = [
    {
      id: 'brand-alpha',
      title: 'Brand Alpha',
      category: 'Productivity & SaaS',
      summary: 'Draft internal design system.',
      surface: 'web',
      source: 'user',
      status: 'draft',
      updatedAt: '2026-05-28T01:00:00.000Z',
    },
    {
      id: 'brand-beta',
      title: 'Brand Beta',
      category: 'Productivity & SaaS',
      summary: 'Published baseline system.',
      surface: 'web',
      source: 'user',
      status: 'published',
      updatedAt: '2026-05-28T00:00:00.000Z',
    },
  ];
  const { persistedConfigs } = await routeDesignSystemsManager(page, systems);

  await gotoEntryHome(page);
  await ensureRailOpen(page);
  await page.getByTestId('entry-nav-design-systems').click();
  await expect(page).toHaveURL(/\/design-systems$/);
  await page.getByRole('tab', { name: 'Your systems' }).click();

  // The manager is a list with a detail panel: pick Brand Alpha to act on it.
  const alphaCard = page.getByTestId('design-system-card-brand-alpha');
  await alphaCard.click();
  const detail = page.getByTestId('design-system-detail-brand-alpha');
  const statusToggle = detail.getByRole('button', { name: 'Draft' });
  await expect(statusToggle).toHaveAttribute('aria-pressed', 'false');

  // A draft cannot be the default, so the menu offers no such action yet.
  await detail.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Default for new chats' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await statusToggle.click();
  await expect(detail.getByRole('button', { name: 'Published' })).toHaveAttribute('aria-pressed', 'true');
  await expect(alphaCard.getByText('Chat default')).toBeVisible();
  await expect
    .poll(() => persistedConfigs.at(-1)?.designSystemId)
    .toBe('brand-alpha');
});

test('[P1] shows each user design system with its status and narrows the list by search', async ({ page }) => {
  await seedEntryBase(page);
  const systems: UserSystem[] = [
    {
      id: 'brand-alpha',
      title: 'Brand Alpha',
      category: 'Productivity & SaaS',
      summary: 'Draft internal design system.',
      surface: 'web',
      source: 'user',
      status: 'draft',
      updatedAt: '2026-05-28T01:00:00.000Z',
    },
    {
      id: 'brand-beta',
      title: 'Brand Beta',
      category: 'Productivity & SaaS',
      summary: 'Published baseline system.',
      surface: 'web',
      source: 'user',
      status: 'published',
      updatedAt: '2026-05-28T00:00:00.000Z',
    },
  ];
  await routeDesignSystemsManager(page, systems);

  await gotoEntryHome(page);
  await ensureRailOpen(page);
  await page.getByTestId('entry-nav-design-systems').click();
  await expect(page).toHaveURL(/\/design-systems$/);
  await page.getByRole('tab', { name: 'Your systems' }).click();

  // Every row carries its status, and the search box narrows the list.
  const alphaCard = page.getByTestId('design-system-card-brand-alpha');
  const betaCard = page.getByTestId('design-system-card-brand-beta');
  await expect(alphaCard.getByLabel('Draft')).toBeVisible();
  await expect(betaCard.getByLabel('Published')).toBeVisible();

  const search = page.getByTestId('design-systems-search');
  await search.fill('beta');
  await expect(betaCard).toBeVisible();
  await expect(alphaCard).toHaveCount(0);

  await search.fill('alpha');
  await expect(alphaCard).toBeVisible();
  await expect(betaCard).toHaveCount(0);
});

test('[P1] deleting the active design system falls back to another user system', async ({ page }) => {
  await seedEntryBase(page, { designSystemId: 'brand-alpha' });
  const systems: UserSystem[] = [
    {
      id: 'brand-alpha',
      title: 'Brand Alpha',
      category: 'Productivity & SaaS',
      summary: 'Primary published system.',
      surface: 'web',
      source: 'user',
      status: 'published',
      updatedAt: '2026-05-28T01:00:00.000Z',
    },
    {
      id: 'brand-beta',
      title: 'Brand Beta',
      category: 'Productivity & SaaS',
      summary: 'Fallback published system.',
      surface: 'web',
      source: 'user',
      status: 'published',
      updatedAt: '2026-05-28T00:00:00.000Z',
    },
  ];
  const { persistedConfigs } = await routeDesignSystemsManager(page, systems, {
    initialConfig: { designSystemId: 'brand-alpha' },
  });

  await gotoEntryHome(page);
  await ensureRailOpen(page);
  await page.getByTestId('entry-nav-design-systems').click();
  await expect(page).toHaveURL(/\/design-systems$/);
  await page.getByRole('tab', { name: 'Your systems' }).click();

  page.once('dialog', (dialog) => dialog.accept());

  const alphaCard = page.getByTestId('design-system-card-brand-alpha');
  const betaCard = page.getByTestId('design-system-card-brand-beta');
  await alphaCard.click();
  const detail = page.getByTestId('design-system-detail-brand-alpha');
  await detail.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete Brand Alpha' }).click();

  await expect(alphaCard).toHaveCount(0);
  await expect
    .poll(() => persistedConfigs.at(-1)?.designSystemId)
    .toBe('brand-beta');
  await expect(betaCard.getByText('Chat default')).toBeVisible();
});
