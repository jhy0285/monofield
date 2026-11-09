import { describe, expect, it } from 'vitest';
import {
  REFERENCE_APPLY_RULES,
  normalizeReferenceOutline,
  normalizeReferenceTakes,
  referenceApplyBlock,
  referenceOutlineLines,
  sanitizeReferenceUrl,
  type ReferenceItem,
} from '../src/api/references';

const ITEM: ReferenceItem = {
  id: 'ref-1', url: 'https://example.com/join', title: 'Join', note: '단계가 짧아서 좋음', takes: ['structure', 'fields'],
  screenshot: { file: 'references/ref-1.png', sha256: 'a'.repeat(64), bytes: 10, mediaType: 'image/png' },
  outline: {
    regions: ['header', 'main', 'footer'], headings: [{ level: 1, count: 1 }, { level: 2, count: 2 }],
    forms: [{ fields: [{ type: 'email', label: '이메일', required: true }, { type: 'password', label: '비밀번호', required: true }], buttons: 1 }],
    tables: [], controls: { links: 4, buttons: 1, inputs: 2, images: 1 }, viewport: { width: 1280, height: 720 },
  },
  capturedAt: '2026-11-06T00:00:00.000Z', source: 'browser',
};

describe('reference URLs', () => {
  it('keeps http(s) only and removes credentials, fragments and secret-looking query values', () => {
    expect(sanitizeReferenceUrl('https://user:pw@shop.example/p?id=3&token=abc&SessionKey=x#top'))
      .toBe('https://shop.example/p?id=3&token=%5Bredacted%5D&SessionKey=%5Bredacted%5D');
    expect(sanitizeReferenceUrl('file:///etc/passwd')).toBeNull();
    expect(sanitizeReferenceUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeReferenceUrl('not a url')).toBeNull();
  });
});

describe('reference outline', () => {
  it('keeps only the known shape from an untrusted page script, clipped', () => {
    const outline = normalizeReferenceOutline({
      regions: ['header', 'script', 'MAIN', 'footer', 42],
      headings: [{ level: 2, count: 3 }, { level: 9, count: 1 }, { level: 1, count: 0 }, { level: 2, count: 7 }],
      forms: [{ fields: [{ type: 'e mail<script>', label: 'x'.repeat(200), required: 'yes' }], buttons: 2.7 }],
      tables: [{ columns: Array.from({ length: 40 }, (_, i) => `c${i}`), rows: -3 }],
      controls: { links: 'many', buttons: 3 },
      viewport: { width: 0, height: 10 },
      bodyText: 'should not survive',
    });
    expect(outline).toEqual({
      regions: ['header', 'main', 'footer'],
      headings: [{ level: 2, count: 3 }],
      forms: [{ fields: [{ type: 'text', label: 'x'.repeat(60), required: false }], buttons: 2 }],
      tables: [{ columns: Array.from({ length: 16 }, (_, i) => `c${i}`), rows: 0 }],
      controls: { links: 0, buttons: 3, inputs: 0, images: 0 },
      viewport: null,
    });
    expect(normalizeReferenceOutline('nope')).toBeNull();
  });

  it('defaults the takes to structure and keeps their canonical order', () => {
    expect(normalizeReferenceTakes(undefined)).toEqual(['structure']);
    expect(normalizeReferenceTakes('fields, flow ,copy')).toEqual(['flow', 'fields']);
  });
});

