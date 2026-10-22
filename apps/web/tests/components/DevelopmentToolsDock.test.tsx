// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../src/i18n';
import { DevelopmentToolsDock, type DevelopmentTool } from '../../src/components/workspace/DevelopmentToolsDock';

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
