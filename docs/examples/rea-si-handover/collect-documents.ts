import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Agent collector: reads REA Evidence only, not the fixture generator or target code.
const root = resolve(import.meta.dirname);
const read = async (name: string) => JSON.parse(await readFile(resolve(root, 'evidence', name + '.json'), 'utf8'));
const [browser, overview, schema, settlements, audit, staticSummary] = await Promise.all([
  read('browser'), read('browser-overview'), read('db-before'), read('db-settlements'), read('db-audit'), read('static-summary'),
]);
const events = browser.normalized_result.events.items;
const responses = events.filter((e: any) => e.kind === 'response' && e.url.url.includes('/api/')).map((e: any) => {
  const content = events.find((x: any) => x.kind === 'network-content' && x.phase === 'response' && x.source_event_sequence === e.sequence);
  assert.equal(content?.body.state, 'captured');
  const bytes = Buffer.from(content.body.content, 'base64');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), content.body.sha256);
  return { ...e, body: JSON.parse(bytes.toString('utf8')), contentSequence: content.sequence };
});
const response = (id: string) => { const r = responses.find((r: any) => r.transaction_id === id); assert.ok(r); return r; };
assert.equal(browser.normalized_result.scenario.action_count, 11);
assert.ok(browser.normalized_result.steps.every((s: any) => s.status === 'completed'));
assert.equal(response('request-3').body.length, 4);
assert.deepEqual(response('request-4').body, { settlement_id: 1, order_id: 1001, gross_amount: 10001, fee_amount: 351, net_amount: 9650 });
assert.equal(response('request-4').status, 201);
assert.deepEqual(response('request-5').body, { code: 'ALREADY_SETTLED' });
assert.deepEqual(response('request-6').body, { code: 'ORDER_NOT_PAID', status: 'PENDING' });
assert.deepEqual(response('request-7').body, { code: 'ORDER_NOT_PAID', status: 'CANCELLED' });
for (const id of ['request-5', 'request-6', 'request-7']) assert.equal(response(id).status, 409);
for (const [step, id] of [['paid-settlement-result', 'request-4'], ['duplicate-settlement-result', 'request-5'], ['pending-rejected-result', 'request-6'], ['cancelled-rejected-result', 'request-7']]) {
  const dom = browser.normalized_result.steps.find((s: any) => s.step_id === step).artifacts.dom.value.text;
  const text = dom.match(/<pre id="result"[^>]*>([\s\S]*?)<\/pre>/)?.[1]; assert.ok(text);
  const r = response(id); assert.deepEqual(JSON.parse(text), { http_status: r.status, ...r.body });
}
const rows = (e: any) => e.normalized_result.rows.values.map((r: any) => r.map((v: any) => v.value));
assert.deepEqual(rows(settlements), [['1', '1001', '10001', '351', '9650']]);
assert.equal(rows(audit).length, 1); assert.equal(rows(audit)[0][1], 'SETTLE_ORDER');
assert.deepEqual(JSON.parse(rows(audit)[0][3]), { settlement_id: 1, fee: 351, net: 9650 });
assert.deepEqual(schema.normalized_result.schema.tables.map((t: any) => t.name).sort(), ['audit_log', 'customers', 'orders', 'settlements']);
const ref = (e: any, file: string, summary: string, symbol?: string) => ({ kind: 'browser', ref: '../evidence/' + file + '.json', symbol: symbol ?? e.evidence_id, summary });
const apiRef = (r: any) => ref(browser, 'browser', `실제 응답 sequence=${r.sequence}, 본문 sequence=${r.contentSequence}; ${r.method} ${r.url.url} → ${r.status}`, browser.evidence_id + '#' + r.transaction_id);
const ko: Record<string, string> = {id:'식별자',customer_id:'거래처 식별자',status:'상태',gross_amount:'주문 금액',commission_bps:'수수료율(bps)',settled_at:'정산 시각',customer_name:'거래처명',settlement_id:'정산 식별자',order_id:'주문 식별자',fee_amount:'수수료',net_amount:'지급액',created_at:'생성 시각'};
const fields = (r: any) => {
  const example = Array.isArray(r.body) ? r.body[0] : r.body;
  return Object.entries(example).map(([key, value]) => ({ nameEn:key,nameKo:ko[key] ?? key,dataType:value === null ? 'unknown (null observed)' : typeof value === 'number' ? 'Integer (observed)' : 'String (observed)',required:'TBD',note:'이 샘플 응답에서 관찰한 필드. 필수 여부·일반 스키마는 미확인.',depth:0,evidenceRefs:[apiRef(r)],reviewStatus:'unreviewed' }));
};
const note = '합성 샘플의 실제 브라우저 응답에서 수집. 인증 헤더·쿠키 없이 실행한 범위이며 운영 인증 정책은 미확인. 전체 네트워크 캡처는 incomplete(events).';
const orders = response('request-3'), settled = response('request-4'), list = response('request-8');
const screenPath = new URL(orders.url.url).origin + '/';
const doc = {
  schemaVersion:1,kind:'interface-spec',templatePreset:'si-standard',
  cover:{brand:'REA × MonoField / 합성 SI 인수인계 데모',docName:'주문·정산 인터페이스 명세서 — 검토용',version:'0.1',department:'실행 근거 기반 초안'},
  source:{codebaseName:'legacy-settlement (controlled synthetic demo)',codebasePath:'../shipped-legacy',language:'JavaScript',framework:'Node.js HTTP + SQLite',collector:'agent',mode:'codebase',collectedAt:new Date().toISOString(),revision:staticSummary.normalized_result.artifact.sha256},
  auth:{type:'undecided',description:'로컬 합성 샘플의 무자격증명 요청 성공만 관찰. 운영 인증 정책 미확인.'},
  endpoints:[
    {method:'GET',path:'/api/orders',interfaceId:'ORDER-001',interfaceName:'주문 목록 조회',businessPurpose:'거래처명·주문 상태·금액·수수료율을 화면에 표시한다.',note,responseFields:fields(orders),responseType:'Array (observed sample)',responseExample:orders.body,exampleSource:'live-probe',evidenceRefs:[apiRef(orders)]},
    {method:'POST',path:'/api/orders/{id}/settle',interfaceId:'ORDER-002',interfaceName:'주문 정산 실행',businessPurpose:'정산 실행 결과를 표시한다. 주문 1001: 10001 → 수수료 351, 지급액 9650. 단일 관찰이며 전체 계산 규칙 확정 아님.',note:note+' 중복:409 ALREADY_SETTLED. PENDING/CANCELLED:409 ORDER_NOT_PAID. 경로 {id}는 1001~1003 관찰을 일반화한 초안.',requestFields:[{nameEn:'id',nameKo:'주문 식별자',dataType:'Integer (path)',required:'Y',depth:0,note:'URL 경로값. 1001/1002/1003을 실행했다.',evidenceRefs:[apiRef(settled)],reviewStatus:'unreviewed'}],requestExample:{},responseFields:fields(settled),responseExample:settled.body,exampleSource:'live-probe',evidenceRefs:responses.filter((r: any)=>r.method==='POST').map(apiRef)},
    {method:'GET',path:'/api/settlements',interfaceId:'SETTLEMENT-001',interfaceName:'정산 내역 조회',businessPurpose:'관찰된 정산 1건을 조회해 표시한다.',note,responseFields:fields(list),responseType:'Array (observed sample)',responseExample:list.body,exampleSource:'live-probe',evidenceRefs:[apiRef(list)]},
  ],
};
const screenshot = overview.normalized_result.steps.at(-1).artifacts.screenshot.value;
await writeFile(resolve(root, 'deliverables/overview.png'), Buffer.from(screenshot.data_base64, 'base64'));
const screenshot2 = browser.normalized_result.steps.at(-1).artifacts.screenshot.value;
await writeFile(resolve(root, 'deliverables/rea-browser.png'), Buffer.from(screenshot2.data_base64, 'base64'));
const screen = {
  schemaVersion:1,kind:'screen-spec',name:'주문·정산 화면명세서 — REA 실측 / 검토용',mode:'document-existing-screen',theme:'enterprise-si-basic',
  sources:[{id:'rea-overview',type:'screenshot',title:'REA 실제 캡처 / 합성 샘플',contentRef:'overview.png',summary:overview.evidence_id},{id:'rea-processing',type:'screenshot',title:'REA 실행 후 결과',contentRef:'rea-browser.png',summary:browser.evidence_id}],
  screens:[
    {id:'SC-ORDER-001',screenName:'주문·정산 운영 화면',pageTitle:'주문·정산 운영 시스템',screenPath,overview:'문서 없는 기존 시스템 인수인계의 통제된 합성 데모. REA가 실제 Chromium에서 캡처한 화면.',levels:['운영','주문·정산'],author:'MonoField agent collector',date:'2026-10-22',version:'0.1',imageRef:'overview.png',evidenceRefs:[ref(overview,'browser-overview','overview-ready / 실제 DOM·스크린샷')],callouts:[
      {no:1,label:'주문 목록',description:'GET /api/orders의 4건을 표시. 주문·거래처·상태·금액·수수료율(bps).',position:{x:0.50,y:0.386},evidenceRefs:[apiRef(orders)]},
      {no:2,label:'정산 실행',description:'버튼 클릭으로 POST /api/orders/{id}/settle 실행. 정상 201, 중복·미결제·취소 409를 관찰.',position:{x:0.776,y:0.386},evidenceRefs:[apiRef(settled)]},
      {no:3,label:'처리 결과·정산 조회',description:'정산 응답을 JSON으로 표시. 정산 내역 조회는 GET /api/settlements를 호출.',position:{x:0.50,y:0.81},evidenceRefs:[apiRef(list)]}],checkpoints:['관찰한 동작만 기재. 전체 권한·동시성·장애 복구는 미검증.','화면 설명·번호 배치는 agent가 작성한 검토용 초안이다.']},
    {id:'SC-ORDER-002',screenName:'정산 실행 결과',screenPath,overview:'정상·중복·미결제·취소 순서 실행 후 최종 캡처. 브라우저 자동 스크롤로 화면 일부가 보인다.',levels:['운영','정산 결과'],author:'MonoField agent collector',date:'2026-10-22',version:'0.1',imageRef:'rea-browser.png',evidenceRefs:[ref(browser,'browser','settlements-loaded / 실제 화면·응답')],callouts:[{no:1,label:'취소 주문 거절',description:'주문 1003: HTTP 409, ORDER_NOT_PAID, CANCELLED. DOM과 응답 본문 일치.',position:{x:0.50,y:0.56},evidenceRefs:[apiRef(response('request-7'))]},{no:2,label:'정산 1건 표시',description:'주문 1001: 금액 10001, 수수료 351, 지급액 9650. 별도 REA DB 행 검사와 일치.',position:{x:0.50,y:0.86},evidenceRefs:[apiRef(list)]}],checkpoints:['정산 및 감사 로그 각 1건을 별도 REA SQLite 검사로 확인.','네트워크 GET request body not_exposed로 전체 캡처 completeness=incomplete.']},
  ],
};
for (const [name, value] of [['interface-spec',doc],['screen-spec',screen]]) await writeFile(resolve(root,'deliverables',name+'.json'), JSON.stringify(value,null,2));
const validation = {passed:true,scope:'controlled synthetic sample / real REA CLI + Chromium + SQLite',checks:['11 browser actions completed','4 UI result payloads match captured HTTP response bodies','normal settlement returns 201 with fee351/net9650','duplicate/pending/cancelled return 409 with expected codes','4 database tables','1 persisted settlement matches API','1 persisted audit record matches settlement','captured API body SHA-256 values match bytes'],evidenceIds:{browser:browser.evidence_id,overview:overview.evidence_id,schema:schema.evidence_id,settlements:settlements.evidence_id,audit:audit.evidence_id},limitations:{browserCompleteness:browser.normalized_result.completeness,staticCoverage:staticSummary.normalized_result.summary.coverage}};
await writeFile(resolve(root,'deliverables/validation.json'),JSON.stringify(validation,null,2));
console.log(JSON.stringify({ok:true,endpoints:3,screens:2,checks:validation.checks.length}));