describe('reference apply block', () => {
  it('carries the request, target, rules and each reference, and nothing from the page beyond the outline', () => {
    const block = referenceApplyBlock([{ ...ITEM, screenshotState: 'verified' }], { target: 'src/pages/Join.tsx', request: '회원가입 화면을 이 흐름으로 바꿔줘' });
    expect(block.startsWith('<reference-board-apply target="src/pages/Join.tsx" references="1">')).toBe(true);
    expect(block).toContain('request: 회원가입 화면을 이 흐름으로 바꿔줘');
    for (const rule of REFERENCE_APPLY_RULES) expect(block).toContain(`- ${rule}`);
    expect(block).toContain('<reference id="ref-1" url="https://example.com/join" captured="2026-11-06T00:00:00.000Z">');
    expect(block).toContain('note: 단계가 짧아서 좋음');
    expect(block).toContain('take: layout structure');
    expect(block).toContain('screenshot: references/ref-1.png (sha256 verified) — layout reference only');
    expect(block).toContain('form 1: email "이메일" (required), password "비밀번호" (required); 1 button');
    expect(block.trimEnd().endsWith('</reference-board-apply>')).toBe(true);
  });

  it('says when a screenshot changed or is missing, and leaves it out on request', () => {
    expect(referenceApplyBlock([{ ...ITEM, screenshotState: 'changed' }])).toContain('changed since it was kept');
    expect(referenceApplyBlock([{ ...ITEM, screenshotState: 'missing' }])).toContain('(missing)');
    expect(referenceApplyBlock([ITEM], { includeScreenshot: false })).not.toContain('screenshot:');
    expect(referenceApplyBlock([{ ...ITEM, outline: null }], { takes: ['flow'] })).toMatch(/take: flow[\s\S]*outline: not captured/);
  });

  it('cannot be broken out of by a title, URL or target', () => {
    const block = referenceApplyBlock([{ ...ITEM, id: 'x"><reference id="y', title: 'T' }], { target: 'a">\n</reference-board-apply>' });
    expect(block.match(/<\/reference-board-apply>/g)).toHaveLength(1);
    expect(block).not.toContain('id="x"><reference');
  });

  it('prints outlines as short lines', () => {
    expect(referenceOutlineLines(ITEM.outline!)).toEqual([
      'viewport: 1280×720', 'regions: header > main > footer', 'headings: h1×1, h2×2',
      'form 1: email "이메일" (required), password "비밀번호" (required); 1 button', 'controls: 4 links, 1 buttons, 2 inputs, 1 images',
    ]);
  });
});

