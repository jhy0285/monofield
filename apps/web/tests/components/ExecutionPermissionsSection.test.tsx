// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ExecutionPermissionLevel, ExecutionPermissionsResponse } from '@open-design/contracts';
import { resolveExecutionPermissions } from '@open-design/contracts';
import { installMockOpenDesignHost } from '@open-design/host/testing';
import { ExecutionPermissionsSection } from '../../src/components/ExecutionPermissionsSection';
import { ExecutionPermissionBadge } from '../../src/components/ExecutionPermissionBadge';

function permissions(
  level: ExecutionPermissionLevel,
  { platform = 'win32', elevated = false as boolean | null } = {},
): ExecutionPermissionsResponse {
  return {
    level,
    effective: resolveExecutionPermissions(level, { platform }),
    codexSandboxLockedByEnv: false,
    elevated: platform === 'win32' ? elevated : null,
    platform,
  };
}

type FetchCall = [string, RequestInit | undefined];

function stubDaemon(initial: ExecutionPermissionsResponse, options: { elevatedAfterSave?: boolean | null } = {}) {
  let current = initial;
  const calls: FetchCall[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    if (init?.method === 'PUT') {
      const { level } = JSON.parse(String(init.body)) as { level: ExecutionPermissionLevel };
      current = permissions(level, {
        platform: current.platform,
        elevated: options.elevatedAfterSave === undefined ? current.elevated : options.elevatedAfterSave,
      });
    }
    return Response.json(current);
  }));
  return calls;
}

let restoreHost: (() => void) | null = null;

function setHostElevation(relaunch: () => Promise<{ ok: true } | { ok: false; reason: string }>) {
  const relaunchAsAdministrator = vi.fn(relaunch);
  restoreHost = installMockOpenDesignHost({
    host: { client: { type: 'desktop', platform: 'win32' }, elevation: { relaunchAsAdministrator } },
  });
  return relaunchAsAdministrator;
}

beforeEach(() => {
  localStorage.setItem('open-design:locale', 'en');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  restoreHost?.();
  restoreHost = null;
});

describe('Settings → Execution permissions', () => {
  it('shows the three levels with the saved one checked and what each means per tool', async () => {
    stubDaemon(permissions('default'));
    render(<ExecutionPermissionsSection />);
    const group = await screen.findByRole('radiogroup', { name: 'Execution permission level' });
    await waitFor(() => expect(within(group).getByRole('radio', { name: /Default/ }).getAttribute('aria-checked')).toBe('true'));
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('data-level'))).toEqual(['read-only', 'default', 'full']);
    expect(within(radios[0]!).getByText('Claude Code: plans only')).toBeTruthy();
    expect(within(radios[1]!).getByText('Codex: writes in the working folder, network on')).toBeTruthy();
    expect(within(radios[1]!).getByText('Recommended')).toBeTruthy();
    expect(within(radios[2]!).getByText('Administrator: yes (Windows)')).toBeTruthy();
  });

  it('saves a narrower level straight away', async () => {
    const calls = stubDaemon(permissions('default'));
    render(<ExecutionPermissionsSection />);
    const readOnly = await screen.findByRole('radio', { name: /Read only/ });
    await waitFor(() => expect((readOnly as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(readOnly);
    await waitFor(() => expect(readOnly.getAttribute('aria-checked')).toBe('true'));
    const put = calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ level: 'read-only' });
    expect(screen.getByRole('status').textContent).toContain('Applies from the next run');
  });

  it('asks before full access, and cancelling changes nothing', async () => {
    const calls = stubDaemon(permissions('default'));
    render(<ExecutionPermissionsSection />);
    const full = await screen.findByRole('radio', { name: /Full access/ });
    await waitFor(() => expect((full as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(full);
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Turn on full access?')).toBeTruthy();
    expect(within(dialog).getByText(/UAC/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    // Escape closes only the confirmation, never the Settings dialog behind it.
    const settingsEscape = vi.fn();
    document.addEventListener('keydown', settingsEscape);
    fireEvent.click(full);
    fireEvent.keyDown(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(settingsEscape).not.toHaveBeenCalled();
    document.removeEventListener('keydown', settingsEscape);
    expect(calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
    expect(full.getAttribute('aria-checked')).toBe('false');
  });

  it('turns on full access and restarts the Windows desktop as administrator', async () => {
    const relaunch = setHostElevation(async () => ({ ok: true }));
    const calls = stubDaemon(permissions('default'), { elevatedAfterSave: false });
    render(<ExecutionPermissionsSection />);
    const full = await screen.findByRole('radio', { name: /Full access/ });
    await waitFor(() => expect((full as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(full);
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Turn on and restart' }));
    await waitFor(() => expect(relaunch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(calls.find(([, init]) => init?.method === 'PUT')?.[1]?.body))).toEqual({ level: 'full' });
  });

  it('keeps normal rights and says so when UAC is declined, with a retry button', async () => {
    setHostElevation(async () => ({ ok: false, reason: 'declined' }));
    stubDaemon(permissions('full', { elevated: false }));
    render(<ExecutionPermissionsSection />);
    expect(await screen.findByText('MonoField is running with normal rights.')).toBeTruthy();
    const retry = screen.getByRole('button', { name: 'Restart as administrator' });
    fireEvent.click(retry);
    expect(await screen.findByText(/Windows confirmation was cancelled/)).toBeTruthy();
    expect(screen.getByText(/files cannot be dragged in from Explorer/)).toBeTruthy();
  });

  it('explains that leaving full access drops administrator rights only after reopening', async () => {
    stubDaemon(permissions('default', { elevated: true }));
    render(<ExecutionPermissionsSection />);
    expect(await screen.findByText('MonoField is running as administrator.')).toBeTruthy();
    expect(screen.getByText(/end when you close MonoField and open it again/)).toBeTruthy();
  });

  it('shows no administrator state where it does not apply', async () => {
    stubDaemon(permissions('full', { platform: 'darwin' }));
    render(<ExecutionPermissionsSection />);
    expect(await screen.findByText(/applies on Windows only/)).toBeTruthy();
    expect(screen.queryByText(/running with normal rights/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restart as administrator' })).toBeNull();
  });

  it('notes the OD_CODEX_SANDBOX lock', async () => {
    stubDaemon({ ...permissions('default', { platform: 'linux' }), codexSandboxLockedByEnv: true });
    render(<ExecutionPermissionsSection />);
    expect(await screen.findByText(/OD_CODEX_SANDBOX=danger-full-access/)).toBeTruthy();
  });

  it('moves between levels with the arrow keys like a radio group', async () => {
    const calls = stubDaemon(permissions('default'));
    render(<ExecutionPermissionsSection />);
    const defaultLevel = await screen.findByRole('radio', { name: /Default/ });
    await waitFor(() => expect(defaultLevel.getAttribute('tabindex')).toBe('0'));
    fireEvent.keyDown(defaultLevel, { key: 'ArrowLeft' });
    await waitFor(() => expect(screen.getByRole('radio', { name: /Read only/ }).getAttribute('aria-checked')).toBe('true'));
    expect(calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
  });
});

describe('Full access badge', () => {
  it('appears only at the full level and opens the section', async () => {
    stubDaemon(permissions('full'));
    const onOpen = vi.fn();
    render(<ExecutionPermissionBadge onOpen={onOpen} />);
    fireEvent.click(await screen.findByTestId('execution-permission-badge'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('stays hidden at the default level', async () => {
    const calls = stubDaemon(permissions('default'));
    render(<ExecutionPermissionBadge onOpen={vi.fn()} />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(screen.queryByTestId('execution-permission-badge')).toBeNull();
  });
});
