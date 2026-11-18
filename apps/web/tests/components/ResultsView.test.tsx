// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunCheckDetailResponse, RunCheckSummary, RunLogEntry, RunOutput, WorkIssue } from '@open-design/contracts';
import { I18nProvider } from '../../src/i18n';
import { ResultsView } from '../../src/components/results/ResultsView';
import { en } from '../../src/i18n/locales/en';
import { ko } from '../../src/i18n/locales/ko';

const navigate = vi.fn();
vi.mock('../../src/router', () => ({ navigate: (...args: unknown[]) => navigate(...args) }));

const output = (extra: Partial<RunOutput>): RunOutput => ({
  id: 'o2', runId: 'r2', runNumber: 12, issueNumber: 3, issueTitle: '주문 보고서', projectId: 'p1', projectName: '주문 시스템', conversationId: 'c1', path: 'out/report.md', name: 'report.md', format: 'document',
  version: 2, versionCount: 2, latest: true, change: 'modified', sha256: 'b'.repeat(64), size: 2048, stored: true, createdAt: 1_800_000_000_000,
  agentId: 'claude', agentName: 'Claude Code', request: '환불 절을 추가해 줘', ...extra,
});
const V2 = output({});
const V1 = output({ id: 'o1', runId: 'r1', runNumber: 11, version: 1, latest: false, change: 'created', agentId: 'codex', agentName: 'Codex CLI', request: '주문 보고서를 써 줘', sha256: 'a'.repeat(64) });
const RUN: RunLogEntry = {
  runId: 'r2', number: 12, issueNumber: 3, issueTitle: '주문 보고서', needsReply: false, projectId: 'p1', projectName: '주문 시스템', conversationId: 'c1', agentId: 'claude', agentName: 'Claude Code', model: null, request: '환불 절을 추가해 줘',
  status: 'succeeded', startedAt: 1_800_000_000_000, finishedAt: 1_800_000_060_000, outputCount: 1, check: null,
  usage: { inputTokens: 61500, outputTokens: 3900, cacheReadTokens: 52000, cacheWriteTokens: 0, totalTokens: 65400, measured: true },
};

const BREAKING: RunCheckSummary = {
  state: 'done', reason: null, message: null, shared: false, files: 2,
  api: { checked: true, level: 'breaking', counts: { breaking: 1, warning: 0, info: 0 }, endpoints: { before: 5, after: 5 } },
  touched: { api: 1, screen: 0, table: 0, class: 1 },
};
const CHECK: RunCheckDetailResponse = {
  runId: 'r2', number: 12, summary: BREAKING,
  files: [{ path: 'src/order/dto/OrderResponse.java', status: 'modified' }, { path: 'docs/report.md', status: 'added' }],
  apiChanges: [{ level: 'breaking', code: 'response-field-removed', route: 'GET /api/v1/orders/{orderId}', interfaceId: '', location: 'response', field: 'totalAmount' }],
  touched: [
    { kind: 'api', label: 'GET /api/v1/orders/{orderId}', path: 'src/order/OrderController.java', change: 'changed' },
    { kind: 'class', label: 'kr.example.order.dto.OrderResponse', path: 'src/order/dto/OrderResponse.java', change: 'changed' },
  ],
};

const issue = (extra: Partial<WorkIssue>): WorkIssue => ({
  number: 3, conversationId: 'c1', projectId: 'p1', projectName: '주문 시스템', title: '주문 보고서', status: 'done', runCount: 2, outputCount: 1,
  totalTokens: 65400, lastRun: RUN, updatedAt: 1_800_000_060_000, ...extra,
});
const ISSUES: WorkIssue[] = [
  issue({ lastRun: { ...RUN, check: BREAKING } }),
  issue({ number: 4, conversationId: 'c2', title: '환불 API도 넣을까요?', status: 'needs-reply', outputCount: 0, totalTokens: 0, lastRun: { ...RUN, runId: 'r3', number: 13, issueNumber: 4, needsReply: true, agentName: 'Codex CLI' } }),
  issue({ number: 5, conversationId: 'c3', title: '정산 배치 분석', status: 'running', outputCount: 0, totalTokens: 0, lastRun: { ...RUN, runId: 'r4', number: 14, issueNumber: 5, status: 'running', finishedAt: null } }),
];

let calls: Array<{ url: string; method: string }>;
let current: 'same' | 'changed';

