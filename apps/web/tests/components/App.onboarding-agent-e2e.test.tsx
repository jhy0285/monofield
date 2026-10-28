// @vitest-environment jsdom
//
// High-fidelity integration test for the onboarding -> home agent selection:
// the user picks a local coding agent during first-run onboarding, and the home
// agent picker must come back showing that agent, not the first one detected.
// Unlike the component-level EntryShell tests (which mock `onAgentChange` so it
// never updates config), this mounts the REAL `App` with the REAL router and
// REAL EntryView/onboarding UI, so the App-level config lifecycle and the
// auto-select interact exactly as in production. Only the daemon/provider
// boundary is mocked.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../src/App';
import type { AppConfig } from '../../src/types';
import { loadConfig, fetchDaemonConfig } from '../../src/state/config';
import {
  daemonIsLive,
  fetchAgentsStream,
  fetchAppVersionInfo,
  fetchDesignSystems,
  fetchDesignTemplates,
  fetchPromptTemplates,
  fetchSkills,
} from '../../src/providers/registry';
import { listProjects, listTemplates } from '../../src/state/projects';

const analyticsMocks = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock('../../src/analytics/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/analytics/provider')>();
  return {
    ...actual,
    useAnalytics: () => ({
      newRequestId: vi.fn(() => 'request-1'),
      setConfigureGlobals: vi.fn(),
      setConsent: vi.fn(),
      setIdentity: vi.fn(),
      setUserId: vi.fn(),
      track: analyticsMocks.track,
    }),
    useAppVersion: () => null,
  };
});

vi.mock('../../src/components/pet/PetOverlay', () => ({
  PetOverlay: () => null,
}));
vi.mock('../../src/components/pet/pets', () => ({
  migrateCustomPetAtlas: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/providers/registry', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/registry')>(
    '../../src/providers/registry',
  );
  return {
    ...actual,
    daemonIsLive: vi.fn(),
    fetchAgentsStream: vi.fn(),
    fetchAppVersionInfo: vi.fn(),
    fetchDesignSystems: vi.fn(),
    fetchDesignTemplates: vi.fn(),
    fetchPromptTemplates: vi.fn(),
    fetchSkills: vi.fn(),
  };
});

vi.mock('../../src/state/projects', async () => {
  const actual = await vi.importActual<typeof import('../../src/state/projects')>(
    '../../src/state/projects',
  );
  return { ...actual, listProjects: vi.fn(), listTemplates: vi.fn() };
});

// Keep the REAL mergeDaemonConfig/loadConfig logic; only stub the network
// writes and the daemon GET so we can drive a deterministic first-run.
vi.mock('../../src/state/config', async () => {
  const actual = await vi.importActual<typeof import('../../src/state/config')>(
    '../../src/state/config',
  );
  return {
    ...actual,
    fetchComposioConfigFromDaemon: vi.fn().mockResolvedValue(null),
    loadConfig: vi.fn(),
    fetchDaemonConfig: vi.fn(),
    fetchMediaProvidersFromDaemon: vi.fn().mockResolvedValue({ status: 'ok', providers: null }),
    syncComposioConfigToDaemon: vi.fn().mockResolvedValue(true),
    syncConfigToDaemon: vi.fn().mockResolvedValue(undefined),
    syncMediaProvidersToDaemon: vi.fn().mockResolvedValue(undefined),
    saveConfig: vi.fn(),
  };
});

const mockedDaemonIsLive = vi.mocked(daemonIsLive);
const mockedFetchAgentsStream = vi.mocked(fetchAgentsStream);
const mockedFetchAppVersionInfo = vi.mocked(fetchAppVersionInfo);
const mockedFetchDesignSystems = vi.mocked(fetchDesignSystems);
const mockedFetchDesignTemplates = vi.mocked(fetchDesignTemplates);
const mockedFetchPromptTemplates = vi.mocked(fetchPromptTemplates);
const mockedFetchSkills = vi.mocked(fetchSkills);
const mockedListProjects = vi.mocked(listProjects);
const mockedListTemplates = vi.mocked(listTemplates);
const mockedLoadConfig = vi.mocked(loadConfig);
const mockedFetchDaemonConfig = vi.mocked(fetchDaemonConfig);

const claudeAgent = {
  id: 'claude',
  name: 'Claude Code',
  bin: 'claude',
  available: true,
  version: '1.0.0',
  models: [{ id: 'sonnet', label: 'Sonnet' }],
};
const codexAgent = {
  id: 'codex',
  name: 'Codex CLI',
  bin: 'codex',
  available: true,
  version: '1.0.0',
  models: [{ id: 'gpt-5-codex', label: 'GPT-5 Codex' }],
};

function firstRunConfig(): AppConfig {
  return {
    mode: 'daemon',
    apiKey: '',
    apiProtocol: 'anthropic',
    apiVersion: '',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
    apiProviderBaseUrl: 'https://api.anthropic.com',
    apiProtocolConfigs: {},
    agentId: null,
    skillId: null,
    designSystemId: null,
    onboardingCompleted: false,
    privacyDecisionAt: 1,
    mediaProviders: {},
    composio: {},
    agentModels: {},
    agentCliEnv: {},
  } as AppConfig;
}

beforeEach(() => {
  // jsdom polyfills the full EntryView tree expects.
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  const win = window as unknown as Record<string, unknown>;
  win.ResizeObserver ||= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  win.IntersectionObserver ||= class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
  window.scrollTo = window.scrollTo || (() => {});
  window.history.replaceState(null, '', '/');

  mockedDaemonIsLive.mockResolvedValue(true);
  // Claude Code is detected first, Codex second: picking Codex must stick.
  mockedFetchAgentsStream.mockResolvedValue([{ ...claudeAgent }, { ...codexAgent }]);
  mockedFetchSkills.mockResolvedValue([]);
  mockedFetchDesignSystems.mockResolvedValue([]);
  mockedFetchDesignTemplates.mockResolvedValue([]);
  mockedFetchPromptTemplates.mockResolvedValue([]);
  mockedFetchAppVersionInfo.mockResolvedValue(null);
  mockedListProjects.mockResolvedValue([]);
  mockedListTemplates.mockResolvedValue([]);
  mockedLoadConfig.mockReturnValue(firstRunConfig());
  mockedFetchDaemonConfig.mockResolvedValue({});

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  analyticsMocks.track.mockReset();
});

describe('onboarding -> home agent selection (end to end)', () => {
  it('lands on the home agent picker with the agent the user chose in onboarding', async () => {
    render(<App />);

    // First run opens the Connect step with the detected local agents.
    const codexChip = await screen.findByRole('button', { name: /Codex CLI/i }, { timeout: 10000 });
    fireEvent.click(codexChip);
    await waitFor(() => expect(codexChip.getAttribute('aria-pressed')).toBe('true'));
    fireEvent.click(await screen.findByRole('button', { name: /^Continue$/i }));

    // Profile step, then the final setup screen.
    fireEvent.click(await screen.findByRole('button', { name: /^Continue$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Go to home/i }));

    // Now on home: the inline model switcher chip must reflect the choice, not
    // the first agent the probe happened to return.
    const chip = await screen.findByTestId('inline-model-switcher-chip');
    await waitFor(() => {
      expect(chip.getAttribute('aria-label') ?? '').toContain('Codex');
    });
    expect(chip.getAttribute('aria-label') ?? '').not.toContain('Claude');
  });
});
