import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from '@/playwright/suite';
import { T } from '@/timeouts';

// A minimal REA `capture_browser_scenario` result: the transactions the daemon
// decodes (request/response events and their network-content bodies).
function capture(calls: Array<{ method: string; path: string; status: number; response: unknown }>) {
  const origin = 'http://127.0.0.1:4318';
  const body = (value: unknown) => {
    const bytes = Buffer.from(JSON.stringify(value));
    return { state: 'captured', media_type: 'application/json', content: bytes.toString('base64'), bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), redacted: false };
  };
  const items: Array<Record<string, unknown>> = [];
  calls.forEach((call, index) => {
    const id = `request-${index + 1}`;
    const url = { url: `${origin}${call.path}`, origin, query_parameter_names: [] };
    const sequence = items.length + 1;
    items.push(
      { sequence, kind: 'request', transaction_id: id, method: call.method, url, resource_type: 'fetch', step_index: 1 },
      { sequence: sequence + 1, kind: 'network-content', phase: 'request', transaction_id: id, source_event_sequence: sequence, body: { state: 'not_exposed' } },
      { sequence: sequence + 2, kind: 'response', transaction_id: id, method: call.method, url, status: call.status, resource_type: 'fetch', step_index: 1 },
      { sequence: sequence + 3, kind: 'network-content', phase: 'response', transaction_id: id, source_event_sequence: sequence + 2, body: body(call.response) },
    );
  });
  return {
    evidence_id: 'ev_synthetic_orders',
    predicate_type: 'rea.browser-scenario-capture',
    normalized_result: {
      steps: [{ step_index: 1, step_id: 'open-orders', status: 'completed' }],
      events: { items, dropped: 0 },
      scenario: { start_origin: origin, network_content: { request_body: false, response_body: true } },
      completeness: { status: 'complete', missing_sections: [], truncated_sections: [] },
      limitations: [],
    },
  };
}

test('[P1] compares an REA browser capture with an interface spec and applies the findings for review', async ({ page }, testInfo) => {
  test.setTimeout(2 * T.xlong);
  const projectId = randomUUID();
  const created = await page.request.post('/api/projects', { data: { id: projectId, name: 'Browser evidence' } });
  expect(created.ok()).toBeTruthy();
  const config = { mode: 'daemon', onboardingCompleted: true, privacyDecisionAt: 1,
    telemetry: { metrics: false, content: false, artifactManifest: false }, skillId: null, designSystemId: null };
  await page.request.put('/api/app-config', { data: config });
  await page.addInitScript((saved) => {
    localStorage.setItem('open-design:config', JSON.stringify(saved));
    localStorage.setItem('open-design:locale', 'en');
    localStorage.setItem('open-design:locale-source', 'manual');
  }, config);

  // The spec lacks the fee field, names the net amount differently and has not heard of the second endpoint.
  const doc = { schemaVersion: 1, kind: 'interface-spec', cover: { docName: 'Orders' }, source: { codebaseName: 'Orders' }, endpoints: [{
    method: 'POST', path: '/api/orders/{id}/settle', interfaceId: 'IF-001', interfaceName: 'Settle order', note: '',
    responseFields: [{ nameEn: 'settlement_id', dataType: 'Integer', required: 'Y' }, { nameEn: 'netAmount', dataType: 'Integer', required: 'Y' }],
  }] };
  const upload = async (name: string, content: unknown, artifactManifest?: unknown) => {
    const response = await page.request.post(`/api/projects/${projectId}/files`, { data: { name, content: JSON.stringify(content), ...(artifactManifest ? { artifactManifest } : {}) } });
    expect(response.ok()).toBeTruthy();
  };
  await upload('orders.interface-spec.json', doc, { version: 1, kind: 'interface-spec', renderer: 'interface-spec', entry: 'orders.interface-spec.json', title: 'Orders', status: 'complete', exports: ['xlsx'] });
  await upload('evidence/capture.json', capture([
    { method: 'POST', path: '/api/orders/1001/settle', status: 201, response: { settlement_id: 7, fee_amount: 30, net_amount: 970 } },
    { method: 'GET', path: '/api/settlements', status: 200, response: [{ id: 1, order_id: 1001 }] },
  ]));

  await page.goto(`/projects/${projectId}/files/orders.interface-spec.json`);
  const panel = page.getByTestId('browser-evidence');
  await expect(panel.getByRole('heading', { name: 'Browser evidence check (REA)' })).toBeVisible({ timeout: 60_000 });
  await expect(panel.getByText('evidence/capture.json')).toBeVisible();

  await panel.getByRole('button', { name: 'Compare with evidence' }).click();
  const result = panel.getByTestId('browser-evidence-result');
  await expect(result).toContainText('2 API calls · 1/1 endpoints exercised · 1 not in the specification');
  await expect(result).toContainText('Endpoint not in the specification');
  await expect(result).toContainText('Field not in the specification');
  await expect(result).toContainText('Field name differs');
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('browser-evidence.png'), fullPage: true });

  // Applying hands the changes to the editor; nothing is saved until the reviewer saves.
  await result.getByRole('button', { name: /Apply \d+ selected to the editor/ }).click();
  await expect(panel.getByTestId('browser-evidence-applied')).toContainText('1 endpoints, 3 fields, 1 renamed');
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeEnabled();
  const before = await page.request.get(`/api/projects/${projectId}/files/orders.interface-spec.json`);
  expect(JSON.parse(await before.text()).endpoints).toHaveLength(1);

  await save.click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();
  const after = JSON.parse(await (await page.request.get(`/api/projects/${projectId}/files/orders.interface-spec.json`)).text()) as { endpoints: Array<{ path: string; responseFields: Array<{ nameEn: string; nameKo: string; reviewStatus?: string }> }> };
  expect(after.endpoints.map((endpoint) => endpoint.path)).toEqual(['/api/orders/{id}/settle', '/api/settlements']);
  const settle = after.endpoints[0]!.responseFields;
  expect(settle.map((field) => field.nameEn)).toEqual(['settlement_id', 'net_amount', 'fee_amount']);
  // Added rows wait for a Korean label and a reviewer.
  expect(settle.find((field) => field.nameEn === 'fee_amount')).toMatchObject({ nameKo: '', reviewStatus: 'unreviewed' });

  // Compared again after saving, the spec agrees with the capture.
  await panel.getByRole('button', { name: 'Compare with evidence' }).click();
  await expect(panel.getByTestId('browser-evidence-result')).toContainText('0 errors · 0 warnings');
});
