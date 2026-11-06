// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReferenceItem } from '@open-design/contracts';
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
