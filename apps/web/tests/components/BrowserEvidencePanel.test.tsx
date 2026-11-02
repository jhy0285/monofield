// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BrowserEvidenceCrossCheckResponse, InterfaceSpecDocument } from '@open-design/contracts';
import { I18nProvider } from '../../src/i18n';
import { BrowserEvidencePanel } from '../../src/components/document-spec/BrowserEvidencePanel';

const SPEC_HASH = 'a'.repeat(64);
const doc = { schemaVersion: 1, kind: 'interface-spec', endpoints: [] } as unknown as InterfaceSpecDocument;
const target = { method: 'POST', path: '/api/orders/{id}/settle', interfaceId: 'ORDER-002', index: 0 };

function crossCheck(over: Partial<BrowserEvidenceCrossCheckResponse> = {}): BrowserEvidenceCrossCheckResponse {
  return {
    ok: true, inputFile: 'docs/settlement.interface-spec.json', contentSha256: SPEC_HASH,
    sources: [{ file: 'evidence/capture.json', evidenceId: 'ev_1', origin: 'http://127.0.0.1:4318', steps: 12, completedSteps: 12, transactions: 8, apiTransactions: 6,
      droppedEvents: 0, completeness: { status: 'incomplete', missingSections: ['events'], truncatedSections: [] }, captured: { requestBodies: true, responseBodies: true }, limitations: [] }],
    transactions: [],
    coverage: [
      { index: 0, method: 'POST', path: '/api/orders/{id}/settle', interfaceId: 'ORDER-002', observed: 4, statuses: [201, 409], response: { documented: 5, confirmed: 4, bodies: 1 }, request: { documented: 1, confirmed: 0, bodies: 4 } },
      { index: 1, method: 'GET', path: '/api/unused', interfaceId: 'UNUSED-001', observed: 0, statuses: [], response: { documented: 0, confirmed: 0, bodies: 0 }, request: { documented: 0, confirmed: 0, bodies: 0 } },
    ],
    findings: [
      { id: 'undocumented-field|POST|/api/orders/{id}/settle|response|fee_amount', kind: 'undocumented-field', severity: 'warning', endpoint: target, side: 'response', field: 'fee_amount',
        observedTypes: ['integer'], statuses: [201], transactions: ['ev_1#request-4'], applicable: true },
      { id: 'name-mismatch|POST|/api/orders/{id}/settle|response|net_amount', kind: 'name-mismatch', severity: 'warning', endpoint: target, side: 'response', field: 'net_amount', documentedField: 'netAmount',
        observedTypes: ['integer'], documentedType: 'Integer', statuses: [201], transactions: ['ev_1#request-4'], applicable: true },
      { id: 'unobserved-field|POST|/api/orders/{id}/settle|response|legacy', kind: 'unobserved-field', severity: 'info', endpoint: target, side: 'response', field: 'legacy',
        documentedType: 'String', statuses: [201], transactions: [], applicable: false },
    ],
    summary: { documentedEndpoints: 2, exercisedEndpoints: 1, undocumentedEndpoints: 0, observedApiCalls: 6, confirmedFields: 4, documentedFields: 6, errors: 0, warnings: 2, info: 1 },
    ...over,
  };
}

function stub(options: { files?: string[]; result?: BrowserEvidenceCrossCheckResponse; applyStatus?: number } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const files = options.files ?? ['evidence/capture.json'];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) });
    if (url === '/api/projects/p1/browser-evidence') return Response.json({ files: files.map((file) => ({ file, size: 42_000, mtime: 1 })) });
    if (url === '/api/projects/p1/browser-evidence/cross-check') return Response.json(options.result ?? crossCheck());
    if (url === '/api/projects/p1/browser-evidence/apply') {
      if (options.applyStatus && options.applyStatus !== 200) return Response.json({ error: { code: 'BROWSER_EVIDENCE_FAILED', message: 'apply failed' } }, { status: options.applyStatus });
      return Response.json({ ok: true, doc, changes: { endpointsAdded: 0, fieldsAdded: 1, fieldsRenamed: 1, typesChanged: 0, notesAdded: 0, evidenceAttached: 2, examplesAdded: 0 } });
    }
    return new Response('{}', { status: 404 });
  }));
  return calls;
}

