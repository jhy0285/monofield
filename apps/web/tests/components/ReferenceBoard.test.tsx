// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReferenceFlowSummary, ReferenceItem } from '@open-design/contracts';
import { I18nProvider } from '../../src/i18n';
import { ReferenceBoard } from '../../src/components/references/ReferenceBoard';
import { ReferenceCaptureDialog } from '../../src/components/references/ReferenceCaptureDialog';

vi.mock('../../src/providers/registry', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/registry')>('../../src/providers/registry');
  return { ...actual, fetchProjectFiles: vi.fn(async () => [{ name: 'src/pages/Join.tsx' }, { name: 'references/board.json' }]) };
});

const ITEM: ReferenceItem = {
  id: 'ref-1', url: 'https://forms.example/join', title: 'Join flow', note: '두 단계 가입', takes: ['flow', 'fields'],
  screenshot: { file: 'references/ref-1.png', sha256: 'a'.repeat(64), bytes: 10, mediaType: 'image/png' }, outline: null,
  capturedAt: '2026-11-06T00:00:00.000Z', source: 'browser',
};

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let items: ReferenceItem[];

function installFetch(apply: Record<string, unknown> = { block: '<reference-board-apply references="1">\n</reference-board-apply>', references: ['ref-1'], screenshots: [{ file: 'references/ref-1.png', state: 'verified' }] }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const respond = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/references') && method === 'GET') return respond(200, { folder: 'references', items });
    if (url.endsWith('/references') && method === 'POST') return respond(201, { item: { ...ITEM, id: 'ref-new', ...body, screenshot: null } });
    if (url.endsWith('/references/apply')) return respond(200, apply);
    if (method === 'DELETE') { items = items.filter((item) => !url.endsWith(item.id)); return respond(200, { removed: 'ref-1', files: [] }); }
    if (method === 'PATCH') return respond(200, { item: { ...ITEM, ...body } });
    return respond(404, { error: { message: 'no' } });
  }));
}

const renderKo = (node: React.ReactNode) => render(<I18nProvider initial="ko">{node}</I18nProvider>);

beforeEach(() => { calls = []; items = [ITEM]; window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('ReferenceBoard', () => {
  it('lists kept references and puts the selected ones into the chat composer', async () => {
    installFetch();
    const onAppendToChat = vi.fn();
    const onNavigate = vi.fn();
    const { container } = renderKo(<ReferenceBoard projectId="p1" onNavigate={onNavigate} onAppendToChat={onAppendToChat} />);
    expect(await screen.findByText('Join flow')).toBeTruthy();
    expect(screen.getByText('forms.example')).toBeTruthy();
    expect(screen.getByText('두 단계 가입')).toBeTruthy();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/projects/p1/raw/references/ref-1.png');
    const apply = screen.getByTestId('reference-board-apply') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('선택'));
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);
    fireEvent.change(screen.getByPlaceholderText(/파일 경로나 화면 이름/), { target: { value: 'src/pages/Join.tsx' } });
    fireEvent.change(screen.getByPlaceholderText(/회원가입 화면을/), { target: { value: '가입을 두 단계로' } });
    // The project's own files are offered as targets, not the board's.
    await waitFor(() => expect([...container.querySelectorAll('datalist option')].map((option) => option.getAttribute('value'))).toEqual(['src/pages/Join.tsx']));
    fireEvent.click(screen.getByTestId('reference-apply-submit'));
    await waitFor(() => expect(onAppendToChat).toHaveBeenCalledTimes(1));
    expect(onAppendToChat.mock.calls[0]![0]).toContain('<reference-board-apply');
    expect(onAppendToChat.mock.calls[0]![1]).toBe('아래 레퍼런스의 패턴을 이 프로젝트에 적용해 주세요.');
    expect(calls.find((call) => call.url.endsWith('/apply'))?.body).toEqual({
      referenceIds: ['ref-1'], target: 'src/pages/Join.tsx', request: '가입을 두 단계로', takes: ['flow', 'fields'], includeScreenshot: true,
    });
    expect(await screen.findByRole('status')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: '열기' })[0]!);
    expect(onNavigate).toHaveBeenCalledWith('https://forms.example/join');
  });

  it('copies the block when there is no composer and warns about a changed screenshot', async () => {
    installFetch({ block: 'BLOCK', references: ['ref-1'], screenshots: [{ file: 'references/ref-1.png', state: 'changed' }] });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderKo(<ReferenceBoard projectId="p1" onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText('선택'));
    fireEvent.click(screen.getByTestId('reference-board-apply'));
    fireEvent.click(screen.getByTestId('reference-apply-submit'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('BLOCK'));
    expect((await screen.findByRole('status')).textContent).toContain('references/ref-1.png');
  });

  it('edits a note, deletes after confirmation and shows the empty state', async () => {
    installFetch();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderKo(<ReferenceBoard projectId="p1" onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '메모 수정' }));
    fireEvent.change(screen.getByLabelText('메모'), { target: { value: '버튼 위치' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('버튼 위치')).toBeTruthy();
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ note: '버튼 위치' });
    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    expect(await screen.findByText(/툴바의 "레퍼런스로 담기"/)).toBeTruthy();
  });

  it('stays hidden when the daemon cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const { container } = renderKo(<ReferenceBoard projectId="p1" onNavigate={vi.fn()} />);
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="reference-board"]')).toBeNull();
  });
});

