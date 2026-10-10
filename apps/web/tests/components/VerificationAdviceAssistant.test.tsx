// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VerificationAdviceAssistant } from '../../src/components/VerificationAdviceAssistant';
import { DevelopmentVerificationPanel } from '../../src/components/DevelopmentVerificationPanel';
import { I18nProvider } from '../../src/i18n';
import type { VerificationAdvice, VerificationCheck } from '@open-design/contracts';

const check: VerificationCheck = { id: 'node:test', label: 'test', kind: 'test', command: 'npm', args: ['run', 'test'], source: 'package.json', script: 'node --test', recommended: true };
const snapshot = 'a'.repeat(64);
const advice: VerificationAdvice = { schemaVersion: 1, projectPath: '.', availableCheckIds: ['node:test'], suggestedCheckIds: ['node:test'], priorityCheckId: null,
  snapshotSha256: snapshot, source: { scope: 'git-visible-worktree', head: null, digest: 'digest', fileCount: 1, reason: null },
  reason: 'rules', manualReview: ['browser', 'keyboard', 'responsive', 'contrast'], elapsedMs: 12, evaluationAttempts: 0, usage: null, probabilities: null, relevance: null };
const props = () => ({ projectId: 'p', plan: { projectPath: '.', checks: [check] }, onApply: vi.fn(), onInvalidate: vi.fn(), onRequestReview: vi.fn() });
const show = (p = props()) => render(<I18nProvider><VerificationAdviceAssistant {...p} /></I18nProvider>);
const open = () => fireEvent.click(screen.getByRole('button', { name: /Suggest related checks/ }));
const input = () => fireEvent.change(screen.getByLabelText('Change to verify'), { target: { value: 'Fix responsive checkout UI' } });
const suggest = () => fireEvent.click(screen.getByRole('button', { name: 'Use project defaults' }));
beforeEach(() => { localStorage.setItem('open-design:locale', 'en'); vi.stubGlobal('fetch', vi.fn(async () => Response.json(advice))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('explicit verification suggestion flow', () => {
  it('does not contact a model on mount, opening or typing; applying only selects checks', async () => {
    const p = props(); show(p); open(); input(); expect(fetch).not.toHaveBeenCalled();
    suggest(); await waitFor(() => expect(screen.getByRole('button', { name: 'Add suggested checks' })).toBeTruthy());
    expect(vi.mocked(fetch).mock.calls[0]![1]).toMatchObject({ method: 'POST', body: JSON.stringify({ request: 'Fix responsive checkout UI', mode: 'rules' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Add suggested checks' }));
    expect(p.onApply).toHaveBeenCalledWith(['node:test'], snapshot); expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare browser review request' }));
    expect(p.onRequestReview.mock.calls[0]![0]).toContain('Tab, Enter and Escape');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('discards and aborts a late response after changing modules or the brief', async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const p = props(), view = show(p); open(); input(); suggest();
    const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal as AbortSignal;
    view.rerender(<I18nProvider><VerificationAdviceAssistant {...p} projectPath="other" /></I18nProvider>);
    expect(signal.aborted).toBe(true);
    finish(Response.json(advice));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add suggested checks' })).toBeNull());
    expect(p.onApply).not.toHaveBeenCalled();
  });
  it('clears applied advice when the request or source revision changes', async () => {
    const p = props(), view = show(p); open(); input(); suggest();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add suggested checks' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Add suggested checks' }));
    p.onInvalidate.mockClear();
    fireEvent.change(screen.getByLabelText('Change to verify'), { target: { value: 'A different change' } });
    expect(p.onInvalidate).toHaveBeenCalled(); expect(screen.queryByRole('button', { name: 'Add suggested checks' })).toBeNull();
    view.rerender(<I18nProvider><VerificationAdviceAssistant {...p} revisionKey="changed" /></I18nProvider>);
    expect(screen.queryByRole('button', { name: 'Add suggested checks' })).toBeNull();
  });
  it('shows model failure fallback and unknown usage honestly, and prevents applying unknown source', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ ...advice, reason: 'provider-unavailable', evaluationAttempts: 1, snapshotSha256: null }));
    show(); open(); input(); fireEvent.click(screen.getByRole('button', { name: 'Ask configured model' }));
    await waitFor(() => expect(screen.getByText('Provider token usage unavailable')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Add suggested checks' }).hasAttribute('disabled')).toBe(true);
  });
  it('shows a source conflict without offering stale advice', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ error: { message: 'Source changed' } }, { status: 409 }));
    show(); open(); input(); suggest();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Source changed'));
    expect(screen.queryByRole('button', { name: 'Add suggested checks' })).toBeNull();
  });
  it('adds recommendations without removing defaults and forwards their snapshot only on explicit run', async () => {
    const types: VerificationCheck = { ...check, id: 'node:typecheck', label: 'typecheck', kind: 'types' };
    const build: VerificationCheck = { ...check, id: 'node:build', label: 'build', kind: 'build', recommended: false };
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).includes('/plan')) return Response.json({ projectPath: '.', checks: [check, types, build] });
      if (String(url).includes('/advice')) return Response.json({ ...advice, suggestedCheckIds: ['node:build'], priorityCheckId: 'node:build', reason: 'model' });
      if (init?.method === 'POST') return Response.json({ id: 'run', state: 'running', endedAt: null, startedAt: new Date().toISOString(), steps: [], sourceBefore: advice.source });
      return Response.json({ run: null, verified: false, freshness: 'unknown', history: [] });
    });
    render(<I18nProvider><DevelopmentVerificationPanel projectId="p" /></I18nProvider>);
    fireEvent.click(screen.getByRole('button', { name: /Verify changes/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Suggest related checks/ })).toBeTruthy());
    open(); input(); suggest();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add suggested checks' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Add suggested checks' }));
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(screen.getAllByRole('checkbox').every(e => (e as HTMLInputElement).checked)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Run selected checks' }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.body === JSON.stringify({ checkIds: ['node:build', 'node:test', 'node:typecheck'], expectedAdviceSnapshotSha256: snapshot }))).toBe(true));
  });
});
