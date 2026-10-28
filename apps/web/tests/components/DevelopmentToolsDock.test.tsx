// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../src/i18n';
import { DevelopmentToolsDock, type DevelopmentTool } from '../../src/components/workspace/DevelopmentToolsDock';

const HEIGHT_KEY = 'monofield:layout:development-dock-height';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('open-design:locale', 'en');
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
});
afterEach(cleanup);
it('defers tools until opened and preserves a draft while switching and closing the dock', () => {
  localStorage.setItem('open-design:locale', 'en');
  const mount = vi.fn();
  function Panel({ tool }: { tool: DevelopmentTool }) {
    const [draft, setDraft] = useState('');
    useEffect(() => { mount(tool); }, [tool]);
    return <input aria-label={`${tool} draft`} value={draft} onChange={event => setDraft(event.target.value)} />;
  }
  function Workspace() {
    const [active, setActive] = useState<DevelopmentTool | null>(null);
    return <DevelopmentToolsDock active={active} onSelect={setActive} renderPanel={tool => <Panel tool={tool} />} />;
  }
  render(<I18nProvider><Workspace /></I18nProvider>);
  expect(mount).not.toHaveBeenCalled();
  const changes = screen.getByTestId('development-open-changes');
  changes.focus(); fireEvent.keyDown(changes, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(screen.getByTestId('development-open-terminal'));
  expect(mount).not.toHaveBeenCalled();
  fireEvent.click(changes);
  fireEvent.change(screen.getByLabelText('changes draft'), { target: { value: 'Unsaved review' } });
  fireEvent.click(screen.getByTestId('development-open-terminal'));
  expect(screen.queryByRole('textbox', { name: 'changes draft' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Close tools' }));
  expect(screen.queryByRole('tabpanel')).toBeNull();
  fireEvent.click(changes);
  expect((screen.getByRole('textbox', { name: 'changes draft' }) as HTMLInputElement).value).toBe('Unsaved review');
  expect(mount.mock.calls.map(args => args[0])).toEqual(['changes', 'terminal']);
});

describe('dock resizing', () => {
  function renderDock(initial: DevelopmentTool | null = 'changes') {
    function Workspace() {
      const [active, setActive] = useState<DevelopmentTool | null>(initial);
      return <DevelopmentToolsDock active={active} onSelect={setActive} renderPanel={tool => <div>{tool} panel</div>} />;
    }
    render(<I18nProvider><Workspace /></I18nProvider>);
  }
  const contentHeight = () => Number.parseInt((screen.getByRole('tabpanel') as HTMLElement).style.height, 10);

  it('offers a resize handle only while a tool is open', () => {
    renderDock(null);
    expect(screen.queryByRole('separator')).toBeNull();
    fireEvent.click(screen.getByTestId('development-open-changes'));
    const handle = screen.getByRole('separator', { name: 'Resize tools panel' });
    expect(handle.getAttribute('aria-orientation')).toBe('horizontal');
    expect(handle.getAttribute('aria-valuenow')).toBe(String(contentHeight()));
  });

  it('starts at a third of the window, within 240-420px, as the dock always did', () => {
    renderDock();
    expect(contentHeight()).toBe(272);
  });

  it('grows with ArrowUp, saves the height, and restores the default with Enter', () => {
    renderDock();
    const handle = screen.getByRole('separator', { name: 'Resize tools panel' });

    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(contentHeight()).toBe(288);
    expect(localStorage.getItem(HEIGHT_KEY)).toBe('288');

    fireEvent.keyDown(handle, { key: 'ArrowDown', shiftKey: true });
    expect(contentHeight()).toBe(224);

    fireEvent.keyDown(handle, { key: 'Enter' });
    expect(contentHeight()).toBe(272);
    expect(localStorage.getItem(HEIGHT_KEY)).toBeNull();
  });

  it('keeps the dock between its minimum and 70% of the window', () => {
    renderDock();
    const handle = screen.getByRole('separator', { name: 'Resize tools panel' });

    fireEvent.keyDown(handle, { key: 'Home' });
    expect(contentHeight()).toBe(96);
    fireEvent.keyDown(handle, { key: 'End' });
    expect(contentHeight()).toBe(560);
  });

  it('opens at a saved height', async () => {
    localStorage.setItem(HEIGHT_KEY, '330');
    renderDock();
    await vi.waitFor(() => expect(contentHeight()).toBe(330));
  });

  it('leaves the expanded preset when the handle is used', () => {
    renderDock();
    fireEvent.click(screen.getByRole('button', { name: 'Expand tools' }));
    expect(contentHeight()).toBe(464);

    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize tools panel' }), { key: 'ArrowUp' });
    expect(contentHeight()).toBe(480);
    expect(screen.getByRole('button', { name: 'Expand tools' })).toBeTruthy();
  });
});
