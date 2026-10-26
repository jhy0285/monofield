// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compareInterfaceSpecDocuments,
  InterfaceSpecDocumentSchema,
  type DocumentImpactResponse,
  type DocumentProposalResponse,
} from '@open-design/contracts';

vi.mock('../../src/providers/registry', () => ({
  fetchProjectFileText: vi.fn(async () => ORIGINAL_TEXT),
}));

import { DocumentImpactPanel, documentContentHash } from '../../src/components/document-spec/DocumentImpactPanel';
import { I18nProvider } from '../../src/i18n';

const original = InterfaceSpecDocumentSchema.parse({
  schemaVersion: 1,
  kind: 'interface-spec',
  source: { codebaseName: 'Orders' },
  endpoints: [{
    method: 'POST', path: '/api/orders', interfaceId: 'IF-ORD-001',
    requestFields: [{ nameEn: 'memberId', dataType: 'Long', required: 'Y' }],
    responseFields: [{ nameEn: 'orderId', dataType: 'Long', required: 'Y' }, { nameEn: 'status', dataType: 'String', required: 'Y' }],
  }],
});
const ORIGINAL_TEXT = JSON.stringify(original, null, 2);

const revised = InterfaceSpecDocumentSchema.parse({
  ...original,
  endpoints: [{
    ...original.endpoints[0],
    requestFields: [...original.endpoints[0]!.requestFields, { nameEn: 'channel', dataType: 'String', required: 'Y' }],
    responseFields: [original.endpoints[0]!.responseFields[0]],
  }],
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderAndReview() {
  const sha = await documentContentHash(ORIGINAL_TEXT);
  const impact: DocumentImpactResponse = {
    ok: true, inputFile: 'orders.json', contentSha256: sha, repository: true, baselineRevision: 'a', headRevision: 'b',
    changedFiles: ['OrderController.java'], affected: [{ endpointIndex: 0, endpointId: 'IF-ORD-001', title: '주문 등록', changedFiles: ['OrderController.java'] }],
    untrackedEndpointIndexes: [], proposalFile: 'orders.proposed.json', updatePrompt: 'update', analyzedAt: '2026-10-22T00:00:00Z',
  };
  const proposal: DocumentProposalResponse = {
    ok: true, inputFile: 'orders.json', proposalFile: 'orders.proposed.json', contentSha256: sha, format: 'changes',
    changesApplied: 2, compatibility: compareInterfaceSpecDocuments(original, revised), document: revised,
  };
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
    const body = String(url).endsWith('/documents/impact') ? impact : proposal;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  render(
    <I18nProvider initial="en">
      <DocumentImpactPanel projectId="p1" inputFile="orders.json" doc={original} dirty={false} onApplyProposal={() => undefined} />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Analyze Git changes' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Review AI proposal' }));
  return screen.findByTestId('document-impact-compatibility');
}

describe('DocumentImpactPanel caller compatibility', () => {
  it('summarizes breaking proposal changes before the field table', async () => {
    const summary = await renderAndReview();
    expect(summary.getAttribute('data-level')).toBe('breaking');
    expect(summary.textContent).toContain('Caller compatibility');
    expect(summary.textContent).toContain('2 breaking · 0 to review · 0 additive');
    const items = within(summary).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Required request field added'),
      expect.stringContaining('Response field removed'),
    ]);
    expect(items[0]!.textContent).toContain('IF-ORD-001 · POST /api/orders · channel');
    expect(items[1]!.textContent).toContain('IF-ORD-001 · POST /api/orders · status');
  });

  it('clears the summary after the reviewed proposal is applied', async () => {
    await renderAndReview();
    fireEvent.click(screen.getByRole('button', { name: /Apply reviewed proposal/i }));
    await waitFor(() => expect(screen.queryByTestId('document-impact-compatibility')).toBeNull());
  });
});
