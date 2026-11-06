// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReaBrowserView, ReaCitation, ReaComparison, ReaDoctorResponse, ReaEvidenceView, ReaPayload } from '@open-design/contracts';
import { I18nProvider } from '../../src/i18n';
import { ReaEvidenceGate, ReaStudio } from '../../src/components/rea-studio/ReaStudio';
import { ReaDoctorPanel } from '../../src/components/rea-studio/ReaDoctorPanel';
import type { ProjectFile } from '../../src/types';

type Json = Record<string, unknown>;
const envelope = { evidenceId: 'ev_0123456789abcdef0123', predicate: 'rea.browser-scenario-capture', operation: 'capture_browser_scenario', provider: { id: 'p', name: 'REA', version: '1' }, confidence: 'observed', authority: null, limitations: [] };
const payload = (over: Partial<ReaPayload> = {}): ReaPayload => ({ state: 'captured', mediaType: 'application/json', bytes: 30, sha256: 'a'.repeat(64), redacted: false, ...over });
const shot = (data: string) => payload({ state: 'captured-binary', mediaType: 'image/png', dataUrl: `data:image/png;base64,${data}` });
const browser = (file: string, data: string): ReaEvidenceView & ReaBrowserView => ({
  ok: true, file, envelope, unknowns: [], kind: 'browser', origin: null, durationMs: 10, droppedEvents: 0, captured: { requestBodies: true, responseBodies: true },
  completeness: { status: 'complete', missingSections: [], truncatedSections: [] },
  steps: [
    { index: 0, id: 'start', action: 'goto_start', status: 'completed', elapsedMs: 5, url: 'http://x/', eventStart: 1, eventEnd: 2, error: null },
    { index: 1, id: 'settle-click', action: 'click', status: 'completed', elapsedMs: 5, url: null, eventStart: 3, eventEnd: 4, error: null, screenshot: shot(data) },
  ],
  requests: [{ id: 'request-2', stepIndex: 1, method: 'POST', origin: null, path: '/api/orders/1001/settle', queryNames: [], resourceType: 'fetch', status: 201, isApi: true, request: payload({ text: '{}' }), response: payload({ text: '{"id":1}' }) }],
});
const original = browser('evidence/original.json', 'ORIG');
const remake = browser('evidence/remake.json', 'REMAKE');
const citation: ReaCitation = { ok: true, file: 'evidence/original.json', evidenceId: envelope.evidenceId, pointer: 'steps[step_index=1]', label: 'step 1 settle-click',
  block: '<rea-evidence file="evidence/original.json" evidence_id="ev_0123" pointer="steps[step_index=1]">\nitem: step 1\n</rea-evidence>', files: ['evidence/rea-cite/original-step-1.png'], valuesIncluded: false };
const comparison: ReaComparison = {
  ok: true, kind: 'browser', original: 'evidence/original.json', remake: 'evidence/remake.json', textCompared: true,
  summary: { total: 2, pass: 1, fail: 1, missing: 0, extra: 0 },
  report: 'evidence/original.json → evidence/remake.json (browser steps): 1/2 pass · 1 fail',
  steps: [
    { position: 0, original: { index: 0, id: 'start', action: 'goto_start', status: 'completed', path: '/' }, remake: { index: 0, id: 'start', action: 'goto_start', status: 'completed', path: '/' }, verdict: 'pass', differences: [], calls: [], text: { compared: false, source: null, onlyOriginal: [], onlyRemake: [] }, screenshots: { original: false, remake: false } },
    { position: 1, original: { index: 1, id: 'settle-click', action: 'click', status: 'completed', path: null }, remake: { index: 1, id: 'settle-click', action: 'click', status: 'completed', path: null }, verdict: 'fail', differences: ['calls', 'text'],
      calls: [{ method: 'POST', route: '/api/orders/{n}/settle', original: [201], remake: [500], same: false }], text: { compared: true, source: 'accessibility', onlyOriginal: ['heading "주문 목록"'], onlyRemake: ['heading "Orders"'] }, screenshots: { original: true, remake: true } },
  ],
};

