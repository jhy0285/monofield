import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildBrowserUseRunState,
  browserAutomationSessionId,
  collectBrowserUseDiscoveryFacts,
  isBrowserUseRequested,
  renderBrowserUseUnavailablePrompt,
} from '../src/browser-use-diagnostics.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'browser-use-diagnostics-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('browser use diagnostics', () => {
  it('detects Browser Use prompts from the MonoField Browser menu', () => {
    expect(isBrowserUseRequested('hello')).toBe(false);
    expect(isBrowserUseRequested('@agent-browser\n\nBrowser tab context:')).toBe(true);
    expect(isBrowserUseRequested('Use the selected MonoField Browser tab as the bound target.')).toBe(true);
    expect(isBrowserUseRequested('MonoField browser automation session: browser_session_1234567890')).toBe(true);
    expect(browserAutomationSessionId('MonoField browser automation session: browser_session_1234567890'))
      .toBe('browser_session_1234567890');
    expect(browserAutomationSessionId('Open Agent browser automation session: legacy_session_1234567890'))
      .toBe('legacy_session_1234567890');
    expect(browserAutomationSessionId('Open Docs browser automation session: legacy_docs_session_1234'))
      .toBe('legacy_docs_session_1234');
  });

  it('returns a missing-registry snapshot without reading socket contents', () => {
    const facts = collectBrowserUseDiscoveryFacts({
      registryPath: join(tempDir, 'missing'),
      now: 1_000,
    });

    expect(facts).toMatchObject({
      registryExists: false,
      socketCount: 0,
      candidateCount: 0,
      staleCount: 0,
      currentSessionIdPresent: null,
      probeFailureCategory: 'registry-missing',
    });
  });

  it('counts socket candidates and stale entries from the registry directory', async () => {
    const fresh = join(tempDir, 'fresh-session.sock');
    const stale = join(tempDir, 'old-session.sock');
    await writeFile(fresh, '', 'utf8');
    await writeFile(stale, '', 'utf8');
    await writeFile(join(tempDir, 'note.txt'), 'not a socket', 'utf8');
    await utimes(fresh, new Date(10_000), new Date(10_000));
    await utimes(stale, new Date(1_000), new Date(1_000));

    const facts = collectBrowserUseDiscoveryFacts({
      registryPath: tempDir,
      now: 11_000,
      currentSessionId: 'fresh-session',
      staleThresholdMs: 5_000,
    });

    expect(facts).toMatchObject({
      registryExists: true,
      socketCount: 2,
      candidateCount: 2,
      staleCount: 1,
      currentSessionIdPresent: true,
      probeFailureCategory: 'not-probed',
      newestSocketAgeMs: 1_000,
      staleThresholdMs: 5_000,
    });
  });

  it('builds a typed unavailable state for Codex browser requests', () => {
    const state = buildBrowserUseRunState({
      requested: true,
      agentId: 'codex',
      diagnostics: collectBrowserUseDiscoveryFacts({
        registryPath: join(tempDir, 'missing'),
      }),
    });

    expect(state).toMatchObject({
      requested: true,
      available: false,
      reason: 'no-matching-browser-backend',
    });
  });

  it('leaves non-Codex browser requests outside this Codex-specific state', () => {
    expect(buildBrowserUseRunState({
      requested: true,
      agentId: 'amr',
      diagnostics: collectBrowserUseDiscoveryFacts({
        registryPath: join(tempDir, 'missing'),
      }),
    })).toBeNull();
  });

  it.each(['claude', 'gemini', 'opencode', 'cursor-agent', 'copilot'])(
    'marks an explicitly approved desktop session available for the %s CLI agent',
    (agentId) => {
      const state = buildBrowserUseRunState({
        requested: true,
        agentId,
        sessionId: 'browser_session_1234567890',
        diagnostics: collectBrowserUseDiscoveryFacts({ registryPath: join(tempDir, 'missing') }),
      });
      expect(state).toMatchObject({
        requested: true,
        available: true,
        sessionId: 'browser_session_1234567890',
      });
      const prompt = renderBrowserUseUnavailablePrompt(state);
      expect(prompt).toContain('browser snapshot --session browser_session_1234567890');
      expect(prompt).toContain('Do not launch another browser');
      expect(prompt).toContain('visible native pointer');
    },
  );

  it('renders a prompt guard that blocks raw Chrome fallback', () => {
    const state = buildBrowserUseRunState({
      requested: true,
      agentId: 'codex',
      diagnostics: collectBrowserUseDiscoveryFacts({
        registryPath: join(tempDir, 'missing'),
      }),
    });

    const prompt = renderBrowserUseUnavailablePrompt(state);

    expect(prompt).toContain('no-matching-browser-backend');
    expect(prompt).toContain('Do not use raw Google Chrome headless');
  });
});
