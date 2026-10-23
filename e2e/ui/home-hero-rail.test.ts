import { expect, test } from '@/playwright/suite';
import type { Page } from '@playwright/test';
import { gotoEntryHome } from '@/playwright/entry';
import { APP_CONFIG_URL, routeAgents } from '@/playwright/mock-factory';
import { T } from '@/timeouts';

// The shared Home setup can spend most of T.long waiting for the first App
// compile on a fresh per-worker dev server, so leave room for the case body.
test.describe.configure({ timeout: T.xlong });

const STORAGE_KEY = 'open-design:config';

const HOME_CONFIG = {
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
};

const HOME_PLUGINS = [
  {
    id: 'example-web-prototype',
    title: 'Web Prototype',
    version: '0.1.0',
    trust: 'bundled',
    sourceKind: 'bundled',
    source: '/tmp/web-prototype',
    fsPath: '/tmp/web-prototype',
    capabilitiesGranted: ['prompt:inject'],
    installedAt: 0,
    updatedAt: 0,
    manifest: {
      name: 'example-web-prototype',
      title: 'Web Prototype',
      version: '0.1.0',
      description: 'General-purpose desktop web prototype.',
      od: {
        kind: 'scenario',
        taskKind: 'new-generation',
        useCase: {
          query:
            'Build a {{fidelity}} {{artifactKind}} for {{audience}} using {{designSystem}} from {{template}}.',
        },
        inputs: [
          { name: 'artifactKind', type: 'string', required: true, default: 'web prototype', label: 'Artifact kind' },
          { name: 'fidelity', type: 'select', required: true, options: ['wireframe', 'high-fidelity'], default: 'high-fidelity', label: 'Fidelity' },
          { name: 'audience', type: 'string', required: true, default: 'product evaluators', label: 'Audience' },
          { name: 'designSystem', type: 'string', default: 'the active project design system', label: 'Design system' },
          { name: 'template', type: 'string', default: 'the bundled web prototype seed', label: 'Template' },
        ],
      },
    },
  },
  {
    id: 'example-simple-deck',
    title: 'Simple Deck',
    version: '0.1.0',
    trust: 'bundled',
    sourceKind: 'bundled',
    source: '/tmp/simple-deck',
    fsPath: '/tmp/simple-deck',
    capabilitiesGranted: ['prompt:inject'],
    installedAt: 0,
    updatedAt: 0,
    manifest: {
      name: 'example-simple-deck',
      title: 'Simple Deck',
      version: '0.1.0',
      description: 'Single-file horizontal-swipe HTML deck.',
      od: {
        kind: 'scenario',
        taskKind: 'new-generation',
        useCase: {
          query:
            'Create a {{deckType}} for {{audience}} about {{topic}} with {{slideCount}}. Speaker notes: {{speakerNotes}}. Use {{designSystem}}.',
        },
        inputs: [
          { name: 'deckType', type: 'select', required: true, options: ['pitch deck', 'product overview', 'study deck'], default: 'pitch deck', label: 'Deck type' },
          { name: 'topic', type: 'string', required: true, default: 'quarterly review', label: 'Topic' },
          { name: 'audience', type: 'string', required: true, default: 'decision makers', label: 'Audience' },
          { name: 'slideCount', type: 'select', required: true, options: ['5-10 pages', '10-15 pages', '15-20 pages'], default: '10-15 pages', label: 'Pages' },
          { name: 'speakerNotes', type: 'select', options: ['include speaker notes', 'no speaker notes'], default: 'include speaker notes', label: 'Speaker notes' },
          { name: 'designSystem', type: 'string', default: 'the active project design system', label: 'Design system' },
        ],
      },
    },
  },
  {
    id: 'example-live-artifact',
    title: 'Live Artifact',
    version: '0.1.0',
    trust: 'bundled',
    sourceKind: 'bundled',
    source: '/tmp/live-artifact',
    fsPath: '/tmp/live-artifact',
    capabilitiesGranted: ['prompt:inject'],
    installedAt: 0,
    updatedAt: 0,
    manifest: {
      name: 'example-live-artifact',
      title: 'Live Artifact',
      version: '0.1.0',
      description: 'Create refreshable, auditable Open Design artifacts.',
      od: {
        kind: 'scenario',
        taskKind: 'new-generation',
        mode: 'prototype',
        scenario: 'live',
        useCase: {
          query:
            'Create refreshable, auditable Open Design artifacts backed by connector or local data.',
        },
      },
    },
  },
  {
    id: 'od-interface-spec',
    title: 'Interface spec',
    version: '0.1.0',
    trust: 'bundled',
    sourceKind: 'bundled',
    source: '/tmp/interface-spec',
    fsPath: '/tmp/interface-spec',
    capabilitiesGranted: ['prompt:inject'],
    installedAt: 0,
    updatedAt: 0,
    manifest: {
      name: 'od-interface-spec',
      title: 'Interface spec',
      version: '0.1.0',
      description: 'Collect API endpoints into an interface spec workbook.',
      od: {
        kind: 'scenario',
        taskKind: 'new-generation',
        useCase: {
          query: 'Document the interface spec.',
        },
        inputs: [],
      },
    },
  },
  {
    id: 'od-media-generation',
    title: 'Media generation',
    version: '0.1.0',
    trust: 'bundled',
    sourceKind: 'bundled',
    source: '/tmp/media-generation',
    fsPath: '/tmp/media-generation',
    capabilitiesGranted: ['prompt:inject'],
    installedAt: 0,
    updatedAt: 0,
    manifest: {
      name: 'od-media-generation',
      title: 'Media generation',
      version: '0.1.0',
      description: 'Create image, video, and audio assets.',
      od: {
        kind: 'scenario',
        taskKind: 'new-generation',
        useCase: {
          query: 'Create media.',
        },
        inputs: [],
      },
    },
  },
  {
    id: 'example-hyperframes',
    title: 'HyperFrames',
    version: '0.1.0',
    trust: 'bundled',
    sourceKind: 'bundled',
    source: '/tmp/example-hyperframes',
    fsPath: '/tmp/example-hyperframes',
    capabilitiesGranted: ['prompt:inject'],
    installedAt: 0,
    updatedAt: 0,
    manifest: {
      name: 'example-hyperframes',
      title: 'HyperFrames',
      version: '0.1.0',
      description: 'Create HyperFrames motion content.',
      od: {
        kind: 'scenario',
        taskKind: 'new-generation',
        useCase: {
          query: 'Create hyperframes media.',
        },
        inputs: [],
      },
    },
  },
  {
    id: 'image-template-notion-team-dashboard-live-artifact',
    title: 'Notion live artifact',
    version: '0.1.0',
    trust: 'bundled',
    sourceKind: 'bundled',
    source: '/tmp/notion-live-artifact',
    fsPath: '/tmp/notion-live-artifact',
    capabilitiesGranted: ['prompt:inject'],
    installedAt: 0,
    updatedAt: 0,
    manifest: {
      name: 'image-template-notion-team-dashboard-live-artifact',
      title: 'Notion live artifact',
      version: '0.1.0',
      description: 'Create a live Notion dashboard artifact.',
      od: {
        kind: 'scenario',
        taskKind: 'new-generation',
        mode: 'image',
        surface: 'image',
        useCase: {
          query: 'Create a refreshable Notion dashboard live artifact.',
        },
      },
    },
  },
];