function stub(routes: { probe?: Json; doctor?: ReaDoctorResponse; citeStatus?: number } = {}) {
  const posts: Array<{ url: string; body: Json }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) as Json : {};
    if (init?.method === 'POST') posts.push({ url, body });
    if (url.endsWith('/rea-evidence/probe')) return Response.json(routes.probe ?? { evidence: true });
    if (url.endsWith('/rea-evidence/view')) return Response.json(body.file === 'evidence/remake.json' ? remake : original);
    if (url.endsWith('/rea-evidence/cite')) return routes.citeStatus ? Response.json({ error: { message: 'No step 9 in this capture.' } }, { status: routes.citeStatus }) : Response.json(citation);
    if (url.endsWith('/rea-evidence/compare')) return Response.json(body.remake === 'cases/remake.json'
      ? { ok: true, kind: 'cases', original: 'cases/original.json', remake: 'cases/remake.json', tolerance: 0, truncated: false, report: 'cases report', summary: { total: 2, pass: 1, fail: 1, missing: 0, extra: 0 },
        rows: [{ key: 'pan-320', input: '{"x":320}', original: '0', remake: '0.02', verdict: 'fail', at: '$' }, { key: 'pan-0', input: '{"x":0}', original: '-1', remake: '-1', verdict: 'pass' }] }
      : comparison);
    if (url.endsWith('/rea-evidence')) return Response.json({ files: [
      { file: 'evidence/original.json', kind: 'browser', size: 1, mtime: 2, operation: 'capture_browser_scenario', evidenceId: 'a' },
      { file: 'evidence/remake.json', kind: 'browser', size: 1, mtime: 1, operation: 'capture_browser_scenario', evidenceId: 'b' },
      { file: 'evidence/db.json', kind: 'sqlite', size: 1, mtime: 1, operation: 'inspect_sqlite_database', evidenceId: 'c' },
    ], cases: [{ file: 'cases/original.json', size: 1, mtime: 2 }, { file: 'cases/remake.json', size: 1, mtime: 1 }] });
    if (url.endsWith('/api/rea/doctor') && routes.doctor) return Response.json(routes.doctor);
    return new Response('{}', { status: 404 });
  }));
  return posts;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('REA Studio: adding evidence to the chat', () => {
  it('quotes a step through the daemon and appends it to the chat with the intro, then says what was saved', async () => {
    const posts = stub();
    const onSendToChat = vi.fn();
    render(<I18nProvider initial="en"><ReaStudio projectId="p1" file="evidence/original.json" onSendToChat={onSendToChat} /></I18nProvider>);
    await screen.findByTestId('rea-browser');
    fireEvent.click(screen.getByRole('button', { name: /settle-click/ }));
    fireEvent.click(within(screen.getByRole('region', { name: 'settle-click' })).getByTestId('rea-cite'));
    await waitFor(() => expect(onSendToChat).toHaveBeenCalledTimes(1));
    expect(onSendToChat).toHaveBeenCalledWith(citation.block, 'Build this from the REA evidence below. Where the evidence says nothing, do not guess: list it as an open question.');
    expect(posts.find((post) => post.url.endsWith('/cite'))!.body).toEqual({ file: 'evidence/original.json', target: { kind: 'step', index: 1 }, includeValues: false });
    expect(screen.getByRole('status').textContent).toBe('Added to the chat input: step 1 settle-click · screenshot saved to evidence/rea-cite/original-step-1.png');
  });

  it('asks for values only when the person ticks the box, and cites a request and the whole file', async () => {
    const posts = stub();
    render(<I18nProvider initial="en"><ReaStudio projectId="p1" file="evidence/original.json" onSendToChat={vi.fn()} /></I18nProvider>);
    await screen.findByTestId('rea-browser');
    fireEvent.click(screen.getByTestId('rea-include-values'));
    fireEvent.click(within(screen.getAllByTestId('rea-request-row')[0]!).getByRole('button'));
    fireEvent.click(within(screen.getByRole('tab', { name: 'Request' }).closest('div')!.parentElement!).getByTestId('rea-cite'));
    await waitFor(() => expect(posts.filter((post) => post.url.endsWith('/cite'))).toHaveLength(1));
    expect(posts[posts.length - 1]!.body).toMatchObject({ target: { kind: 'request', id: 'request-2' }, includeValues: true });
    fireEvent.click(screen.getByRole('button', { name: 'Add the whole file to chat' }));
    await waitFor(() => expect(posts.filter((post) => post.url.endsWith('/cite'))).toHaveLength(2));
    expect(posts[posts.length - 1]!.body).toMatchObject({ target: { kind: 'file' } });
  });

  it('shows the daemon\'s refusal, and has no chat buttons where there is no chat', async () => {
    stub({ citeStatus: 404 });
    const { unmount } = render(<I18nProvider initial="en"><ReaStudio projectId="p1" file="evidence/original.json" onSendToChat={vi.fn()} /></I18nProvider>);
    await screen.findByTestId('rea-browser');
    fireEvent.click(screen.getByRole('button', { name: 'Add the whole file to chat' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not add it to the chat: No step 9 in this capture.');
    unmount();
    stub();
    render(<I18nProvider initial="en"><ReaStudio projectId="p1" file="evidence/original.json" /></I18nProvider>);
    await screen.findByTestId('rea-browser');
    expect(screen.queryByTestId('rea-cite')).toBeNull();
    expect(screen.queryByTestId('rea-cite-bar')).toBeNull();
  });
});

describe('REA Studio: comparing with a remake', () => {
  it('offers the other browser captures, compares, shows both screenshots side by side, and sends the differences', async () => {
    const posts = stub();
    const onSendToChat = vi.fn();
    render(<I18nProvider initial="en"><ReaStudio projectId="p1" file="evidence/original.json" onSendToChat={onSendToChat} /></I18nProvider>);
    await screen.findByTestId('rea-browser');
    fireEvent.click(screen.getByTestId('rea-compare-open'));
    const picker = await screen.findByTestId('rea-compare-remake') as HTMLSelectElement;
    expect([...picker.options].map((option) => option.value)).toEqual(['evidence/remake.json']);
    fireEvent.click(screen.getByTestId('rea-compare-run'));
    const summary = await screen.findByTestId('rea-compare-summary');
    expect(summary.textContent).toContain('1/2');
    expect(posts.find((post) => post.url.endsWith('/compare'))!.body).toEqual({ original: 'evidence/original.json', remake: 'evidence/remake.json', compareText: true });
    const rows = screen.getAllByTestId('rea-compare-row');
    expect(within(rows[1]!).getByText('Differs')).toBeTruthy();
    expect(within(rows[1]!).getByText('API calls')).toBeTruthy();
    fireEvent.click(rows[1]!);
    await waitFor(() => expect(screen.getAllByRole('img', { name: 'Screenshot' }).map((image) => image.getAttribute('src'))).toEqual(expect.arrayContaining(['data:image/png;base64,ORIG', 'data:image/png;base64,REMAKE'])));
    expect(screen.getByText('201 → 500')).toBeTruthy();
    expect(screen.getByTestId('rea-compare-text').textContent).toContain('- heading "주문 목록"');
    expect(screen.getByTestId('rea-compare-text').textContent).toContain('+ heading "Orders"');
    fireEvent.click(screen.getByTestId('rea-compare-send'));
    expect(onSendToChat).toHaveBeenCalledWith(comparison.report, 'Make the remake match the original. This comparison lists what differs (original → remake):');
  });

  it('opens a case-result file as a comparison of cases', async () => {
    const posts = stub({ probe: { evidence: false, cases: true } });
    const file: ProjectFile = { name: 'cases/original.json', kind: 'code', size: 10, mtime: 1 } as ProjectFile;
    render(<I18nProvider initial="ko"><ReaEvidenceGate projectId="p1" file={file} raw={<pre>raw</pre>} onSendToChat={vi.fn()} /></I18nProvider>);
    expect((await screen.findByTestId('rea-cases')).textContent).toContain('케이스 결과');
    const picker = await screen.findByTestId('rea-compare-remake') as HTMLSelectElement;
    expect([...picker.options].map((option) => option.value)).toEqual(['cases/remake.json']);
    fireEvent.click(screen.getByTestId('rea-compare-run'));
    const table = await screen.findByTestId('rea-compare-cases');
    expect(within(table).getAllByRole('row')).toHaveLength(2); // header + the failing case; passing ones are hidden by default
    expect(within(table).getByText('pan-320')).toBeTruthy();
    expect(posts.find((post) => post.url.endsWith('/compare'))!.body).toEqual({ original: 'cases/original.json', remake: 'cases/remake.json', tolerance: 0 });
  });
});

describe('REA setup check panel', () => {
  const doctor = (over: Partial<ReaDoctorResponse> = {}): ReaDoctorResponse => ({
    ok: true, ready: false, platform: 'win32', package: { name: 'rea-agents', version: '6.7.0', node: '^22.19.0 || ^24.11.0 || >=26.0.0' },
    checks: [
      { id: 'node', required: true, status: 'warn', found: 'v20.18.0', note: 'outside-range' },
      { id: 'npx', required: true, status: 'ok', found: 'C:\\nodejs\\npx.cmd' },
      { id: 'mcp', required: true, status: 'missing', found: null },
      { id: 'browser', required: false, status: 'ok', found: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
      { id: 'ghidra', required: true, status: 'warn', found: null, note: 'empty-value' },
      { id: 'native', required: false, status: 'missing', found: null },
    ],
    bundled: null,
    ...over,
  });

  it('lists required items first with what each is for, and adds REA to the MCP list when it is missing', async () => {
    stub({ doctor: doctor() });
    const onAddRea = vi.fn();
    render(<I18nProvider initial="ko"><ReaDoctorPanel mcpRow="none" onAddRea={onAddRea} /></I18nProvider>);
    expect((await screen.findByRole('status')).textContent).toBe('준비 안 됨: 아래 필수 항목을 해결하세요.');
    const node = screen.getByTestId('rea-doctor-node');
    expect(node.getAttribute('data-status')).toBe('warn');
    expect(node.textContent).toContain('Node.js ^22.19.0 || ^24.11.0 || >=26.0.0');
    expect(node.textContent).toContain('지원 범위 밖');
    expect(node.textContent).toContain('v20.18.0');
    expect(screen.getByTestId('rea-doctor-native').textContent).toContain('찾지 못함');
    expect(screen.getAllByRole('listitem').map((item) => item.getAttribute('data-testid'))).toEqual(['rea-doctor-node', 'rea-doctor-npx', 'rea-doctor-mcp', 'rea-doctor-ghidra', 'rea-doctor-browser', 'rea-doctor-native']);
    const ghidra = screen.getByTestId('rea-doctor-ghidra');
    expect(ghidra.textContent).toContain('Ghidra');
    expect(ghidra.textContent).toContain('빈 값: 채우거나 지우기 전에는 REA가 시작되지 않음');
    expect(ghidra.textContent).toContain('Ghidra 폴더 칸을 채웁니다');
    fireEvent.click(screen.getByTestId('rea-doctor-add'));
    expect(onAddRea).toHaveBeenCalledTimes(1);
  });

  it('asks to save once REA is in the list but not saved, and reads ready from the daemon', async () => {
    stub({ doctor: doctor() });
    const { unmount } = render(<I18nProvider initial="en"><ReaDoctorPanel mcpRow="unsaved" onAddRea={vi.fn()} /></I18nProvider>);
    await screen.findByTestId('rea-doctor-mcp');
    expect(screen.queryByTestId('rea-doctor-add')).toBeNull();
    expect(screen.getByTestId('rea-doctor-mcp').textContent).toContain('Save the MCP settings to apply it.');
    unmount();
    stub({ doctor: doctor({ ready: true, checks: [{ id: 'node', required: true, status: 'ok', found: 'v24.11.1' }] }) });
    render(<I18nProvider initial="en"><ReaDoctorPanel mcpRow="saved" /></I18nProvider>);
    expect((await screen.findByRole('status')).textContent).toBe('Ready: a new agent conversation can start REA.');
  });
  it('shows the built-in REA, why Node.js and npx are not needed, and how to register it elsewhere', async () => {
    stub({ doctor: doctor({ ready: true, platform: 'win32',
      checks: [
        { id: 'bundled', required: false, status: 'ok', found: 'rea-agents 6.7.0 · Node.js 24.14.0' },
        { id: 'node', required: false, status: 'missing', found: null, note: 'not-needed' },
        { id: 'npx', required: false, status: 'missing', found: null, note: 'not-needed' },
        { id: 'mcp', required: true, status: 'ok', found: 'npx -y rea-agents@6.7.0 --mcp', note: 'runs-bundled' },
      ],
      bundled: { version: '6.7.0', command: 'C:\\MonoField\\MonoField.exe', args: ['C:\\MonoField\\resources\\app\\node_modules\\rea-agents\\scripts\\rea.mjs', '--mcp'], env: { ELECTRON_RUN_AS_NODE: '1' } } }) });
    render(<I18nProvider initial="ko"><ReaDoctorPanel mcpRow="saved" /></I18nProvider>);
    const bundled = await screen.findByTestId('rea-doctor-bundled');
    expect(bundled.textContent).toContain('내장 REA');
    expect(bundled.textContent).toContain('rea-agents 6.7.0 · Node.js 24.14.0');
    expect(screen.getByTestId('rea-doctor-node').textContent).toContain('필요 없음: 내장 REA를 씀');
    expect(screen.getByTestId('rea-doctor-mcp').textContent).toContain('내장 REA로 실행');
    const launch = screen.getByTestId('rea-doctor-launch');
    expect(launch.textContent).toContain('C:\\MonoField\\MonoField.exe');
    expect(launch.textContent).toContain('rea.mjs --mcp');
    expect(launch.textContent).toContain('ELECTRON_RUN_AS_NODE=1');
  });

  it('leaves out the launch details when MonoField has no usable copy', async () => {
    stub({ doctor: doctor() });
    render(<I18nProvider initial="en"><ReaDoctorPanel mcpRow="none" onAddRea={vi.fn()} /></I18nProvider>);
    await screen.findByTestId('rea-doctor-mcp');
    expect(screen.queryByTestId('rea-doctor-launch')).toBeNull();
  });
});