describe('ReferenceCaptureDialog', () => {
  it('reads the outline, hides itself while the screenshot is taken and keeps both', async () => {
    installFetch();
    let hiddenDuringCapture: boolean | null = null;
    const capture = vi.fn(async () => {
      hiddenDuringCapture = (screen.getByTestId('reference-capture-dialog') as HTMLElement).hidden;
      return 'data:image/png;base64,QUJD';
    });
    const readOutline = vi.fn(async () => ({ regions: ['main'] }));
    const onSaved = vi.fn();
    renderKo(<ReferenceCaptureDialog projectId="p1" url="https://forms.example/join" title="Join" canCapture capture={capture} readOutline={readOutline} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.change(screen.getByPlaceholderText(/무엇이 좋았나요/), { target: { value: '단계가 짧음' } });
    fireEvent.click(screen.getByLabelText('필드 구성'));
    fireEvent.click(screen.getByTestId('reference-capture-save'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(hiddenDuringCapture).toBe(true);
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      url: 'https://forms.example/join', title: 'Join', note: '단계가 짧음', takes: ['structure', 'fields'], source: 'browser',
      screenshotBase64: 'QUJD', outline: { regions: ['main'] },
    });
  });

  it('keeps only the address and note without the desktop webview', async () => {
    installFetch();
    const capture = vi.fn(async () => 'x');
    const onSaved = vi.fn();
    renderKo(<ReferenceCaptureDialog projectId="p1" url="https://a.example/" title="A" canCapture={false} capture={capture} readOutline={vi.fn()} onClose={vi.fn()} onSaved={onSaved} />);
    expect(screen.getByText(/데스크톱 앱에서만/)).toBeTruthy();
    expect(screen.queryByLabelText('화면 캡처 포함')).toBeNull();
    fireEvent.click(screen.getByTestId('reference-capture-save'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(capture).not.toHaveBeenCalled();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ url: 'https://a.example/', title: 'A', note: '', takes: ['structure'], source: 'browser' });
  });
});

describe('Recording a reference flow with REA', () => {
  const FLOW: ReferenceFlowSummary = {
    file: 'references/ref-1.flow.json', evidenceId: 'ev_1', sha256: 'b'.repeat(64), recordedAt: '2026-11-06T00:00:00.000Z', browser: 'chrome',
    steps: [{ id: 'step-1', label: 'type into "주문번호"', status: 'completed', request: { kind: 'fill', target: '주문번호', value: '1001' } },
      { id: 'step-2', label: 'press button "조회"', status: 'failed', error: 'Timeout 10000ms exceeded.', request: { kind: 'click', target: '조회', role: 'button' } }],
    screenshot: 'references/ref-1.flow.png',
    completed: 1, total: 2, apiCalls: [{ method: 'GET', path: '/api/orders', status: 200 }], completeness: 'incomplete',
  };

  function installFlowFetch() {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      const respond = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
      if (url.endsWith('/references') && method === 'GET') return respond(200, { folder: 'references', items });
      if (url.endsWith('/flow')) { items = [{ ...ITEM, flow: FLOW }]; return respond(200, { item: items[0], flow: FLOW }); }
      if (url.endsWith('/flow-request')) return respond(200, { text: '<reference-flow-request id="ref-1">' });
      return respond(404, { error: { message: 'no' } });
    }));
  }

  it('records typed steps, shows each step and the API calls, and opens the evidence in REA Studio', async () => {
    installFlowFetch();
    const onOpenFile = vi.fn();
    renderKo(<ReferenceBoard projectId="p1" onNavigate={vi.fn()} onOpenFile={onOpenFile} />);
    fireEvent.click(await screen.findByTestId('reference-flow-open'));
    const panel = screen.getByTestId('reference-flow-panel');
    expect(panel.textContent).toContain('로그인이 필요한 화면은 기록되지 않고');
    fireEvent.click(screen.getByTestId('reference-flow-add'));
    fireEvent.click(screen.getByTestId('reference-flow-add'));
    const kinds = screen.getAllByLabelText('단계 종류') as HTMLSelectElement[];
    fireEvent.change(kinds[0]!, { target: { value: 'fill' } });
    fireEvent.change(screen.getByPlaceholderText('칸 이름 (예: 주문번호)'), { target: { value: '주문번호' } });
    fireEvent.change(screen.getByPlaceholderText('입력할 값 (공개 값만)'), { target: { value: '1001' } });
    fireEvent.change(screen.getByPlaceholderText('보이는 이름 (예: 조회)'), { target: { value: '조회' } });
    fireEvent.click(screen.getByTestId('reference-flow-start'));
    const result = await screen.findByTestId('reference-flow-result');
    expect(calls.find((call) => call.url.endsWith('/references/ref-1/flow'))?.body).toEqual({
      steps: [{ kind: 'fill', target: '주문번호', value: '1001' }, { kind: 'click', target: '조회', role: 'button' }],
    });
    expect(result.textContent).toContain('1/2단계 완료 · API 1개');
    expect(result.textContent).toContain('입력하기 "주문번호" · 완료');
    expect(result.textContent).toContain('버튼 누르기 "조회" · 실패');
    expect(result.textContent).toContain('GET /api/orders');
    // The card shows the flow too, and the item's own screenshot stays its picture.
    expect(await screen.findByText(/흐름: 1\/2단계 · API 1개/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'REA 스튜디오로 열기' })[0]!);
    expect(onOpenFile).toHaveBeenCalledWith('references/ref-1.flow.json');
  });

  it('hands a flow the steps cannot express to the AI instead of recording it', async () => {
    installFlowFetch();
    const onAppendToChat = vi.fn();
    renderKo(<ReferenceBoard projectId="p1" onNavigate={vi.fn()} onAppendToChat={onAppendToChat} />);
    fireEvent.click(await screen.findByTestId('reference-flow-open'));
    fireEvent.click(screen.getByTestId('reference-flow-agent'));
    await waitFor(() => expect(onAppendToChat).toHaveBeenCalledWith('<reference-flow-request id="ref-1">', '아래 레퍼런스의 흐름을 REA로 기록해 주세요.'));
    expect(calls.some((call) => call.url.endsWith('/flow'))).toBe(false);
    expect(await screen.findByText('AI에게 보낼 기록 요청을 입력창에 넣었습니다.')).toBeTruthy();
  });

  it('shows why a recording was refused', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/flow')
      ? new Response(JSON.stringify({ error: { message: 'Recording needs Chrome, Edge or Chromium.' } }), { status: 409 })
      : new Response(JSON.stringify({ folder: 'references', items }), { status: 200 })));
    renderKo(<ReferenceBoard projectId="p1" onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('reference-flow-open'));
    fireEvent.click(screen.getByTestId('reference-flow-start'));
    expect((await screen.findByRole('alert')).textContent).toContain('Chrome, Edge or Chromium');
  });
});