function renderPanel(props: { dirty?: boolean; loadedContentSha256?: string | undefined; onApply?: (next: InterfaceSpecDocument) => void; locale?: 'ko' | 'en' } = {}) {
  const onApply = props.onApply ?? vi.fn();
  render(<I18nProvider initial={props.locale ?? 'ko'}>
    <BrowserEvidencePanel projectId="p1" inputFile="docs/settlement.interface-spec.json" dirty={props.dirty ?? false}
      loadedContentSha256={'loadedContentSha256' in props ? props.loadedContentSha256 : SPEC_HASH} onApply={onApply} />
  </I18nProvider>);
  return onApply;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('BrowserEvidencePanel', () => {
  it('lists the capture files, compares the chosen ones and groups the findings by endpoint', async () => {
    const calls = stub({ files: ['evidence/capture.json', 'evidence/other.json'] });
    renderPanel();
    const boxes = await screen.findAllByTestId('browser-evidence-file');
    expect(boxes).toHaveLength(2);
    // Every listed file starts chosen; one can be dropped.
    expect(boxes.every((box) => (box as HTMLInputElement).checked)).toBe(true);
    fireEvent.click(boxes[1]!);
    fireEvent.click(screen.getByTestId('browser-evidence-run'));
    const result = await screen.findByTestId('browser-evidence-result');
    const request = calls.find((call) => call.url.endsWith('/cross-check'))!;
    expect(JSON.parse(String(request.init!.body))).toEqual({ inputFile: 'docs/settlement.interface-spec.json', evidenceFiles: ['evidence/capture.json'] });
    expect(within(result).getByText(/API 호출 6건 · 엔드포인트 1\/2개 실행/)).toBeTruthy();
    expect(within(result).getByText('명세서에 없는 필드')).toBeTruthy();
    expect(within(result).getByText('필드 이름 불일치')).toBeTruthy();
    expect(within(result).getByText('fee_amount')).toBeTruthy();
    expect(within(result).getByText('netAmount')).toBeTruthy();
    // The one endpoint appears once, with its interface ID; the incomplete capture is called out.
    expect(within(result).getAllByText(/POST \/api\/orders\/\{id\}\/settle · ORDER-002/)).toHaveLength(1);
    expect(within(result).getByText(/기록 상태가 incomplete이므로/)).toBeTruthy();
    // A finding apply cannot write has no checkbox and says so.
    expect(within(result).getAllByTestId('browser-evidence-finding')).toHaveLength(2);
    expect(within(result).getByText('반영 대상 아님')).toBeTruthy();
    expect(within(result).getByTestId('browser-evidence-apply').textContent).toBe('선택한 2건을 편집기에 반영');
  });

  it('applies only the ticked findings and hands the document to the editor unsaved', async () => {
    const calls = stub();
    const onApply = renderPanel();
    fireEvent.click(await screen.findByTestId('browser-evidence-run'));
    const result = await screen.findByTestId('browser-evidence-result');
    fireEvent.click(within(result).getAllByTestId('browser-evidence-finding')[1]!);
    expect(within(result).getByTestId('browser-evidence-apply').textContent).toBe('선택한 1건을 편집기에 반영');
    fireEvent.click(within(result).getByTestId('browser-evidence-apply'));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(doc));
    const request = calls.find((call) => call.url.endsWith('/apply'))!;
    expect(JSON.parse(String(request.init!.body))).toEqual({
      inputFile: 'docs/settlement.interface-spec.json', evidenceFiles: ['evidence/capture.json'],
      findingIds: ['undocumented-field|POST|/api/orders/{id}/settle|response|fee_amount'],
      includeExamples: false, attachEvidence: true, noteLanguage: 'ko',
    });
    // Nothing is written by the panel: there is no write flag, and the comparison is cleared.
    expect(JSON.parse(String(request.init!.body)).write).toBeUndefined();
    const note = await screen.findByTestId('browser-evidence-applied');
    expect(note.textContent).toContain('필드 1개');
    expect(note.textContent).toContain('판단 검토');
    expect(screen.queryByTestId('browser-evidence-result')).toBeNull();
  });

  it('copies examples only after a warning, and writes notes in English for an English interface', async () => {
    const calls = stub();
    renderPanel({ locale: 'en' });
    fireEvent.click(await screen.findByTestId('browser-evidence-run'));
    const result = await screen.findByTestId('browser-evidence-result');
    expect(within(result).queryByRole('note')).toBeNull();
    fireEvent.click(within(result).getByTestId('browser-evidence-examples'));
    expect(within(result).getByRole('note').textContent).toMatch(/real production data/);
    fireEvent.click(within(result).getByTestId('browser-evidence-apply'));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/apply'))).toBe(true));
    expect(JSON.parse(String(calls.find((call) => call.url.endsWith('/apply'))!.init!.body))).toMatchObject({ includeExamples: true, noteLanguage: 'en' });
  });

  it('will not compare or apply over unsaved edits or a changed file', async () => {
    stub();
    renderPanel({ dirty: true });
    await screen.findAllByTestId('browser-evidence-file');
    expect((screen.getByTestId('browser-evidence-run') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('먼저 변경사항을 저장하세요. 대조는 저장된 파일을 읽습니다.')).toBeTruthy();
    cleanup(); vi.unstubAllGlobals();

    stub();
    renderPanel({ loadedContentSha256: 'b'.repeat(64) });
    fireEvent.click(await screen.findByTestId('browser-evidence-run'));
    const result = await screen.findByTestId('browser-evidence-result');
    expect(within(result).getByText('이 대조 이후 명세서가 바뀌었습니다. 반영하기 전에 다시 대조하세요.')).toBeTruthy();
    expect((within(result).getByTestId('browser-evidence-apply') as HTMLButtonElement).disabled).toBe(true);
  });

  it('says so when there is no capture, and cannot compare', async () => {
    stub({ files: [] });
    renderPanel();
    expect(await screen.findByTestId('browser-evidence-empty')).toBeTruthy();
    expect((screen.getByTestId('browser-evidence-run') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows an agreeing comparison as such, and the daemon error when applying fails', async () => {
    stub({ result: crossCheck({ findings: [], summary: { ...crossCheck().summary, warnings: 0, info: 0 } }), applyStatus: 400 });
    renderPanel();
    fireEvent.click(await screen.findByTestId('browser-evidence-run'));
    const result = await screen.findByTestId('browser-evidence-result');
    expect(within(result).getByText('명세서와 브라우저 기록이 일치합니다.')).toBeTruthy();
    // With nothing to apply, only attaching evidence references remains.
    fireEvent.click(within(result).getByTestId('browser-evidence-apply'));
    expect((await screen.findByRole('alert')).textContent).toBe('apply failed');
    expect(screen.getByTestId('browser-evidence-result')).toBeTruthy();
  });
});