describe('reference flows', () => {
  it('validates steps and refuses credential fields', async () => {
    const { normalizeReferenceFlowSteps } = await import('../src/api/references');
    expect(normalizeReferenceFlowSteps(undefined)).toEqual({ ok: true, steps: [] });
    expect(normalizeReferenceFlowSteps([{ kind: 'click', target: '  조회 ' }, { kind: 'fill', target: '이메일', value: 'a@b.c' }, { kind: 'wait', ms: 1500.4 }, { kind: 'wait-text', target: '2건' }]))
      .toEqual({ ok: true, steps: [{ kind: 'click', target: '조회', role: 'button' }, { kind: 'fill', target: '이메일', value: 'a@b.c' }, { kind: 'wait', ms: 1500 }, { kind: 'wait-text', target: '2건' }] });
    for (const label of ['비밀번호', 'Password', '인증번호', '카드 번호', 'CVC', 'otp']) {
      expect(normalizeReferenceFlowSteps([{ kind: 'fill', target: label, value: 'x' }])).toMatchObject({ ok: false, error: expect.stringContaining('does not type') });
    }
    expect(normalizeReferenceFlowSteps([{ kind: 'wait', ms: 60_000 }]).ok).toBe(false);
    expect(normalizeReferenceFlowSteps([{ kind: 'click', target: 'x', role: 'iframe' }]).ok).toBe(false);
    expect(normalizeReferenceFlowSteps(Array.from({ length: 13 }, () => ({ kind: 'wait', ms: 200 }))).ok).toBe(false);
  });

  it('builds a REA scenario with a fresh profile, per-step deadlines and network capture', async () => {
    const { referenceFlowScenario } = await import('../src/api/references');
    const scenario = referenceFlowScenario('https://a.example/orders', [{ kind: 'click', target: '조회', role: 'button' }, { kind: 'fill', target: '주문번호', value: '1001' }, { kind: 'wait-text', target: '결과 "1"건' }], '/usr/bin/chromium');
    expect(scenario).toMatchObject({
      browser: { mode: 'launch', executable_path: '/usr/bin/chromium', headless: true },
      start_url: { url: 'https://a.example/orders', query: [] },
      actions: [
        { step_id: 'step-1', action: 'click', locator: { kind: 'role', role: 'button', name: '조회' }, timeout_ms: 10_000 },
        { step_id: 'step-2', action: 'fill', locator: { kind: 'role', role: 'textbox', name: '주문번호' }, value: { source: 'literal', value: '1001' } },
        { step_id: 'step-3', action: 'wait_for', locator: { kind: 'css', selector: 'text="결과 \\"1\\"건"' }, state: 'visible' },
      ],
      capture: { after_each_step: ['screenshot', 'accessibility'], events: ['network', 'page-errors'], network: { response_body: true, header_values: false } },
    });
    expect(scenario).not.toHaveProperty('storage');
    expect(scenario).not.toHaveProperty('secrets');
    expect((referenceFlowScenario('https://a.example', [], '/b') as { actions: unknown[] }).actions).toEqual([{ step_id: 'page-settled', action: 'wait_for_timeout', duration_ms: 1500 }]);
  });

  it('puts the flow into the apply block and writes an agent request with the same rules', async () => {
    const { referenceApplyBlock, referenceFlowAgentRequest } = await import('../src/api/references');
    const flow = { file: 'references/ref-1.flow.json', evidenceId: 'ev_1', sha256: 'b'.repeat(64), recordedAt: '2026-11-06T00:00:00.000Z', browser: 'chrome',
      steps: [{ id: 'step-1', label: 'press button "조회"', status: 'completed' }], completed: 1, total: 1,
      apiCalls: [{ method: 'GET', path: '/api/orders', status: 200 }], completeness: 'incomplete' };
    const block = referenceApplyBlock([{ ...ITEM, flow }]);
    expect(block).toContain('flow: references/ref-1.flow.json (REA evidence ev_1, 1/1 steps, capture incomplete)');
    expect(block).toContain('  1. press button "조회" → completed');
    expect(block).toContain('api: GET /api/orders → 200');
    const request = referenceFlowAgentRequest(ITEM, [{ kind: 'click', target: '다음', role: 'button' }], '가입 흐름');
    expect(request).toContain('<reference-flow-request id="ref-1" url="https://example.com/join">');
    expect(request).toContain('capture_browser_scenario');
    expect(request).toContain('references/ref-1.flow.json');
    expect(request).toContain('Do not sign in');
    expect(request).toContain('1. press button "다음"');
  });
});

