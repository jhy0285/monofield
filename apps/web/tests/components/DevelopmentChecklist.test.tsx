// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../src/i18n';
import {
  DevelopmentChecklist,
  useDevelopmentChecklist,
  type DevelopmentChecklistItem,
} from '../../src/components/DevelopmentChecklist';
import { DevelopmentToolsDock } from '../../src/components/workspace/DevelopmentToolsDock';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('open-design:locale', 'en');
});
afterEach(cleanup);

function mount(done: DevelopmentChecklistItem[], handlers: { onAction?: (item: string) => void; onHide?: () => void } = {}) {
  return render(
    <I18nProvider>
      <DevelopmentChecklist done={done} onAction={handlers.onAction ?? (() => {})} onHide={handlers.onHide ?? (() => {})} />
    </I18nProvider>,
  );
}

describe('DevelopmentChecklist', () => {
  it('shows progress as a chip and stays closed until asked', () => {
    mount(['project']);
    const toggle = screen.getByTestId('development-checklist-toggle');
    expect(toggle.textContent).toContain('1/4');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('group', { name: 'Getting started' })).toBeNull();
  });

  it('lists the steps with a button only for those not done, and never for the project step', () => {
    const onAction = vi.fn();
    mount(['project', 'changes'], { onAction });
    fireEvent.click(screen.getByTestId('development-checklist-toggle'));
    expect(screen.getByRole('group', { name: 'Getting started' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open Changes' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Go to Run' }));
    expect(onAction).toHaveBeenCalledWith('run');
    // acting closes the popover so it does not cover the thing the person was sent to
    expect(screen.queryByRole('group', { name: 'Getting started' })).toBeNull();
  });

  it('closes on Escape and on an outside press', () => {
    mount([]);
    fireEvent.click(screen.getByTestId('development-checklist-toggle'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group')).toBeNull();
    fireEvent.click(screen.getByTestId('development-checklist-toggle'));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('marks the chip complete when every step is done and offers to hide it', () => {
    const onHide = vi.fn();
    mount(['project', 'run', 'changes', 'verify'], { onHide });
    const toggle = screen.getByTestId('development-checklist-toggle');
    expect(toggle.getAttribute('data-complete')).toBe('true');
    fireEvent.click(toggle);
    expect(screen.getByText('All steps are done.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(onHide).toHaveBeenCalledOnce();
  });
});

describe('useDevelopmentChecklist', () => {
  it('ticks steps once, keeps them per project and survives a reload', () => {
    const first = renderHook(() => useDevelopmentChecklist('project-a'));
    act(() => { first.result.current.mark('run'); first.result.current.mark('run'); });
    expect(first.result.current.done).toEqual(['run']);
    first.unmount();
    const again = renderHook(() => useDevelopmentChecklist('project-a'));
    expect(again.result.current.done).toEqual(['run']);
    const other = renderHook(() => useDevelopmentChecklist('project-b'));
    expect(other.result.current.done).toEqual([]);
  });

  it('remembers a hidden list and ignores unknown stored steps', () => {
    localStorage.setItem('monofield:development-checklist:v1:project-a', JSON.stringify({ done: ['run', 'bogus'], hidden: false }));
    const { result } = renderHook(() => useDevelopmentChecklist('project-a'));
    expect(result.current.done).toEqual(['run']);
    act(() => result.current.hide());
    expect(result.current.hidden).toBe(true);
    expect(JSON.parse(localStorage.getItem('monofield:development-checklist:v1:project-a') ?? '{}')).toEqual({ done: ['run'], hidden: true });
  });

  it('reloads when the project changes and does nothing without a project', () => {
    localStorage.setItem('monofield:development-checklist:v1:project-b', JSON.stringify({ done: ['verify'], hidden: true }));
    const { result, rerender } = renderHook(({ id }: { id: string | null }) => useDevelopmentChecklist(id), { initialProps: { id: 'project-a' as string | null } });
    expect(result.current.done).toEqual([]);
    rerender({ id: 'project-b' });
    expect(result.current.done).toEqual(['verify']);
    expect(result.current.hidden).toBe(true);
    rerender({ id: null });
    act(() => result.current.mark('run'));
    expect(localStorage.getItem('monofield:development-checklist:null')).toBeNull();
  });

  it('starts over instead of throwing when storage holds garbage', () => {
    localStorage.setItem('monofield:development-checklist:v1:project-a', '{not json');
    const { result } = renderHook(() => useDevelopmentChecklist('project-a'));
    expect(result.current.done).toEqual([]);
    expect(result.current.hidden).toBe(false);
  });
});

describe('DevelopmentToolsDock trailing slot', () => {
  it('renders the checklist chip in the toolbar even when no tool is open', () => {
    render(
      <I18nProvider>
        <DevelopmentToolsDock active={null} onSelect={() => {}} renderPanel={() => null}
          trailing={<span data-testid="trailing">chip</span>} />
      </I18nProvider>,
    );
    expect(screen.getByTestId('trailing')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close tools' })).toBeNull();
  });
});
