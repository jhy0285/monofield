// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { HomeView } from '../../src/components/HomeView';
import { I18nProvider } from '../../src/i18n';
import { createPluginUseHandoff } from '../../src/components/home-hero/plugin-authoring';
// HomeHero's prompt input is now the same Lexical contenteditable as the
// project composer, so `home-hero-input` has no `.value`. Read its serialized
// text through the shared helper instead.
import { homeHeroPromptText } from '../helpers/home-hero-lexical';

const PLUGIN_ROW = {
  id: 'localized-plugin',
  title: 'Localized Plugin',
  version: '1.0.0',
  trust: 'trusted' as const,
  sourceKind: 'bundled' as const,
  source: '/tmp/localized',
  capabilitiesGranted: ['prompt:inject'],
  fsPath: '/tmp/localized',
  installedAt: 0,
  updatedAt: 0,
  manifest: {
    name: 'localized-plugin',
    title: 'Localized Plugin',
    version: '1.0.0',
    description: 'A localized fixture',
    od: {
      kind: 'scenario',
      taskKind: 'new-generation',
      useCase: {
        query: {
          en: 'Make a {{topic}} brief.',
          'zh-CN': '生成一份关于 {{topic}} 的简报。',
        },
      },
      inputs: [{ name: 'topic', type: 'string', default: '设计系统' }],
    },
  },
};

const APPLY_RESULT = {
  ok: true,
  query: '生成一份关于 {{topic}} 的简报。',
  contextItems: [],
  inputs: [{ name: 'topic', type: 'string', default: '设计系统' }],
  assets: [],
  mcpServers: [],
  trust: 'trusted',
  capabilitiesGranted: ['prompt:inject'],
  capabilitiesRequired: ['prompt:inject'],
  appliedPlugin: {
    snapshotId: 'snap-1',
    pluginId: 'localized-plugin',
    pluginVersion: '1.0.0',
    manifestSourceDigest: 'a'.repeat(64),
    inputs: {},
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
};

describe('HomeView plugin i18n', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it('routes an Open Work plain-Use handoff as the active driver without hydrating the query', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (typeof url === 'string' && url === '/api/plugins') {
        return new Response(JSON.stringify({ plugins: [PLUGIN_ROW] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (typeof url === 'string' && url.includes('/apply')) {
        return new Response(JSON.stringify(APPLY_RESULT), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const view = render(
      <I18nProvider initial="zh-CN">
        <div className="entry-main--scroll">
          <HomeView
            projects={[]}
            onSubmit={() => undefined}
            onOpenProject={() => undefined}
            onViewAllProjects={() => undefined}
            promptHandoff={createPluginUseHandoff(1, 'localized-plugin', { action: 'use' })}
          />
        </div>
      </I18nProvider>,
    );
    const scrollContainer = view.container.querySelector('.entry-main--scroll') as HTMLElement;
    scrollContainer.scrollTop = 240;

    // Open Work hands the selected configuration back to Home. Plain "Use"
    // routes the plugin as the active driver and applies it without copying
    // the example request into the user's draft.
    await waitFor(() => {
      expect(screen.getByTestId('home-hero-active-plugin')).toBeTruthy();
    });
    await waitFor(() => expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/apply')),
    ).toBe(true));
    // Plain `use` must NOT hydrate the query into the prompt editor, so the
    // Lexical editor stays empty (serializes to whitespace).
    await screen.findByTestId('home-hero-input');
    expect(homeHeroPromptText().trim()).toBe('');
    // Routing the plugin scrolls the Home surface back to the top.
    await waitFor(() => {
      expect(scrollContainer.scrollTop).toBe(0);
    });
  });

  // The "Use with query" affordance was an inline rich-card control. The Home
  // Template Gallery has no inline plugin actions (use goes through the detail
  // modal, which routes plain `use`), so use-with-query + its localized-query
  // hydration is now exercised by the rich-card surface (PluginsView.test.tsx)
  // and the query localization itself by state/projects.test.ts.
});