const APPLY_RESPONSES: Record<string, unknown> = {
  'example-simple-deck': {
    query: 'Draft a quarterly review deck.',
    contextItems: [],
    inputs: [],
    assets: [],
    mcpServers: [],
    trust: 'trusted',
    capabilitiesGranted: ['prompt:inject'],
    capabilitiesRequired: ['prompt:inject'],
    appliedPlugin: {
      snapshotId: 'snap-simple-deck',
      pluginId: 'example-simple-deck',
      pluginVersion: '0.1.0',
      manifestSourceDigest: 'b'.repeat(64),
      inputs: { topic: 'quarterly review' },
      resolvedContext: { items: [] },
      capabilitiesGranted: ['prompt:inject'],
      capabilitiesRequired: ['prompt:inject'],
      assetsStaged: [],
      taskKind: 'new-generation',
      appliedAt: 0,
      connectorsRequired: [],
      connectorsResolved: [],
      mcpServers: [],
      status: 'fresh',
    },
    projectMetadata: {},
  },
};

// Picking a preset seeds the composer with the rendered query only when the
// query is input-templated; otherwise the plugin's curated description wins
// (see `examplePresetSeedPrompt`). The Notion fixture's query has no inputs.
const NOTION_PRESET_SEED = 'Create a live Notion dashboard artifact.';

