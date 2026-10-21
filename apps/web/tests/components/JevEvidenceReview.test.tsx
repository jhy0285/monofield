// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { JevEvidenceReview } from '../../src/components/JevEvidenceReview';
vi.mock('../../src/i18n', () => ({ useT: () => (key: string) => key }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('explicit task evidence review', () => {
  it('has no inference on mount and requires objective and evidence', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    render(<JevEvidenceReview disabled={false} configurationKey="local" />);
    expect(fetch).not.toHaveBeenCalled(); expect((screen.getByTestId('jev-review-submit') as HTMLButtonElement).disabled).toBe(true);
  });
  it('submits a selected review and invalidates its suggestion when the evidence changes', async () => {
    const fetch = vi.fn(async (_url: string, _options?: RequestInit) => Response.json({ status: 'suggestion', suggestion: 'contradicted', elapsedMs: 20, cached: false, advisory: true }));
    vi.stubGlobal('fetch', fetch); render(<JevEvidenceReview disabled={false} configurationKey="local" />);
    fireEvent.change(screen.getByLabelText('jev.reviewTask'), { target: { value: 'design' } });
    fireEvent.change(screen.getByTestId('jev-review-objective'), { target: { value: 'Keep the action visible.' } });
    fireEvent.change(screen.getByTestId('jev-review-evidence'), { target: { value: 'The action is clipped.' } });
    fireEvent.click(screen.getByTestId('jev-review-submit')); await screen.findByTestId('jev-review-result');
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/jev/review');
    fireEvent.change(screen.getByTestId('jev-review-evidence'), { target: { value: 'The action is visible.' } });
    expect(screen.queryByTestId('jev-review-result')).toBeNull();
  });
  it('aborts in-flight review when the saved provider changes', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => { signal = options.signal ?? undefined; return new Promise(() => undefined); }));
    const view = render(<JevEvidenceReview disabled={false} configurationKey="local" />);
    fireEvent.change(screen.getByTestId('jev-review-objective'), { target: { value: 'A' } });
    fireEvent.change(screen.getByTestId('jev-review-evidence'), { target: { value: 'B' } });
    fireEvent.click(screen.getByTestId('jev-review-submit'));
    await waitFor(() => expect(signal).toBeDefined());
    view.rerender(<JevEvidenceReview disabled={false} configurationKey="hosted" />);
    expect((signal as AbortSignal | undefined)?.aborted).toBe(true); expect(screen.queryByTestId('jev-review-result')).toBeNull();
  });
});
