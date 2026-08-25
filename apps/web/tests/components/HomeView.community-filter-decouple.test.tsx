// @vitest-environment jsdom

// Open Work owns its discovery filters independently from the Home composer.
// Keeping the result browser on a dedicated route prevents Home's output-kind
// selection from silently rewriting what the user is exploring.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OpenWorkView } from '../../src/components/OpenWorkView';
import { I18nProvider } from '../../src/i18n';

function makeHomePlugin(id: string, mode: string) {
  return {
    id,
    title: id,
    version: '1.0.0',
    trust: 'bundled' as const,
    sourceKind: 'bundled' as const,
    source: `/tmp/${id}`,
    capabilitiesGranted: ['prompt:inject'],
    fsPath: `/tmp/${id}`,
    installedAt: 0,
    updatedAt: 0,
    manifest: {
      name: id,
      title: id,
      version: '1.0.0',
      description: `${id} fixture`,
      od: { kind: 'scenario', taskKind: 'new-generation', mode },
    },
  };
}

const PLUGINS = [
  makeHomePlugin('example-web-prototype', 'prototype'),
  makeHomePlugin('example-simple-deck', 'deck'),
];

function ariaSelected(testId: string): string | null {
  return screen.getByTestId(testId).getAttribute('aria-selected');
}

describe('OpenWorkView filter ownership', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it('boots unfiltered and lets the result browser own its category selection', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (typeof url === 'string' && url === '/api/plugins') {
        return new Response(JSON.stringify({ plugins: PLUGINS }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <I18nProvider initial="en">
        <OpenWorkView
          onUse={() => undefined}
          onManagePlugins={() => undefined}
        />
      </I18nProvider>,
    );

    // The dedicated result browser comes up unfiltered instead of inheriting
    // any output-kind state from Home.
    await waitFor(() => {
      expect(screen.getByTestId('plugins-home-pill-category-deck')).toBeTruthy();
    });
    expect(ariaSelected('plugins-home-pill-category-all')).toBe('true');
    expect(ariaSelected('plugins-home-pill-category-prototype')).toBe('false');

    // Its own filters still work locally.
    fireEvent.click(screen.getByTestId('plugins-home-pill-category-deck'));
    expect(ariaSelected('plugins-home-pill-category-deck')).toBe('true');
  });
});