const PROMPT_TEMPLATES = [
  {
    id: 'image-product',
    surface: 'image',
    title: 'Image product concept',
    summary: 'A polished product image prompt.',
    category: 'product',
    model: 'gpt-image-2',
    aspect: '16:9',
    source: { repo: 'open-design/image-prompts', license: 'MIT' },
  },
  {
    id: 'video-reveal',
    surface: 'video',
    title: 'Video reveal',
    summary: 'A short reveal video prompt.',
    category: 'product',
    model: 'doubao-seedance-2-0-260128',
    aspect: '16:9',
    source: { repo: 'open-design/video-prompts', license: 'MIT' },
  },
  {
    id: 'hyperframes-caption',
    surface: 'video',
    title: 'HyperFrames captions',
    summary: 'A caption-led HyperFrames prompt.',
    category: 'motion',
    model: 'hyperframes-html',
    aspect: '16:9',
    source: { repo: 'heygen-com/hyperframes', license: 'MIT' },
  },
];

async function seedBrowserConfig(page: Page, config: Record<string, unknown>) {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, JSON.stringify(value));
    },
    { key: STORAGE_KEY, value: config },
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ key, value }) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(key, JSON.stringify(value));
  }, { key: STORAGE_KEY, value: HOME_CONFIG });

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
        config: HOME_CONFIG,
      },
    });
  });

  await page.route('**/api/projects', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { projects: [] } });
      return;
    }
    await route.continue();
  });
  await page.route('**/api/prompt-templates', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ promptTemplates: PROMPT_TEMPLATES }),
    });
  });
  await page.route('**/api/plugins', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ plugins: HOME_PLUGINS }),
    });
  });
  await page.route('**/api/mcp/servers', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        servers: [
          {
            id: 'docs',
            label: 'Docs MCP',
            transport: 'stdio',
            enabled: true,
            command: 'npx',
          },
        ],
        templates: [],
      }),
    });
  });

  await page.route('**/api/plugins/*/apply', async (route) => {
    const pluginId = route.request().url().split('/api/plugins/')[1]?.split('/apply')[0];
    const body = pluginId ? APPLY_RESPONSES[pluginId] : null;
    await route.fulfill({
      status: body ? 200 : 404,
      contentType: 'application/json',
      body: JSON.stringify(body ?? { error: 'Unknown plugin apply route' }),
    });
  });
});

test('[P1] home left rail expands and collapses from the shell controls', async ({ page }) => {
  await gotoEntryHome(page);

  const shell = page.locator('.entry');
  const rail = page.locator('.entry-nav-rail');
  const expand = page.getByTestId('entry-rail-toggle');

  await expect(shell).not.toHaveClass(/entry--rail-open/);
  await expect(rail).toHaveAttribute('aria-hidden', 'true');
  await expect(expand).toHaveAttribute('aria-expanded', 'false');

  await expand.click();
  await expect(shell).toHaveClass(/entry--rail-open/);
  await expect(rail).not.toHaveAttribute('aria-hidden', 'true');
  // Home has no dedicated rail item any more: the logo is the Home
  // destination and Home itself is the pinned workspace tab.
  await expect(page.getByTestId('entry-nav-logo')).toBeVisible();
  await expect(page.getByTestId('entry-nav-projects')).toBeVisible();

  await page.getByTestId('entry-nav-collapse').click();
  await expect(shell).not.toHaveClass(/entry--rail-open/);
  await expect(rail).toHaveAttribute('aria-hidden', 'true');
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
});

test('[P1] home composer plus menu exposes attachment, connector, plugin, and MCP entries', async ({ page }) => {
  await gotoEntryHome(page);

  const input = page.getByTestId('home-hero-input');

  await page.getByTestId('home-hero-plus-trigger').click();
  await expect(page.getByTestId('composer-plus-attach')).toBeVisible();
  await expect(page.getByTestId('composer-plus-connectors')).toBeVisible();
  await expect(page.getByTestId('composer-plus-plugins')).toBeVisible();
  await expect(page.getByTestId('composer-plus-mcp')).toBeVisible();

  await page.getByTestId('composer-plus-connectors').click();
  await expect(page.getByText(/No connected connectors/i)).toBeVisible();

  await page.getByTestId('composer-plus-plugins').click();
  await page.getByRole('menuitem', { name: /Web Prototype/i }).click();
  await expect(input).toContainText(/Web Prototype/i);

  await page.getByTestId('home-hero-plus-trigger').click();
  await page.getByTestId('composer-plus-mcp').click();
  await page.getByRole('menuitem', { name: /Docs MCP/i }).click();
  await expect(input).toContainText(/Docs MCP/i);

  await page.getByTestId('home-hero-file-input').setInputFiles('../package.json');
  await expect(page.getByTestId('home-hero-staged-files')).toContainText('package.json');
});

