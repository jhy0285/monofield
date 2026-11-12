// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INTERFACE_SPEC_CHANGE_LABELS, INTERFACE_SPEC_LEVEL_LABELS, InterfaceSpecDocumentSchema, type ProjectFile } from '@open-design/contracts';

let documentText = '';
const writes: string[] = [];

vi.mock('../../src/providers/registry', () => ({
  fetchProjectFileText: vi.fn(async () => documentText),
  writeProjectTextFileDetailed: vi.fn(async (_project: string, _path: string, text: string) => {
    writes.push(text);
    return { ok: true };
  }),
}));
vi.mock('../../src/components/document-spec/JudgmentCheckPanel', () => ({ JudgmentCheckPanel: () => null }));
vi.mock('../../src/components/document-spec/BrowserEvidencePanel', () => ({ BrowserEvidencePanel: () => null }));
vi.mock('../../src/components/document-spec/DocumentDependencyPanel', () => ({ DocumentDependencyPanel: () => null }));
vi.mock('../../src/components/document-spec/DocumentRenderActions', () => ({ DocumentRenderActions: () => null }));
vi.mock('../../src/components/document-spec/DocumentImpactPanel', () => ({
  DocumentImpactPanel: () => null,
  documentContentHash: async () => 'hash',
}));

import { InterfaceSpecEditor } from '../../src/components/interface-spec/InterfaceSpecEditor';
import { en } from '../../src/i18n/locales/en';
import { ko } from '../../src/i18n/locales/ko';
import { I18nProvider } from '../../src/i18n';

const file = { name: 'docs/payments.interface-spec.json', path: 'docs/payments.interface-spec.json', mtime: 1, size: 1, kind: 'file' } as unknown as ProjectFile;

function scanned(endpoint: Record<string, unknown>) {
  return JSON.stringify(InterfaceSpecDocumentSchema.parse({
    schemaVersion: 1,
    kind: 'interface-spec',
    source: { codebaseName: 'payments', collector: 'static-spring' },
    auth: { type: 'bearer' },
    endpoints: [{ method: 'GET', path: '/payments', interfaceName: '결제 목록', authRequired: true, responseFields: [], ...endpoint }],
  }));
}

afterEach(() => {
  cleanup();
  writes.length = 0;
});

describe('InterfaceSpecEditor scanner facts', () => {
  it('shows enum values, the request default and who may call', async () => {
    documentText = scanned({
      authorities: ['ROLE_ADMIN', 'SCOPE_payments.read'],
      requestFields: [
        { nameEn: 'status', dataType: 'PaymentStatus', required: 'N', note: 'request param', enumValues: ['PAID', 'REFUNDED'] },
        { nameEn: 'size', dataType: 'int', required: 'N', note: 'request param', defaultValue: '20' },
      ],
    });
    render(<I18nProvider initial="ko"><InterfaceSpecEditor projectId="p1" file={file} /></I18nProvider>);
    await waitFor(() => screen.getByText('허용값: PAID, REFUNDED'));
    expect(screen.getByText('기본값: 20')).toBeTruthy();
    expect(screen.getByTestId('endpoint-authorities').textContent).toBe('필요 권한(이 중 하나): ROLE_ADMIN, SCOPE_payments.read');
    // The hint stays outside the label, so the select keeps its plain name.
    expect((screen.getByLabelText('인증') as HTMLSelectElement).value).toBe('bearer');
  });

  it('shows a rule it could not reduce to authorities as written', async () => {
    documentText = scanned({ accessRule: "hasRole('ADMIN') and #id == principal.id", requestFields: [] });
    render(<I18nProvider initial="en"><InterfaceSpecEditor projectId="p1" file={file} /></I18nProvider>);
    await waitFor(() => screen.getByTestId('endpoint-access-rule'));
    expect(screen.getByTestId('endpoint-access-rule').textContent).toBe("Access rule: hasRole('ADMIN') and #id == principal.id");
  });

  it('keeps the scanner facts when a reviewer edits the same row', async () => {
    documentText = scanned({
      authorities: ['ROLE_ADMIN'],
      requestFields: [{ nameEn: 'status', dataType: 'PaymentStatus', required: 'N', note: 'request param', enumValues: ['PAID'], defaultValue: 'PAID' }],
    });
    render(<I18nProvider initial="ko"><InterfaceSpecEditor projectId="p1" file={file} /></I18nProvider>);
    const english = await waitFor(() => screen.getByLabelText('REQUEST 1 영문명'));
    const korean = english.closest('tr')!.querySelectorAll('input')[1]!;
    fireEvent.change(korean, { target: { value: '결제 상태' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(writes.length).toBeGreaterThan(0));
    const saved = JSON.parse(writes.at(-1)!);
    expect(saved.endpoints[0].authorities).toEqual(['ROLE_ADMIN']);
    expect(saved.endpoints[0].requestFields[0]).toMatchObject({ nameKo: '결제 상태', enumValues: ['PAID'], defaultValue: 'PAID' });
  });
});

// Every change the comparison can report has a label in the impact panel (a new code without one shows its raw key),
// and the CLI report (`monofield docs check`) uses the same Korean and English words as the screen.
describe('change labels', () => {
  it('names every change code and level the same way on screen and in the CLI report', () => {
    for (const [code, label] of Object.entries(INTERFACE_SPEC_CHANGE_LABELS)) {
      const key = `docs.impact.compat.${code}` as keyof typeof en;
      expect(en[key], code).toBe(label.en);
      expect(ko[key], code).toBe(label.ko);
    }
    for (const [level, label] of Object.entries(INTERFACE_SPEC_LEVEL_LABELS)) {
      const key = `docs.impact.compat.level.${level}` as keyof typeof en;
      expect(en[key], level).toBe(label.en);
      expect(ko[key], level).toBe(label.ko);
    }
  });
});
