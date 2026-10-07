// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevelopmentVerificationPanel } from '../../src/components/DevelopmentVerificationPanel';
import { I18nProvider } from '../../src/i18n';

const CHECK = { id: 'node:test', label: 'test', kind: 'test', command: 'npm', args: ['run', 'test'], source: 'package.json', script: 'node --test', recommended: true };
const run = (state = 'failed') => ({ schemaVersion: 1, id: 'receipt-1', state, startedAt: '2026-10-07T12:00:00Z', endedAt: '2026-10-07T12:00:01Z',
  projectId: 'p', projectPath: '.', timeoutMs: 120000, stableSource: true, sourceBefore: { digest: 'sha' }, sourceAfter: { digest: 'sha' }, error: null,
  steps: [{ check: CHECK, state, startedAt: '2026-10-07T12:00:00Z', endedAt: '2026-10-07T12:00:01Z', exitCode: state === 'passed' ? 0 : 1, output: 'Actual assertion: expected 42, received 41', outputTruncated: false }] });
describe('development verification user flow', () => {
  let result: Record<string, unknown>;
  beforeEach(() => {
    localStorage.setItem('open-design:locale', 'en');
    result = { run: run(), freshness: 'current', verified: false, history: [] };
    vi.stubGlobal('fetch', vi.fn(async (input: string, options?: RequestInit) => {
      if (String(input).includes('/plan')) return Response.json({ projectPath: '.', checks: [CHECK] });
      if (String(input).includes('/repair')) return Response.json({ runId: 'receipt-1', prompt: 'Fix this actual failure: npm run test' });
      if (options?.method === 'POST') return Response.json({ ...run('running'), endedAt: null });
      return Response.json(result);
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  const show = (onRequestRepair = vi.fn()) => render(<I18nProvider><DevelopmentVerificationPanel projectId="p" onRequestRepair={onRequestRepair} /></I18nProvider>);
  it('starts no discovery or commands until opened, then shows exact selectable command and real failure', async () => {
    show(); expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Verify changes/ }));
    await waitFor(() => expect(screen.getByText('Actual assertion: expected 42, received 41')).toBeTruthy());
    expect(screen.getByRole('checkbox').getAttribute('checked')).not.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Run selected checks' }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST' && init?.body === JSON.stringify({ checkIds: ['node:test'] }))).toBe(true));
  });
  it('prepares a repair draft without sending any agent request', async () => {
    const draft = vi.fn(); show(draft); fireEvent.click(screen.getByRole('button', { name: /Verify changes/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Prepare repair request' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Prepare repair request' }));
    await waitFor(() => expect(draft).toHaveBeenCalledWith('Fix this actual failure: npm run test'));
    expect(vi.mocked(fetch).mock.calls.every(([url]) => !String(url).includes('/api/runs'))).toBe(true);
  });
  it('shows stale passing commands as recheck needed and never labels them verified', async () => {
    result = { run: run('passed'), freshness: 'stale', verified: false, history: [] };
    show(); fireEvent.click(screen.getByRole('button', { name: /Verify changes/ }));
    await waitFor(() => expect(screen.getAllByText('Recheck needed').length).toBeGreaterThan(0));
    expect(screen.queryByText('Selected checks passed · current source')).toBeNull();
    expect(screen.queryByText('The source snapshot could not be confirmed. The result only describes these commands.')).toBeNull();
  });
  it('shows a current success and resets source-specific results when changing modules', async () => {
    result = { run: run('passed'), freshness: 'current', verified: true, history: [] };
    const view = show(); fireEvent.click(screen.getByRole('button', { name: /Verify changes/ }));
    await waitFor(() => expect(screen.getAllByText('Selected checks passed · current source').length).toBeGreaterThan(0));
    result = { run: null, freshness: 'unknown', verified: false, history: [] };
    view.rerender(<I18nProvider><DevelopmentVerificationPanel projectId="p" projectPath="apps/other" /></I18nProvider>);
    await waitFor(() => expect(screen.getByText('Not checked')).toBeTruthy());
    expect(screen.queryByText('Selected checks passed · current source')).toBeNull();
  });
  it('suspends a success while an agent edits and checks freshness again on completion', async () => {
    result = { run: run('passed'), freshness: 'current', verified: true, history: [] };
    const view = show(); fireEvent.click(screen.getByRole('button', { name: /Verify changes/ }));
    await waitFor(() => expect(screen.getAllByText('Selected checks passed · current source').length).toBeGreaterThan(0));
    view.rerender(<I18nProvider><DevelopmentVerificationPanel projectId="p" agentBusy /></I18nProvider>);
    expect(screen.queryByText('Selected checks passed · current source')).toBeNull();
    expect(screen.getByRole('button', { name: 'Run selected checks' }).hasAttribute('disabled')).toBe(true);
    result = { run: run('passed'), freshness: 'stale', verified: false, history: [] };
    view.rerender(<I18nProvider><DevelopmentVerificationPanel projectId="p" agentBusy={false} /></I18nProvider>);
    await waitFor(() => expect(screen.getAllByText('Recheck needed').length).toBeGreaterThan(0));
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('live=1'))).toBe(true);
  });
});
