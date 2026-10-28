// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsDialog } from '../../src/components/SettingsDialog';
import { DEFAULT_CONFIG } from '../../src/state/config';
import type { AgentInfo } from '../../src/types';

const AGENTS: AgentInfo[] = [
  { id: 'codex', name: 'Codex CLI', bin: 'codex', available: true },
  { id: 'gemini', name: 'Gemini CLI', bin: 'gemini', available: true },
  { id: 'opencode', name: 'OpenCode', bin: 'opencode', available: false },
];

function renderDialog(initialSection: 'execution' | 'media' = 'execution') {
  return render(
    <SettingsDialog
      initial={{ ...DEFAULT_CONFIG, agentId: 'codex' }}
      agents={AGENTS}
      daemonLive
      appVersionInfo={null}
      initialSection={initialSection}
      onPersist={vi.fn()}
      onPersistComposioKey={vi.fn()}
      onClose={vi.fn()}
      onRefreshAgents={vi.fn()}
    />,
  );
}

function navLabels(): string[] {
  const sidebar = screen.getByLabelText('Settings sections');
  return Array.from(sidebar.querySelectorAll<HTMLElement>('.settings-nav-item strong, .settings-nav-more')).map(
    (element) => element.textContent ?? '',
  );
}

beforeEach(() => {
  localStorage.setItem('open-design:locale', 'en');
});
afterEach(cleanup);

// A Korean SI team opens Settings for the agent, project locations, the
// database and dictionaries. Image, video and audio providers, the Composio
// connector gate, Critique Theater, pets and the design-system catalog come from
// the design side of the product and wait below a "More" divider. They stay one
// click away: nothing is hidden or removed.
describe('SettingsDialog navigation', () => {
  it('lists the sections the SI workflow uses above a More divider', () => {
    renderDialog();
    const labels = navLabels();
    const more = labels.indexOf('More');
    expect(more).toBeGreaterThan(0);
    const above = labels.slice(0, more).join('|');
    for (const wanted of ['Execution mode', 'Database connections', 'Dictionary library', 'Project locations', 'About']) {
      expect(above, wanted).toContain(wanted);
    }
    expect(above).not.toContain('Media providers');
  });

  it('keeps the design-side sections reachable below the divider', () => {
    renderDialog();
    const labels = navLabels();
    const below = labels.slice(labels.indexOf('More') + 1).join('|');
    expect(below).toContain('Media providers');
    fireEvent.click(screen.getByRole('button', { name: /Media providers/ }));
    expect(screen.getByLabelText('Settings sections').querySelector('.settings-nav-item.active')?.textContent).toContain('Media providers');
  });

  it('opens straight to a section below the divider when asked', () => {
    renderDialog('media');
    expect(screen.getByLabelText('Settings sections').querySelector('.settings-nav-item.active')?.textContent).toContain('Media providers');
  });
});

describe('SettingsDialog agent cards', () => {
  it('marks every adapter MonoField has not verified as a community adapter', () => {
    renderDialog();
    const gemini = screen.getByRole('button', { name: /Gemini CLI/ });
    expect(within(gemini).getByText('Community')).toBeTruthy();
    const codex = screen.getByRole('button', { name: /Codex CLI/ });
    expect(within(codex).queryByText('Community')).toBeNull();
  });

  it('marks a community adapter that is not installed yet as well', () => {
    renderDialog();
    const card = screen.getByRole('group', { name: /OpenCode/ });
    expect(within(card).getByText('Community')).toBeTruthy();
  });
});