beforeEach(() => {
  window.localStorage.clear();
  calls = [];
  current = 'changed';
  navigate.mockReset();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ url, method });
    const respond = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/content')) return new Response('# 주문 보고서\n', { status: 200 });
    if (url === '/api/run-log/r2/check') return respond(CHECK);
    if (url.endsWith('/restore')) { current = 'same'; return respond({ restored: V1, savedBefore: output({ id: 'o3', version: 3, change: 'before-restore', runId: null }) }); }
    if (url.startsWith('/api/run-outputs/')) {
      const picked = url.includes('o1') ? V1 : V2;
      return respond({ output: picked, versions: [V2, V1], sameRun: [], current: picked === V2 ? 'same' : current, run: RUN });
    }
    if (url.startsWith('/api/run-outputs')) {
      const outputs = url.includes('q=') ? [] : [V2];
      return respond({ outputs, total: outputs.length, facets: { projects: [{ id: 'p1', label: '주문 시스템', count: 1 }], agents: [{ id: 'claude', label: 'Claude Code', count: 1 }], formats: [{ id: 'document', label: 'document', count: 1 }] } });
    }
    if (url.startsWith('/api/run-log/issues')) return respond({ issues: ISSUES, running: 1, counts: { running: 1, 'needs-reply': 1, done: 1, failed: 0 } });
    if (url.startsWith('/api/run-log/usage')) {
      const bucket = { key: 'claude', label: 'Claude Code', runs: 1, unmeasuredRuns: 0, inputTokens: 61500, outputTokens: 3900, cacheReadTokens: 52000, cacheWriteTokens: 0, totalTokens: 65400 };
      return respond({ from: null, to: null, totals: { ...bucket, key: 'all', label: 'all', succeeded: 1, failed: 0, canceled: 0, running: 0, outputs: 1 }, byAgent: [bucket], byProject: [{ ...bucket, key: 'p1', label: '주문 시스템' }], byDay: [] });
    }
    if (url.startsWith('/api/run-log')) return respond({ runs: [RUN], total: 1 });
    return new Response('{}', { status: 404 });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderKo = () => render(<I18nProvider initial="ko"><ResultsView /></I18nProvider>);
/** The view opens on the board; the file tests start from the files tab. */
const renderFiles = () => {
  renderKo();
  fireEvent.click(screen.getByTestId('results-tab-files'));
};

