// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StructuredDocumentRenderResponse } from '@open-design/contracts';

import { DocumentRenderActions } from '../../src/components/document-spec/DocumentRenderActions';
import { I18nProvider } from '../../src/i18n';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderActions(kind: 'interface-spec' | 'screen-spec', fatalCount = 0) {
  render(
    <I18nProvider initial="en">
      <DocumentRenderActions
        projectId="p1"
        inputFile="orders.interface-spec.json"
        kind={kind}
        dirty={false}
        fatalCount={fatalCount}
        onSave={async () => true}
      />
    </I18nProvider>,
  );
}

describe('DocumentRenderActions OpenAPI export', () => {
  it('exports interface specs through the shared render route and reports skipped items', async () => {
    const payload: StructuredDocumentRenderResponse = {
      ok: true, kind: 'interface-spec', action: 'export-openapi', inputFile: 'orders.interface-spec.json',
      outputFile: 'Orders_openapi.json', outputUrl: '/api/projects/p1/raw/Orders_openapi.json', itemCount: 2, issues: [],
      warnings: ['PUBLISH orders.created: "PUBLISH" is not an HTTP method; skipped.'],
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    renderActions('interface-spec');

    fireEvent.click(screen.getByTestId('document-export-openapi'));

    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('Started exporting Orders_openapi.json.');
    expect(status.textContent).toContain('1 item(s) could not be represented in OpenAPI');
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/p1/documents/render', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ inputFile: 'orders.interface-spec.json', action: 'export-openapi' }),
    }));
  });

  it('is disabled while fatal issues remain and absent for screen specs', () => {
    renderActions('interface-spec', 2);
    expect((screen.getByTestId('document-export-openapi') as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    renderActions('screen-spec');
    expect(screen.queryByTestId('document-export-openapi')).toBeNull();
  });
});
