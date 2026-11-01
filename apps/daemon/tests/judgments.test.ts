import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseInterfaceSpecDocument, type InterfaceSpecDocument, type JevResponse } from '@open-design/contracts';
import { evaluateJevStates, writeJevConfig } from '../src/integrations/jev.js';
import { exportJudgmentDataset, judgmentScorecard, readJudgmentLabels, recordJudgmentFeedback, runJudgmentCheck, setJudgmentPolicy } from '../src/services/judgments.js';

const spec = (): InterfaceSpecDocument => {
  const parsed = parseInterfaceSpecDocument({
    schemaVersion: 1, kind: 'interface-spec', cover: { brand: '', docName: '', version: '', department: '' },
    source: { codebaseName: 'legacy-order', codebasePath: 'legacy-order', language: 'java', framework: 'spring-boot', collector: 'static-spring' },
    endpoints: [
      { method: 'POST', path: '/api/v1/orders', interfaceId: 'IF-ORD-001', interfaceName: '주문 등록',
        requestFields: [
          { nameEn: 'memberId', nameKo: '회원 ID', dataType: 'Long', required: 'Y' },
          { nameEn: 'deliveryMemo', nameKo: '', dataType: 'String', required: 'N' },
          { nameEn: 'orderNo', nameKo: 'order No', dataType: 'String', required: 'N' },
        ],
        responseFields: [{ nameEn: 'createdAt', nameKo: '삭제일시', dataType: 'String', required: 'Y' }] },
      { method: 'GET', path: '/api/v1/orders/{orderId}', interfaceId: 'IF-ORD-002', interfaceName: '', requestFields: [], responseFields: [] },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.doc;
};
const noul = (p: number): JevResponse => ({ model: 'fixture', answers: { match: { type: 'noul', noul: p } }, usage: { input_tokens: 1, output_tokens: 0 } });

describe('judgment checks', () => {
  let dataDir: string;
  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'judgments-'));
    await writeJevConfig(dataDir, { backend: 'local', localBaseUrl: 'http://127.0.0.1:8765', model: 'multilingual' });
  });
  afterEach(async () => { await rm(dataDir, { recursive: true, force: true }); });

  it('batches states through a local server and validates every answer', async () => {
    const calls: Array<{ url: string; body: { states: unknown[] } }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url, body });
      return new Response(JSON.stringify({ results: body.states.map((_: unknown, i: number) => ({ model: 'm', answers: { match: { type: 'noul', noul: i / 10 } }, usage: { input_tokens: 3, output_tokens: 0 } })) }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await evaluateJevStates(dataDir, { model: 'multilingual', questions: { match: { type: 'noul', instructions: 'x' } },
      states: [{ a: '1' }, { a: '2' }, { a: '3' }] }, { fetchImpl, chunkSize: 2 });
    expect(calls.map((c) => [c.url, c.body.states.length])).toEqual([['http://127.0.0.1:8765/v1/systemone/batch', 2], ['http://127.0.0.1:8765/v1/systemone/batch', 1]]);
    expect(result.calls).toBe(2);
    expect(result.results.map((r) => (r.answers.match as { noul: number }).noul)).toEqual([0, 0.1, 0]);
  });

  it('refuses a batch response of the wrong length', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ results: [] }), { status: 200 })) as unknown as typeof fetch;
    await expect(evaluateJevStates(dataDir, { model: 'm', questions: { match: { type: 'noul' } }, states: [{ a: '1' }] }, { fetchImpl }))
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('asks hosted JEV one state per request', async () => {
    await writeJevConfig(dataDir, { backend: 'typesafe', localBaseUrl: 'http://127.0.0.1:8000', model: 'jev-latest' });
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => { urls.push(url); return new Response(JSON.stringify(noul(0.9)), { status: 200 }); }) as unknown as typeof fetch;
    const result = await evaluateJevStates(dataDir, { model: 'jev-latest', questions: { match: { type: 'noul' } }, states: [{ a: '1' }, { a: '2' }, { a: '3' }] },
      { fetchImpl, env: { TYPESAFE_API_KEY: 'test-key' } });
    expect(urls).toEqual(Array(3).fill('https://api.typesafe.ai/v1/systemone'));
    expect(result.calls).toBe(3);
  });

  it('decides empty and untranslated labels by rule and asks the model only the rest, in observe mode', async () => {
    const asked: unknown[][] = [];
    const evaluate = (async (_dir: string, input: { states: unknown[]; questions: Record<string, unknown> }) => {
      asked.push(input.states);
      const id = Object.keys(input.questions)[0]!;
      return { backend: 'local' as const, elapsedMs: 1, calls: 1, results: input.states.map(() => ({ model: 'm', answers: { [id]: { type: 'noul' as const, noul: 0.2 } }, usage: { input_tokens: 1, output_tokens: 0 } })) };
    }) as unknown as typeof evaluateJevStates;
    const result = await runJudgmentCheck(dataDir, { doc: spec(), inputFile: 'docs/orders.interface-spec.json', contentSha256: 'a'.repeat(64), evaluate });
    const byId = Object.fromEntries(result.items.map((i) => [i.id, i]));
    expect(byId['field-label:POST /api/v1/orders:request:deliveryMemo']).toMatchObject({ verdict: 'flag', source: 'rule', reason: 'empty' });
    expect(byId['field-label:POST /api/v1/orders:request:orderNo']).toMatchObject({ verdict: 'flag', source: 'rule', reason: 'untranslated' });
    expect(byId['business-name:GET /api/v1/orders/{orderId}']).toMatchObject({ verdict: 'flag', source: 'rule', reason: 'empty' });
    // Observe mode: a low probability is shown, never turned into a flag.
    expect(byId['field-label:POST /api/v1/orders:response:createdAt']).toMatchObject({ verdict: 'review', source: 'model', probability: 0.2, reason: 'observe' });
    const sortJson = (values: unknown[]) => values.map((v) => JSON.stringify(v)).sort();
    expect(sortJson(asked.flat())).toEqual(sortJson([
      { method: 'POST', path: '/api/v1/orders', business_name: '주문 등록' },
      { identifier: 'memberId', korean_label: '회원 ID' },
      { identifier: 'createdAt', korean_label: '삭제일시' },
    ]));
    expect(asked.flat()).toHaveLength(3);
    expect(result.modelStatus).toBe('answered');
    expect(result.summary).toEqual({ total: 6, pass: 0, review: 3, flag: 3 });
    expect(result.policies['field-label'].mode).toBe('observe');
  });

  it('does not send items to hosted JEV without explicit permission, and survives an unavailable model', async () => {
    await writeJevConfig(dataDir, { backend: 'typesafe', localBaseUrl: 'http://127.0.0.1:8000', model: 'jev-latest' });
    let called = false;
    const evaluate = (async () => { called = true; throw new Error('should not run'); }) as unknown as typeof evaluateJevStates;
    const hosted = await runJudgmentCheck(dataDir, { doc: spec(), inputFile: 'a.json', contentSha256: 'a'.repeat(64), evaluate });
    expect(called).toBe(false);
    expect(hosted.modelStatus).toBe('hosted-not-allowed');
    await writeJevConfig(dataDir, { backend: 'local', localBaseUrl: 'http://127.0.0.1:8765', model: 'multilingual' });
    const down = await runJudgmentCheck(dataDir, { doc: spec(), inputFile: 'a.json', contentSha256: 'a'.repeat(64),
      evaluate: (async () => { throw new Error('connection refused'); }) as unknown as typeof evaluateJevStates });
    expect(down.modelStatus).toBe('unavailable');
    expect(down.items.filter((i) => i.source === 'none').every((i) => i.verdict === 'review' && i.reason === 'model-unavailable')).toBe(true);
  });

  it('turns reviewer labels into a scorecard, an applied policy and a laya-train dataset', async () => {
    // 15 correct items the model scored high, 10 incorrect ones it scored low.
    for (let i = 0; i < 25; i++) {
      const correct = i < 15;
      await recordJudgmentFeedback(dataDir, { kind: 'field-label', subject: { identifier: `field${i}`, koreanLabel: `필드${i}` },
        correct, probability: correct ? 0.8 + i / 100 : 0.05 + i / 200, backend: 'local', model: 'multilingual' });
    }
    // A later label about the same subject replaces the earlier one.
    await recordJudgmentFeedback(dataDir, { kind: 'field-label', subject: { identifier: 'field0', koreanLabel: '필드0' }, correct: true, probability: 0.81, backend: 'local', model: 'multilingual' });
    expect(await readJudgmentLabels(dataDir)).toHaveLength(25);
    const card = await judgmentScorecard(dataDir);
    const score = card.scores.find((s) => s.kind === 'field-label' && s.model === 'multilingual')!;
    expect(score).toMatchObject({ labels: 25, answered: 25, correctItems: 15, incorrectItems: 10, auc: 1, mode: 'observe' });
    expect(score.suggested).not.toBeNull();
    expect(score.suggested!.flagPrecision).toBe(1);

    await expect(setJudgmentPolicy(dataDir, { kind: 'business-name', mode: 'active' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    const applied = await setJudgmentPolicy(dataDir, { kind: 'field-label', mode: 'active' });
    expect(applied).toMatchObject({ kind: 'field-label', mode: 'active', model: 'multilingual', basedOnLabels: 25 });
    expect(JSON.parse(await readFile(path.join(dataDir, 'judgments', 'policies.json'), 'utf8'))).toBeTruthy();

    const evaluate = (async (_dir: string, input: { states: unknown[]; questions: Record<string, unknown> }) => {
      const id = Object.keys(input.questions)[0]!;
      return { backend: 'local' as const, elapsedMs: 1, calls: 1, results: input.states.map((s) => ({ model: 'm',
        answers: { [id]: { type: 'noul' as const, noul: JSON.stringify(s).includes('삭제일시') ? 0.05 : 0.97 } }, usage: { input_tokens: 1, output_tokens: 0 } })) };
    }) as unknown as typeof evaluateJevStates;
    const active = await runJudgmentCheck(dataDir, { doc: spec(), inputFile: 'a.json', contentSha256: 'a'.repeat(64), evaluate });
    const byId = Object.fromEntries(active.items.map((i) => [i.id, i]));
    expect(byId['field-label:POST /api/v1/orders:response:createdAt']).toMatchObject({ verdict: 'flag', reason: 'disagrees' });
    expect(byId['field-label:POST /api/v1/orders:request:memberId']).toMatchObject({ verdict: 'pass', reason: 'agrees' });
    // business-name stays in observe mode: no policy was applied for it.
    expect(byId['business-name:POST /api/v1/orders']).toMatchObject({ verdict: 'review', reason: 'observe' });

    const lines = (await exportJudgmentDataset(dataDir, 'field-label')).trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(25);
    expect(lines[0]).toMatchObject({ questions: { match: { type: 'noul' } }, expected: { match: expect.any(Boolean) } });
    await setJudgmentPolicy(dataDir, { kind: 'field-label', mode: 'observe' });
    expect((await judgmentScorecard(dataDir)).scores.find((s) => s.kind === 'field-label' && s.model === 'multilingual')!.mode).toBe('observe');
  });

  it('rejects malformed feedback', async () => {
    await expect(recordJudgmentFeedback(dataDir, { kind: 'field-label', subject: { identifier: '' }, correct: true, probability: null, backend: 'local', model: 'm' }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(recordJudgmentFeedback(dataDir, { kind: 'nope', subject: {}, correct: true, probability: null, backend: 'local', model: 'm' }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(recordJudgmentFeedback(dataDir, { kind: 'field-label', subject: { identifier: 'a' }, correct: true, probability: 2, backend: 'local', model: 'm' }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});
