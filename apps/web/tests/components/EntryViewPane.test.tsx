// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EntryViewPane } from '../../src/components/EntryViewPane';

afterEach(cleanup);

it('defers unused destinations and retains a visited draft while removing hidden controls from navigation', () => {
  const load = vi.fn();
  function Destination() {
    useEffect(() => { load(); }, []);
    const [draft, setDraft] = useState('');
    return <input aria-label="Automation draft" value={draft} onChange={(e) => setDraft(e.target.value)} />;
  }
  const view = render(<EntryViewPane name="tasks" active={false}><Destination /></EntryViewPane>);
  expect(load).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Automation draft')).toBeNull();
  view.rerender(<EntryViewPane name="tasks" active><Destination /></EntryViewPane>);
  fireEvent.change(screen.getByLabelText('Automation draft'), { target: { value: 'Daily schema check' } });
  view.rerender(<EntryViewPane name="tasks" active={false}><Destination /></EntryViewPane>);
  expect(screen.getByTestId('entry-view-tasks').hasAttribute('inert')).toBe(true);
  expect(screen.queryByRole('textbox')).toBeNull();
  view.rerender(<EntryViewPane name="tasks" active><Destination /></EntryViewPane>);
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Daily schema check');
  expect(load).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('entry-view-tasks').hasAttribute('inert')).toBe(false);
});