describe('comparing our screen with a reference flow', () => {
  type View = import('../src/api/rea-evidence').ReaBrowserView;
  const a11y = (text: string) => ({ state: 'captured' as const, mediaType: 'text/plain', bytes: text.length, sha256: null, redacted: false, text });
  const view = (steps: Array<{ id: string; action: string; status?: string; url: string; roles: string }>, calls: Array<{ step: number; method: string; status: number | null }>): View => ({
    kind: 'browser', origin: null, durationMs: null, droppedEvents: 0, captured: { requestBodies: true, responseBodies: true },
    completeness: { status: 'complete', missingSections: [], truncatedSections: [] },
    steps: steps.map((step, index) => ({ index, id: step.id, action: step.action, status: step.status ?? 'completed', elapsedMs: 1, url: step.url, eventStart: 0, eventEnd: 0, error: null, accessibility: a11y(step.roles) })),
    requests: calls.map((call, index) => ({ id: `r${index}`, stepIndex: call.step, method: call.method, origin: null, path: `/x/${index}`, queryNames: [], resourceType: 'fetch', status: call.status, isApi: true,
      request: { state: 'not_exposed', mediaType: null, bytes: null, sha256: null, redacted: false }, response: { state: 'not_exposed', mediaType: null, bytes: null, sha256: null, redacted: false } })),
  } as View);

  it('reads element kinds from an accessibility snapshot without their names', async () => {
    const { accessibilityRoles } = await import('../src/api/references');
    expect(accessibilityRoles('- document:\n  - main:\n    - heading "주문" [level=1]\n    - button "조회"\n    - paragraph\n    - table:\n      - row "a"')).toEqual(['button', 'heading', 'main', 'row', 'table']);
  });

  it('compares steps as patterns: outcome, page move, call kinds and element kinds, not text or paths', async () => {
    const { compareReferenceFlows, referenceComparisonBlock, referenceComparisonLines } = await import('../src/api/references');
    const reference = view([
      { id: 'scenario_start', action: 'goto_start', url: 'https://shop.example/orders', roles: '- main:\n  - button "Search"' },
      { id: 'step-1', action: 'click', url: 'https://shop.example/orders', roles: '- main:\n  - button "Search"\n  - table:\n    - row "1"' },
      { id: 'step-2', action: 'click', url: 'https://shop.example/orders/1', roles: '- main:\n  - heading "Order"' },
    ], [{ step: 1, method: 'GET', status: 200 }]);
    const same = view([
      { id: 'scenario_start', action: 'goto_start', url: 'http://localhost:8080/orders', roles: '- main:\n  - button "조회"' },
      { id: 'step-1', action: 'click', url: 'http://localhost:8080/orders', roles: '- main:\n  - button "조회"\n  - table:\n    - row "가"' },
      { id: 'step-2', action: 'click', url: 'http://localhost:8080/orders/9', roles: '- main:\n  - heading "주문"' },
    ], [{ step: 1, method: 'GET', status: 204 }]);
    expect(compareReferenceFlows(reference, same).summary).toEqual({ pass: 3, fail: 0, missing: 0, extra: 0, total: 3 });

    const ours = view([
      { id: 'scenario_start', action: 'goto_start', url: 'http://localhost:8080/orders', roles: '- main:\n  - button "조회"' },
      { id: 'step-1', action: 'click', url: 'http://localhost:8080/orders', roles: '- main:\n  - button "조회"\n  - list:\n    - listitem "가"' },
      { id: 'step-2', action: 'click', status: 'failed', url: 'http://localhost:8080/orders', roles: '- main:\n  - button "조회"' },
    ], [{ step: 1, method: 'POST', status: 500 }]);
    const result = compareReferenceFlows(reference, ours, { 'step-1': 'press button "Search"' });
    expect(result.summary).toEqual({ pass: 1, fail: 2, missing: 0, extra: 0, total: 3 });
    expect(result.rows[1]).toMatchObject({ label: 'press button "Search"', verdict: 'fail', differences: ['calls', 'structure'],
      reference: { calls: ['GET 2xx'] }, ours: { calls: ['POST 5xx'] }, onlyReference: ['row', 'table'], onlyOurs: ['list', 'listitem'] });
    expect(result.rows[2]).toMatchObject({ differences: ['status', 'navigation', 'structure'], reference: { navigated: true }, ours: { navigated: false, status: 'failed' } });

    const item = { ...ITEM, flow: { file: 'references/ref-1.flow.json' } as never, remake: { url: 'http://localhost:8080/orders', flow: { file: 'references/ref-1.remake.flow.json' } as never, comparison: result, comparedAt: '' } };
    expect(referenceComparisonLines(item.remake)[0]).toContain('1/3 steps match');
    const block = referenceComparisonBlock(item);
    expect(block).toContain('<reference-flow-comparison id="ref-1"');
    expect(block).toContain('reference: completed, GET 2xx');
    expect(block).toContain('ours:      completed, POST 5xx');
    expect(block).toContain('only on the reference\'s screen: row, table');
    expect(block).toContain('Do not copy text, images');
    expect(referenceComparisonBlock({ ...item, remake: { ...item.remake, comparison: compareReferenceFlows(reference, same) } })).toBe('');
  });

  it('marks steps one side did not record', async () => {
    const { compareReferenceFlows } = await import('../src/api/references');
    const two = view([{ id: 'scenario_start', action: 'goto_start', url: 'https://a/x', roles: '' }, { id: 'step-1', action: 'click', url: 'https://a/x', roles: '' }], []);
    const one = view([{ id: 'scenario_start', action: 'goto_start', url: 'https://b/x', roles: '' }], []);
    expect(compareReferenceFlows(two, one).rows.map((row) => row.verdict)).toEqual(['pass', 'missing']);
    expect(compareReferenceFlows(one, two).rows.map((row) => row.verdict)).toEqual(['pass', 'extra']);
  });
});
