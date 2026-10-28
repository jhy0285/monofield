// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { forwardRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatPane } from '../../src/components/ChatPane';

vi.mock('../../src/i18n', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('../../src/components/ChatComposer', () => ({
  ChatComposer: forwardRef((_props, _ref) => <textarea data-testid="composer" defaultValue="" />),
}));

const KEY = 'monofield:layout:development-composer-collapsed';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

function renderCompact(props: { streaming?: boolean; error?: string | null } = {}) {
  return render(
    <ChatPane
      compact
      inlineComposer
      onExpand={vi.fn()}
      messages={[]}
      streaming={props.streaming ?? false}
      error={props.error ?? null}
      projectId="project-1"
      projectFiles={[]}
      onEnsureProject={async () => 'project-1'}
      onSend={vi.fn()}
      onStop={vi.fn()}
      conversations={[]}
      activeConversationId={null}
      onSelectConversation={vi.fn()}
      onDeleteConversation={vi.fn()}
    />,
  );
}

describe('compact chat composer toggle', () => {
  it('shows the composer by default and hides it, keeping the draft, when collapsed', () => {
    renderCompact();
    const toggle = screen.getByTestId('development-composer-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('development.dock.hideInput');

    const composer = screen.getByTestId('composer') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: 'draft survives' } });

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('development.dock.showInput');
    expect(composer.closest('.chat-composer-slot')?.parentElement?.getAttribute('data-composer-collapsed')).toBe('true');
    expect(localStorage.getItem(KEY)).toBe('1');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect((screen.getByTestId('composer') as HTMLTextAreaElement).value).toBe('draft survives');
    expect(localStorage.getItem(KEY)).toBe('0');
  });

  it('opens collapsed when that was the last choice', async () => {
    localStorage.setItem(KEY, '1');
    renderCompact();
    const toggle = await screen.findByRole('button', { name: 'development.dock.showInput' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps the run status and errors visible in the toolbar while collapsed', () => {
    renderCompact({ streaming: true, error: 'agent offline' });
    fireEvent.click(screen.getByTestId('development-composer-toggle'));
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('agent offline');
  });
});
