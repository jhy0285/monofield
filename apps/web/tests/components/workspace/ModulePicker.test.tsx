// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DevelopmentWorkspaceProject } from '@open-design/contracts';

import { I18nProvider } from '../../../src/i18n';
import {
  ModulePicker,
  moduleKindLabel,
  type ModuleState,
} from '../../../src/components/workspace/ModulePicker';

function module(path: string, markers: string[] = ['package.json']): DevelopmentWorkspaceProject {
  return { path, label: path.split('/').pop() ?? path, markers };
}

const FEW = [module('api-gateway', ['pom.xml']), module('portal-web'), module('batch-core', ['build.gradle'])];
const MANY = [
  ...FEW,
  ...Array.from({ length: 12 }, (_, index) => module(`svc-${String(index + 1).padStart(2, '0')}`)),
  module('legacy-ear/ear-web', ['pom.xml']),
];

const STATE_LABELS: Record<ModuleState, string> = {
  idle: 'Stopped',
  loading: 'Loading',
  starting: 'Starting',
  ready: 'Ready',
  failed: 'Failed',
};

function mount(
  projects: DevelopmentWorkspaceProject[],
  overrides: Partial<Parameters<typeof ModulePicker>[0]> = {},
) {
  const onSelect = vi.fn();
  const view = render(
    <I18nProvider>
      <ModulePicker
        projects={projects}
        activePath={projects[0]!.path}
        triggerState="idle"
        stateOf={() => 'idle'}
        stateLabel={(state) => STATE_LABELS[state]}
        menuId="modules-menu"
        onSelect={onSelect}
        {...overrides}
      />
    </I18nProvider>,
  );
  return { onSelect, ...view };
}

const trigger = () => screen.getByTestId('development-active-project');
const open = () => fireEvent.click(trigger());
const items = () => screen.getAllByRole('menuitemradio');

beforeEach(() => {
  localStorage.setItem('open-design:locale', 'en');
});
afterEach(cleanup);

describe('ModulePicker', () => {
  it('names the active module and counts the modules on the trigger', () => {
    mount(FEW);
    expect(trigger().textContent).toContain('api-gateway');
    expect(within(trigger()).getByText('3')).toBeTruthy();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('lists every module, marks the active one, and selects on click', () => {
    const { onSelect } = mount(FEW, { activePath: 'portal-web' });
    open();
    expect(items().map((item) => item.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    fireEvent.click(screen.getByRole('menuitemradio', { name: /batch-core/ }));
    expect(onSelect).toHaveBeenCalledWith('batch-core');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps the list quiet: only a module that is not stopped shows a status', () => {
    mount(FEW, {
      stateOf: (path) => (path === 'portal-web' ? 'ready' : path === 'batch-core' ? 'failed' : 'idle'),
    });
    open();
    const menu = screen.getByRole('menu');
    expect(within(menu).queryByText('Stopped')).toBeNull();
    expect(within(screen.getByRole('menuitemradio', { name: /portal-web/ })).getByText('Ready')).toBeTruthy();
    expect(within(screen.getByRole('menuitemradio', { name: /batch-core/ })).getByText('Failed')).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: /api-gateway/ }).getAttribute('data-state')).toBe('idle');
  });

  it('shows what kind of project each module is, and where a nested module lives', () => {
    mount(MANY);
    open();
    const nested = screen.getByRole('menuitemradio', { name: /ear-web/ });
    expect(nested.textContent).toContain('Maven');
    expect(nested.textContent).toContain('legacy-ear');
    const top = screen.getByRole('menuitemradio', { name: /api-gateway/ });
    expect(top.textContent).toContain('Maven');
    expect(top.textContent).not.toContain('api-gateway/');
  });

  it('offers search only when there are too many modules to scan by eye', () => {
    mount(FEW);
    open();
    expect(screen.queryByRole('searchbox')).toBeNull();
    cleanup();
    mount(MANY);
    open();
    expect(screen.getByRole('searchbox')).toBeTruthy();
  });

  it('filters by name, path and kind, and says so when nothing matches', () => {
    mount(MANY);
    open();
    const search = screen.getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'svc-0' } });
    expect(items()).toHaveLength(9);
    fireEvent.change(search, { target: { value: 'legacy' } });
    expect(items().map((item) => item.textContent)).toEqual([expect.stringContaining('ear-web')]);
    fireEvent.change(search, { target: { value: 'gradle' } });
    expect(items().map((item) => item.textContent)).toEqual([expect.stringContaining('batch-core')]);
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0);
    expect(screen.getByText('No matches')).toBeTruthy();
  });

  it('selects the first match on Enter and moves into the list with the arrow keys', () => {
    const { onSelect } = mount(MANY);
    open();
    const search = screen.getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'svc-1' } });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items()[0]);
    fireEvent.keyDown(items()[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items()[1]);
    fireEvent.keyDown(items()[1]!, { key: 'ArrowUp' });
    fireEvent.keyDown(items()[0]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(search);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('svc-10');
  });

  it('closes on Escape and on an outside press, handing focus back to the trigger', () => {
    mount(FEW);
    open();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
    open();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('does not open while a start or stop is in flight', () => {
    mount(FEW, { disabled: true });
    open();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('moduleKindLabel', () => {
  it('names the build system from the marker files', () => {
    expect(moduleKindLabel(['.git', 'pom.xml'])).toBe('Maven');
    expect(moduleKindLabel(['build.gradle.kts'])).toBe('Gradle');
    expect(moduleKindLabel(['settings.gradle'])).toBe('Gradle');
    expect(moduleKindLabel(['package.json', '.git'])).toBe('Node');
    expect(moduleKindLabel(['go.mod'])).toBe('Go');
    expect(moduleKindLabel(['Cargo.toml'])).toBe('Rust');
    expect(moduleKindLabel(['pyproject.toml'])).toBe('Python');
    expect(moduleKindLabel(['app.csproj'])).toBe('.NET');
    expect(moduleKindLabel(['index.html'])).toBe('Static');
  });

  it('has no label for a bare Git folder', () => {
    expect(moduleKindLabel(['.git'])).toBeNull();
    expect(moduleKindLabel([])).toBeNull();
  });
});