test('[P2] home hero rail shows the current creation chips and More shortcuts', async ({ page }) => {
  await gotoEntryHome(page);

  await expect(page.getByTestId('home-hero-type-tabs')).toBeVisible();
  for (const id of ['interface-spec', 'screen-spec', 'document', 'deck']) {
    await expect(page.getByTestId(`home-hero-rail-${id}`)).toBeVisible();
  }
  const moreTemplates = page.getByTestId('home-hero-rail-more-templates');
  await expect(moreTemplates).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('home-hero-rail-prototype')).toHaveCount(0);
  await openMoreTemplates(page);
  await expect(moreTemplates).toHaveAttribute('aria-expanded', 'true');
  for (const id of ['prototype', 'live-artifact', 'image', 'video', 'hyperframes', 'audio']) {
    await expect(page.getByTestId(`home-hero-rail-${id}`)).toBeVisible();
  }
  await expect(page.getByTestId('home-hero-shortcuts-trigger')).toBeVisible();

  await page.getByTestId('home-hero-shortcuts-trigger').click();
  const menu = page.getByTestId('home-hero-shortcuts-menu');
  await expect(menu).toBeVisible();
  for (const id of ['create-plugin', 'figma', 'template']) {
    await expect(menu.getByTestId(`home-hero-rail-${id}`)).toBeVisible();
  }
});

// Per-mode footer settings (design system / ratio / resolution / duration /
// audio kind) were removed from the composer: the agent now asks for them in
// its first-turn question form, and the design-system picker is a persistent
// row under the composer for every mode. These cases keep the mode switching
// and pin that no inline settings panel comes back.
test('[P1] home hero rail switches non-media modes without inline footer settings', async ({ page }) => {
  await gotoEntryHome(page);

  await expect(page.getByTestId('home-hero-type-tabs')).toBeVisible();
  await expect(page.getByTestId('home-hero-footer-options')).toHaveCount(0);

  for (const [chipId, label] of [
    ['interface-spec', 'Interface spec'],
    ['deck', 'Slide deck'],
    ['prototype', 'Prototype'],
    ['live-artifact', 'Live artifact'],
  ] as const) {
    await expectChipSelection(page, chipId, label);
    await expect(page.getByTestId('home-hero-footer-options')).toHaveCount(0);
    await clearActiveChip(page);
  }
});

test('[P1] home hero rail switches media modes without inline footer settings', async ({ page }) => {
  await gotoEntryHome(page);

  for (const [chipId, label] of [
    ['image', 'Image'],
    ['video', 'Video'],
    ['hyperframes', 'HyperFrames'],
    ['audio', 'Audio'],
  ] as const) {
    await expectChipSelection(page, chipId, label);
    await expect(page.getByTestId('home-hero-footer-options')).toHaveCount(0);
    await clearActiveChip(page);
  }
});

test('[P1] home hero example presets update the composer input for prototype and live artifact', async ({ page }) => {
  await gotoEntryHome(page);

  const input = page.getByTestId('home-hero-input');
  await expect(input).toHaveText('');

  await openMoreTemplates(page);

  await page.getByTestId('home-hero-rail-prototype').click();
  await expect(page.getByTestId('home-hero-plugin-presets')).toBeVisible();
  await page
    .locator('[data-testid="home-hero-plugin-preset"][data-plugin-id="example-web-prototype"]')
    .click();
  await expect(input).toHaveText(
    'Build a high-fidelity web prototype for product evaluators using the active project design system from the bundled web prototype seed.',
  );

  await clearActiveChip(page);
  await openMoreTemplates(page);
  await page.getByTestId('home-hero-rail-live-artifact').click();
  await expect(page.getByTestId('home-hero-plugin-presets')).toBeVisible();
  await page
    .locator('[data-testid="home-hero-plugin-preset"][data-plugin-id="image-template-notion-team-dashboard-live-artifact"]')
    .click();
  await expect(input).toHaveText(NOTION_PRESET_SEED);
});

test('[P1] home hero deck example preset updates the composer input', async ({ page }) => {
  await gotoEntryHome(page);

  const input = page.getByTestId('home-hero-input');
  await expect(input).toHaveText('');

  await page.getByTestId('home-hero-rail-deck').click();
  await expect(page.getByTestId('home-hero-plugin-presets')).toBeVisible();
  await page
    .locator('[data-testid="home-hero-plugin-preset"][data-plugin-id="example-simple-deck"]')
    .click();
  await expect(input).toHaveText(
    'Create a pitch deck for decision makers about quarterly review with 10-15 pages. Speaker notes: include speaker notes. Use the active project design system.',
  );
});