describe('ResultsView', () => {
  it('lists results with the request and tool that made them, and shows versions for the picked file', async () => {
    renderFiles();
    const row = await screen.findByRole('button', { name: /report\.md/ });
    expect(row.textContent).toContain('v2/2');
    // which thread and run made it
    expect(screen.getByText('주문 시스템 · #3 · 실행 12')).toBeTruthy();
    expect(screen.getByText('환불 절을 추가해 줘')).toBeTruthy();
    expect(screen.getByText('Claude Code')).toBeTruthy();

    fireEvent.click(row);
    const detail = await screen.findByTestId('results-detail');
    await waitFor(() => expect(within(detail).getByText('프로젝트의 파일이 이 버전과 같습니다.')).toBeTruthy());
    await waitFor(() => expect(detail.querySelector('pre')?.textContent).toBe('# 주문 보고서\n'));
    // nothing to restore when the project already has this version
    expect((within(detail).getByRole('button', { name: '이 버전으로 되돌리기' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(detail).getByRole('link', { name: '내려받기' }).getAttribute('href')).toBe('/api/run-outputs/o2/content?download=1');

    fireEvent.click(within(detail).getByRole('button', { name: '프로젝트 열기' }));
    expect(navigate).toHaveBeenCalledWith({ kind: 'project', projectId: 'p1', conversationId: 'c1', fileName: null });
  });

  it('restores an older version and says what happened to the file it replaced', async () => {
    renderFiles();
    fireEvent.click(await screen.findByRole('button', { name: /report\.md/ }));
    const detail = await screen.findByTestId('results-detail');
    fireEvent.click(await within(detail).findByRole('button', { name: /^v1/ }));
    await waitFor(() => expect(within(detail).getByText('프로젝트의 파일은 지금 이 버전과 다릅니다.')).toBeTruthy());

    fireEvent.click(within(screen.getByTestId('results-detail')).getByRole('button', { name: '이 버전으로 되돌리기' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('report.md 파일을 v1 버전으로 되돌렸습니다. 바꾸기 전 파일은 v3 버전으로 보관했습니다.'));
    expect(calls.some((call) => call.url === '/api/run-outputs/o1/restore' && call.method === 'POST')).toBe(true);
  });

  it('searches by text and says so when nothing matches', async () => {
    renderFiles();
    await screen.findByRole('button', { name: /report\.md/ });
    fireEvent.change(screen.getByTestId('results-search'), { target: { value: '정산' } });
    await waitFor(() => expect(screen.getByText('조건에 맞는 결과물이 없습니다.')).toBeTruthy());
    expect(calls.some((call) => call.url.includes(`q=${encodeURIComponent('정산')}`))).toBe(true);
  });

  it('shows the work log with what the tools reported, and jumps from a request to its files', async () => {
    renderKo();
    fireEvent.click(screen.getByTestId('results-tab-runs'));
    const usage = await screen.findByTestId('results-usage');
    expect(usage.textContent).toContain('65,400');
    expect(usage.textContent).toContain('입력 61,500 · 출력 3,900');
    expect(usage.textContent).toContain('85%');
    // the status badge on the run's row (the status filter lists the same word as an option)
    expect(screen.getByRole('listitem').textContent).toContain('완료됨');

    fireEvent.click(screen.getByRole('button', { name: '결과물 1개' }));
    await waitFor(() => expect(screen.getByText('이 요청의 결과물: 환불 절을 추가해 줘')).toBeTruthy());
    expect(calls.some((call) => call.url.includes('runId=r2'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '전체 보기' }));
    await waitFor(() => expect(screen.queryByText('이 요청의 결과물: 환불 절을 추가해 줘')).toBeNull());
  });

  it('opens on the board: each thread under what it needs next, with a way to its conversation and its files', async () => {
    renderKo();
    const board = await screen.findByTestId('results-board');
    expect(within(board).getByText('지금 실행 중 1')).toBeTruthy();
    expect(within(screen.getByTestId('results-column-running')).getByText('정산 배치 분석')).toBeTruthy();
    expect(within(screen.getByTestId('results-column-needs-reply')).getByText('환불 API도 넣을까요?')).toBeTruthy();
    expect(within(screen.getByTestId('results-column-failed')).getByText('없음')).toBeTruthy();
    const done = screen.getByTestId('results-column-done');
    expect(done.textContent).toContain('#3');
    expect(done.textContent).toContain('실행 2회 · 토큰 65,400');

    fireEvent.click(within(done).getByRole('button', { name: /주문 보고서/ }));
    expect(navigate).toHaveBeenCalledWith({ kind: 'project', projectId: 'p1', conversationId: 'c1', fileName: null });

    fireEvent.click(within(done).getByRole('button', { name: '결과물 1개' }));
    await waitFor(() => expect(screen.getByText('이 요청의 결과물: #3 주문 보고서')).toBeTruthy());
    expect(calls.some((call) => call.url.includes('conversationId=c1'))).toBe(true);

    fireEvent.click(screen.getByTestId('results-new-request'));
    expect(navigate).toHaveBeenCalledWith({ kind: 'home', view: 'home' });
  });

  it('shows files as tiles and opens a larger view', async () => {
    renderFiles();
    await screen.findByRole('button', { name: /report\.md/ });
    fireEvent.click(screen.getByTestId('results-layout-grid'));
    const tile = await screen.findByRole('button', { name: /report\.md/ });
    expect(tile.textContent).toContain('MD');
    expect(tile.textContent).toContain('#3 · 실행 12');
    expect(window.localStorage.getItem('monofield:results-layout')).toBe('grid');

    fireEvent.click(tile);
    const detail = await screen.findByTestId('results-detail');
    await waitFor(() => expect(detail.querySelector('pre')?.textContent).toBe('# 주문 보고서\n'));
    fireEvent.click(within(detail).getByRole('button', { name: '크게 보기' }));
    const dialog = await screen.findByRole('dialog', { name: 'report.md' });
    expect(dialog.querySelector('pre')?.textContent).toBe('# 주문 보고서\n');
    fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows what a run changed on its card, and the detail on click', async () => {
    renderKo();
    const done = await screen.findByTestId('results-column-done');
    const badge = within(done).getByTestId('run-check-badge');
    expect(badge.textContent).toBe('API 호환성 깨짐 1');
    expect(badge.className).toMatch(/badge_breaking/);

    fireEvent.click(badge);
    const dialog = await screen.findByRole('dialog', { name: '실행 12: 바뀐 내용' });
    await waitFor(() => expect(within(dialog).getByTestId('run-check-summary').textContent).toBe('API 호환성 깨짐 1'));
    expect(dialog.textContent).toContain('이 실행이 바꾼 것만 봅니다.');
    expect(dialog.textContent).toContain('API 5 → 5개');
    const row = within(dialog).getByText('GET /api/v1/orders/{orderId}', { selector: 'td' }).closest('tr')!;
    expect(row.textContent).toContain('응답 필드 삭제');
    expect(row.textContent).toContain('totalAmount');
    expect(dialog.textContent).toContain('건드린 항목');
    expect(dialog.textContent).toContain('kr.example.order.dto.OrderResponse');
    expect(dialog.textContent).toContain('바뀐 파일 (2)');
    fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('has every label the view uses in Korean and English', () => {
    for (const key of Object.keys(ko).filter((name) => name.startsWith('results.'))) {
      expect(ko[key as keyof typeof ko], key).toBeTruthy();
      expect(en[key as keyof typeof en], key).toBeTruthy();
    }
  });
});
