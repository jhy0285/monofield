// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { JudgmentCheckResponse, JudgmentScorecard } from '@open-design/contracts';
import { I18nProvider } from '../../src/i18n';
import { JudgmentCheckPanel } from '../../src/components/document-spec/JudgmentCheckPanel';

const policy = (kind: 'field-label' | 'business-name') => ({ kind, backend: 'local' as const, model: 'multilingual', mode: 'observe' as const, passAt: 0.7, flagAt: 0.3, appliedAt: null, basedOnLabels: 0 });
const check: JudgmentCheckResponse = {
  ok: true, inputFile: 'docs/orders.interface-spec.json', contentSha256: 'a'.repeat(64), backend: 'local', model: 'multilingual', modelStatus: 'answered',
  policies: { 'field-label': policy('field-label'), 'business-name': policy('business-name') },
  items: [
    { id: 'field-label:POST /api/v1/orders:request:deliveryMemo', kind: 'field-label', endpoint: { method: 'POST', path: '/api/v1/orders', interfaceId: 'IF-1' },
      field: { side: 'request', path: 'deliveryMemo' }, subject: { identifier: 'deliveryMemo', koreanLabel: '' }, verdict: 'flag', source: 'rule', probability: null, reason: 'empty' },
    { id: 'field-label:POST /api/v1/orders:response:createdAt', kind: 'field-label', endpoint: { method: 'POST', path: '/api/v1/orders', interfaceId: 'IF-1' },
      field: { side: 'response', path: 'createdAt' }, subject: { identifier: 'createdAt', koreanLabel: '삭제일시' }, verdict: 'review', source: 'model', probability: 0.12, reason: 'observe' },
    { id: 'business-name:POST /api/v1/orders', kind: 'business-name', endpoint: { method: 'POST', path: '/api/v1/orders', interfaceId: 'IF-1' },
      subject: { method: 'POST', path: '/api/v1/orders', businessName: '주문 등록' }, verdict: 'pass', source: 'model', probability: 0.97, reason: 'agrees' },
  ],
  summary: { total: 3, pass: 1, review: 1, flag: 1 }, elapsedMs: 12, modelCalls: 2, advisory: true,
};
const scorecard = (suggested: boolean): JudgmentScorecard => ({ minLabelsForPolicy: 20, targetFlagPrecision: 0.8, scores: [
  { kind: 'field-label', backend: 'local', model: 'multilingual', labels: 24, answered: 24, correctItems: 14, incorrectItems: 10, auc: 0.91,
    current: { coverage: 0, accuracy: null, flagPrecision: null, flagRecall: null },
    suggested: suggested ? { passAt: 0.8, flagAt: 0.25, coverage: 0.9, accuracy: 0.92, flagPrecision: 0.9, flagRecall: 0.8 } : null, mode: 'observe' },
] });

function stub(options: { suggested?: boolean } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) });
    if (url === '/api/jev/status') return Response.json({ config: { backend: 'local', localBaseUrl: 'http://127.0.0.1:8000', model: 'multilingual' }, credentialSource: 'none', apiKeyTail: '', ready: true });
    if (url === '/api/judgments/scorecard') return Response.json(scorecard(options.suggested ?? false));
    if (url.endsWith('/judgments/check')) return Response.json(check);
    if (url === '/api/judgments/feedback') return Response.json({ ok: true });
    if (url === '/api/judgments/policy') return Response.json({ ...policy('field-label'), mode: 'active' });
    return new Response('{}', { status: 404 });
  }));
  return calls;
}

const renderPanel = (dirty = false) => render(<I18nProvider initial="ko"><JudgmentCheckPanel projectId="p1" inputFile="docs/orders.interface-spec.json" dirty={dirty} /></I18nProvider>);

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('JudgmentCheckPanel', () => {
  it('runs the check, lists suspects first and records a reviewer label with the model answer', async () => {
    const calls = stub();
    renderPanel();
    await waitFor(() => expect(screen.getByText(/판단 모델: local · multilingual/)).toBeTruthy());
    fireEvent.click(screen.getByTestId('judgment-check-run'));
    const result = await screen.findByTestId('judgment-check-result');
    expect(within(result).getByText('의심 1 · 확인 필요 1 · 통과 1')).toBeTruthy();
    // Passed items stay folded until asked for.
    expect(within(result).queryByText('주문 등록')).toBeNull();
    expect(within(result).getByText('삭제일시')).toBeTruthy();
    expect(within(result).getByText(/관찰 중: 모델 의견만 표시 · 맞을 확률 12%/)).toBeTruthy();
    // Rule items take no label; the model item does.
    fireEvent.click(within(result).getByRole('button', { name: '틀림' }));
    await waitFor(() => expect(within(result).getByText('기록됨')).toBeTruthy());
    const feedback = calls.find((c) => c.url === '/api/judgments/feedback')!;
    expect(JSON.parse(String(feedback.init!.body))).toMatchObject({ kind: 'field-label', correct: false, probability: 0.12, backend: 'local', model: 'multilingual',
      subject: { identifier: 'createdAt', koreanLabel: '삭제일시' } });
    const request = calls.find((c) => c.url.endsWith('/judgments/check'))!;
    expect(request.url).toBe('/api/projects/p1/judgments/check');
    expect(JSON.parse(String(request.init!.body))).toEqual({ inputFile: 'docs/orders.interface-spec.json', allowHosted: false });
    fireEvent.click(within(result).getByRole('button', { name: '통과 1개 보기' }));
    expect(within(result).getByText('주문 등록')).toBeTruthy();
  });

  it('keeps observe mode until the labels support a policy, then applies it on request', async () => {
    stub();
    renderPanel();
    const score = await screen.findByTestId('judgment-score-field-label');
    await waitFor(() => expect(within(score).getByText(/표시 24개/)).toBeTruthy());
    expect((within(score).getByRole('button', { name: '이 기준 적용' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup(); vi.unstubAllGlobals();

    const calls = stub({ suggested: true });
    renderPanel();
    const suggestedScore = await screen.findByTestId('judgment-score-field-label');
    await waitFor(() => expect(within(suggestedScore).getByText(/제안 기준: 통과 ≥ 80%, 의심 ≤ 25%/)).toBeTruthy());
    fireEvent.click(within(suggestedScore).getByRole('button', { name: '이 기준 적용' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/judgments/policy')).toBe(true));
    expect(JSON.parse(String(calls.find((c) => c.url === '/api/judgments/policy')!.init!.body))).toEqual({ kind: 'field-label', mode: 'active' });
  });

  it('does not run on unsaved changes', async () => {
    stub();
    renderPanel(true);
    expect((screen.getByTestId('judgment-check-run') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('저장한 뒤 실행하세요.')).toBeTruthy();
  });
});