test('[P1] home hero prompt example cards fill the composer for fallback modes', async ({ page }) => {
  await gotoEntryHome(page);

  const input = page.getByTestId('home-hero-input');
  await openMoreTemplates(page);
  await page.getByTestId('home-hero-rail-audio').click();
  await expect(page.getByTestId('home-hero-prompt-examples')).toBeVisible();
  await expect(page.getByTestId('home-hero-plugin-presets')).toHaveCount(0);

  const firstExample = page.getByTestId('home-hero-prompt-example').first();
  const exampleText = (await firstExample.textContent())?.trim();
  expect(exampleText).toBeTruthy();
  await firstExample.click();

  await expect(input).toHaveText(exampleText ?? '');
});

test('[P2] clearing the active hero chip restores the rail and clears preset chrome', async ({ page }) => {
  await gotoEntryHome(page);

  await openMoreTemplates(page);

  await expectChipSelection(page, 'prototype', 'Prototype');
  await expect(page.getByTestId('home-hero-plugin-presets')).toBeVisible();
  await expect(page.getByTestId('home-hero-template-section')).toHaveCount(0);

  await clearActiveChip(page);

  await expect(page.getByTestId('home-hero-plugin-presets')).toHaveCount(0);
  await expect(page.getByTestId('home-hero-template-trigger')).toContainText('None');
  await expect(page.getByTestId('home-hero-type-tabs')).toBeVisible();
  await openMoreTemplates(page);
  await expect(page.getByTestId('home-hero-rail-live-artifact')).toBeVisible();
});

test('[P1] after clearing one mode, selecting another example updates the composer without leaking prior mode state', async ({ page }) => {
  await gotoEntryHome(page);

  const input = page.getByTestId('home-hero-input');

  await openMoreTemplates(page);

  await page.getByTestId('home-hero-rail-prototype').click();
  await expect(page.getByTestId('home-hero-plugin-presets')).toBeVisible();
  await page
    .locator('[data-testid="home-hero-plugin-preset"][data-plugin-id="example-web-prototype"]')
    .click();
  await expect(input).toHaveText(
    'Build a high-fidelity web prototype for product evaluators using the active project design system from the bundled web prototype seed.',
  );

  await clearActiveChip(page);

  await openMoreTemplates(page);

  await expectChipSelection(page, 'live-artifact', 'Live artifact');
  await expect(page.getByTestId('home-hero-plugin-presets')).toBeVisible();
  await expect(
    page.locator('[data-testid="home-hero-plugin-preset"][data-plugin-id="example-web-prototype"]'),
  ).toHaveCount(0);
  await page
    .locator('[data-testid="home-hero-plugin-preset"][data-plugin-id="image-template-notion-team-dashboard-live-artifact"]')
    .click();
  await expect(input).toHaveText(NOTION_PRESET_SEED);
});

test('[P1] selecting another example updates the composer input', async ({ page }) => {
  await gotoEntryHome(page);

  const input = page.getByTestId('home-hero-input');

  await openMoreTemplates(page);

  await page.getByTestId('home-hero-rail-live-artifact').click();
  await expect(page.getByTestId('home-hero-plugin-presets')).toBeVisible();
  await page
    .locator('[data-testid="home-hero-plugin-preset"][data-plugin-id="image-template-notion-team-dashboard-live-artifact"]')
    .click();
  await expect(input).toHaveText(NOTION_PRESET_SEED);

  await page
    .locator('[data-testid="home-hero-plugin-preset"][data-plugin-id="example-live-artifact"]')
    .click();
  await expect(input).toHaveText('Create refreshable, auditable Open Design artifacts.');
});

// The dismissible active-type chip was replaced by the composer-footer
// Template picker: picking a rail card selects that template (the rail hides
// while one is active) and the picker's reset button returns to "None".
async function expectChipSelection(page: Page, chipId: string, label: string) {
  if (!(await page.getByTestId(`home-hero-rail-${chipId}`).count())) await openMoreTemplates(page);
  const chip = page.getByTestId(`home-hero-rail-${chipId}`);
  await expect(chip).toBeEnabled();
  await chip.click();
  await expect(page.getByTestId('home-hero-template-trigger')).toContainText(label);
  await expect(page.getByTestId('home-hero-template-reset')).toBeVisible();
}

async function clearActiveChip(page: Page) {
  await page.getByTestId('home-hero-template-reset').click();
  await expect(page.getByTestId('home-hero-template-reset')).toHaveCount(0);
  await expect(page.getByTestId('home-hero-type-tabs')).toBeVisible();
}

// The Home rail leads with the SI deliverable cards; design/media templates
// sit behind "More templates". Open it (once) before reaching for them.
async function openMoreTemplates(page: Page) {
  const toggle = page.getByTestId('home-hero-rail-more-templates');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}