describe('Comparing our screen with a reference flow', () => {
  const FLOW: ReferenceFlowSummary = {
    file: 'references/ref-1.flow.json', evidenceId: 'ev_1', sha256: 'b'.repeat(64), recordedAt: '2026-11-09T00:00:00.000Z', browser: 'chrome',
    steps: [{ id: 'step-1', label: 'press button "조회"', status: 'completed', request: { kind: 'click', target: '조회', role: 'button' } }],
    completed: 1, total: 1, apiCalls: [{ method: 'GET', path: '/api/orders', status: 200 }], completeness: 'incomplete',
  };
  const REMAKE = {
    url: 'http://localhost:8080/orders', comparedAt: '2026-11-09T00:01:00.000Z',
    flow: { ...FLOW, file: 'references/ref-1.remake.flow.json', apiCalls: [] },
    comparison: {
      rows: [
        { position: 0, id: 'scenario_start', label: 'open the page', verdict: 'pass' as const, differences: [], reference: { status: 'completed', navigated: true, calls: [] }, ours: { status: 'completed', navigated: true, calls: [] }, onlyReference: [], onlyOurs: [] },
        { position: 1, id: 'step-1', label: 'press button "조회"', verdict: 'fail' as const, differences: ['calls' as const, 'structure' as const],
          reference: { status: 'completed', navigated: false, calls: ['GET 2xx'] }, ours: { status: 'completed', navigated: false, calls: [] }, onlyReference: ['table'], onlyOurs: [] },
      ],
      summary: { pass: 1, fail: 1, missing: 0, extra: 0, total: 2 },
    },
  };

  function installCompareFetch() {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      const respond = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
      if (url.endsWith('/references') && method === 'GET') return respond(200, { folder: 'references', items });
      if (url.endsWith('/compare')) { items = [{ ...items[0]!, remake: REMAKE }]; return respond(200, { item: items[0], remake: REMAKE, block: 'unused' }); }
      return respond(404, { error: { message: 'no' } });
    }));
  }

  it('replays the reference steps on our screen, shows each step side by side and puts the differences into the chat', async () => {
    items = [{ ...ITEM, flow: FLOW }];
    installCompareFetch();
    const onAppendToChat = vi.fn();
    const onOpenFile = vi.fn();
    renderKo(<ReferenceBoard projectId="p1" onNavigate={vi.fn()} onAppendToChat={onAppendToChat} onOpenFile={onOpenFile} />);
    fireEvent.click(await screen.findByTestId('reference-compare-open'));
    const panel = screen.getByTestId('reference-compare-panel');
    // The reference's own steps are there to edit.
    expect((screen.getByPlaceholderText('보이는 이름 (예: 조회)') as HTMLInputElement).value).toBe('조회');
    expect((screen.getByTestId('reference-compare-start') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('reference-compare-url'), { target: { value: 'http://localhost:8080/orders' } });
    fireEvent.click(screen.getByTestId('reference-compare-start'));
    const result = await screen.findByTestId('reference-compare-result');
    expect(calls.find((call) => call.url.endsWith('/references/ref-1/compare'))?.body).toEqual({
      url: 'http://localhost:8080/orders', steps: [{ kind: 'click', target: '조회', role: 'button' }],
    });
    expect(result.textContent).toContain('레퍼런스와 같은 단계 1/2');
    expect(result.textContent).toContain('서버 요청 없음');
    expect(result.textContent).toContain('GET 2xx');
    expect(result.textContent).toContain('레퍼런스에만: table');
    expect(result.textContent).toContain('서버 요청, 화면 요소');
    expect(panel.textContent).toContain('다름');
    fireEvent.click(screen.getByTestId('reference-compare-to-chat'));
    expect(onAppendToChat).toHaveBeenCalledTimes(1);
    expect(onAppendToChat.mock.calls[0]![0]).toContain('<reference-flow-comparison id="ref-1"');
    expect(onAppendToChat.mock.calls[0]![0]).toContain('ours:      completed, no API call');
    expect(onAppendToChat.mock.calls[0]![1]).toBe('아래 비교에서 레퍼런스와 다른 단계를 우리 화면에 맞춰 고쳐 주세요.');
    // The card keeps the outcome after the panel closes.
    expect(screen.getByTestId('reference-card-remake').textContent).toContain('우리 화면: 1/2 같음');
    fireEvent.click(screen.getByRole('button', { name: '우리 화면 기록 열기' }));
    expect(onOpenFile).toHaveBeenCalledWith('references/ref-1.remake.flow.json');
  });

  it('offers the comparison only once the reference has a recorded flow', async () => {
    items = [ITEM];
    installCompareFetch();
    renderKo(<ReferenceBoard projectId="p1" onNavigate={vi.fn()} />);
    await screen.findByText('Join flow');
    expect(screen.queryByTestId('reference-compare-open')).toBeNull();
  });
});
