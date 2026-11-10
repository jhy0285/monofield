// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InterfaceSpecDocumentSchema, type ProjectFile } from '@open-design/contracts';

let documentText = '';

vi.mock('../../src/providers/registry', () => ({
  fetchProjectFileText: vi.fn(async () => documentText),
  writeProjectTextFileDetailed: vi.fn(async () => ({ ok: true })),
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
import { I18nProvider } from '../../src/i18n';

// What the Spring scanner writes: the scheme once for the document, `authRequired` per endpoint.
function scannedDocument(endpoint: Record<string, unknown>) {
  return JSON.stringify(InterfaceSpecDocumentSchema.parse({
    schemaVersion: 1,
    kind: 'interface-spec',
    source: { codebaseName: 'legacy-order', collector: 'static-spring' },
    auth: { type: 'bearer', valueFormat: 'Bearer {accessToken}' },
    endpoints: [{ method: 'POST', path: '/api/v1/orders', interfaceName: '주문 등록', requestFields: [], responseFields: [], ...endpoint }],
  }));
}

const file = { name: 'docs/orders.interface-spec.json', path: 'docs/orders.interface-spec.json', mtime: 1, size: 1, kind: 'file' } as unknown as ProjectFile;

async function authSelect(locale: 'ko' | 'en' = 'ko') {
  render(<I18nProvider initial={locale}><InterfaceSpecEditor projectId="p1" file={file} /></I18nProvider>);
  const label = locale === 'ko' ? '인증' : 'Authentication';
  return await waitFor(() => screen.getByLabelText(label) as HTMLSelectElement);
}

afterEach(() => cleanup());

describe('InterfaceSpecEditor auth field', () => {
  it('shows the document-level scheme for an endpoint that requires login and has no scheme of its own', async () => {
    documentText = scannedDocument({ authRequired: true });
    const select = await authSelect();
    expect(select.value).toBe('bearer');
    expect(select.selectedOptions[0]!.textContent).toBe('Bearer 토큰 (문서 공통)');
  });

  it('names every choice in the reader’s language instead of the raw schema values', async () => {
    documentText = scannedDocument({ authRequired: true });
    const select = await authSelect();
    const labels = [...select.options].map((option) => option.textContent);
    expect(labels).toEqual(['확인 필요', '인증 없음', 'Bearer 토큰 (문서 공통)', 'API 키', '세션 쿠키', '기타']);
    expect(labels).not.toContain('undecided');
  });

  it('keeps an endpoint-level undecided scheme as needing review, and no login as none', async () => {
    documentText = scannedDocument({ authRequired: true, auth: { type: 'undecided' } });
    expect((await authSelect()).selectedOptions[0]!.textContent).toBe('확인 필요');
    cleanup();
    documentText = scannedDocument({ authRequired: false });
    expect((await authSelect()).selectedOptions[0]!.textContent).toBe('인증 없음');
  });

  it('choosing the document scheme again drops the endpoint override instead of copying it', async () => {
    documentText = scannedDocument({ authRequired: true });
    const select = await authSelect();
    fireEvent.change(select, { target: { value: 'api-key' } });
    expect(select.selectedOptions[0]!.textContent).toBe('API 키');
    fireEvent.change(select, { target: { value: 'bearer' } });
    expect(select.selectedOptions[0]!.textContent).toBe('Bearer 토큰 (문서 공통)');
  });

  it('uses English labels in English', async () => {
    documentText = scannedDocument({ authRequired: true });
    const select = await authSelect('en');
    expect(select.selectedOptions[0]!.textContent).toBe('Bearer token (document default)');
  });
});
