"""The change set applied between the baseline (v1) and the "sprint" (v2), plus the ground-truth diff."""
from __future__ import annotations

import re

from dsl import Ep, Model, endpoints_truth, f, fs, Param


def _dto(m: Model, name: str):
    return m.dtos[name]


def _field(m: Model, dto: str, name: str):
    return next(x for x in m.dtos[dto].fields if x.name == name)


def a1(m): _dto(m, 'AccountOpenRequest').fields.append(f('memo String max=200 ko=가입_메모'))
def a2(m): _dto(m, 'ConcessionRegisterRequest').fields.append(f('guardianConsentYn String ! max=1 ko=보호자_동의_여부'))
def a3(m): _dto(m, 'TapEntryRequest').fields[:] = [x for x in _dto(m, 'TapEntryRequest').fields if x.name != 'legacyTerminalCode']
def a4(m): _field(m, 'TapEntryRequest', 'vehicleNo').req = True
def a5(m): _dto(m, 'PaymentResponse').fields.append(f('balanceAfter Money ko=결제_후_잔액'))
def a6(m): _dto(m, 'FareCalcResponse').fields[:] = [x for x in _dto(m, 'FareCalcResponse').fields if x.name != 'legacyCode']
def a7(m): _field(m, 'TripLeg', 'routeId').type = 'String'


def a8(m):
    for e in m.eps:
        if e.method == 'requestCorrection':
            e.path = '/{tripId}/corrections'
        if e.method == 'approveCorrection':
            e.path = '/{tripId}/corrections/{correctionId}/approve'


def a9(m):
    next(e for e in m.eps if e.method == 'changeStatus').http = 'PUT'


def a10(m):
    m.dtos['AccountDashboardResponse'] = _mk_dto('AccountDashboardResponse', 'accountId Long ; balance Money ; monthToDateFare Money ; tripCountThisMonth Integer ; lastTripAt OffsetDateTime', 'account', '계정 대시보드')
    idx = max(i for i, e in enumerate(m.eps) if e.ctrl == 'AccountController')
    m.eps.insert(idx + 1, Ep('AccountController', 'GET', '/{accountId}/summary', 'getSummary', '계정 요약 대시보드 조회',
                             params=[Param('path', 'accountId', 'Long', True)], resp='AccountDashboardResponse'))


def _mk_dto(name, fields, module, doc):
    from dsl import Dto
    return Dto(name, fs(fields), 'lombok_data', module, None, doc)


def a11(m): m.eps[:] = [e for e in m.eps if e.method != 'receiveCardApproval']


def a12(m):
    for e in m.eps:
        if e.method in ('searchTariffs', 'getTariff'):
            e.auth = 'authenticated'


def a13(m): _dto(m, 'OperatorRef').fields.append(f('operatorCode String ! max=10 ko=운수사_코드'))
def a14(m): _field(m, 'Money', 'currency').name = 'currencyCode'
def a15(m): _field(m, 'AccountOpenRequest', 'customerName').max = 20
def a16(m): _dto(m, 'TripSearchCond').fields.append(f('includeCorrected Boolean ko=정정_포함_여부'))


def a17(m):
    next(e for e in m.eps if e.method == 'uploadBatch').params.append(Param('header', 'X-Request-Source', 'String', True, None, 'requestSource'))


def a18(m): _field(m, 'PartnerTripView', 'fareAmount').json = 'fare'


def b1(m):
    e = next(e for e in m.eps if e.method == 'blacklistDelta')
    e.auth = 'scope:blacklist.admin'
    e.pre_authorize = "hasAuthority('SCOPE_blacklist.admin')"


def b2(m): m.enums['PaymentStatus'].values.append('PARTIAL_REFUND')
def b3(m): m.enums['RefundReason'].values.append('SYSTEM_ERROR')
def b4(m): m.defaults['size'] = '50'
def c1(m): m.flags['fare_rounding'] = True
def c2(m): m.flags['refactor_allocator'] = True
def c3(m): m.flags['comment_edit'] = True
def c4(m): m.flags['reorder_tariff'] = True
def c5(m): _dto(m, 'AuditEnvelope').fields.append(f('correlationId String'))
def c6(m): m.flags['pg_client_param'] = True
def c7(m): m.flags['entity_len'] = True


MUTATIONS = [
    ('A1', '계정 개설 요청에 선택 필드 memo 추가', a1), ('A2', '감면 자격 등록 요청에 필수 필드 guardianConsentYn 추가', a2),
    ('A3', '승차 태그 요청에서 legacyTerminalCode 제거', a3), ('A4', '승차 태그 요청의 vehicleNo를 필수로 변경', a4),
    ('A5', '결제 응답에 balanceAfter 추가', a5), ('A6', '요금 산정 응답에서 legacyCode 제거', a6),
    ('A7', '여정 구간 routeId 타입 Long→String', a7), ('A8', '여정 정정 경로 correction→corrections (2개 API)', a8),
    ('A9', '계정 상태 변경 PATCH→PUT', a9), ('A10', '계정 요약 조회 API 신규', a10),
    ('A11', '카드 승인 콜백 API 삭제', a11), ('A12', '요금표 조회 2개 API 인증 필수로 변경(보안 설정 파일만 수정)', a12),
    ('A13', '공통 OperatorRef에 필수 operatorCode 추가(요청 3곳·응답 3곳에서 사용)', a13),
    ('A14', '공통 Money의 currency→currencyCode 이름 변경(다수 API)', a14),
    ('A15', '계정 개설 요청 customerName 최대 길이 50→20', a15), ('A16', '여정 조회 조건에 includeCorrected 추가', a16),
    ('A17', '오프라인 일괄 업로드에 필수 헤더 X-Request-Source 추가', a17), ('A18', '운수사 여정 조회의 JSON 이름 fare_amount→fare', a18),
    ('B1', '운수사 차단목록 증분 조회 권한 범위 변경(blacklist.read→blacklist.admin)', b1),
    ('B2', '결제 상태(응답)에 열거값 PARTIAL_REFUND 추가', b2), ('B3', '환불 사유(요청)에 열거값 SYSTEM_ERROR 추가', b3),
    ('B4', '페이지 크기 기본값 20→50', b4),
    ('C1', '[영향 없음] 요금 절사 방식 변경(내부 로직)', c1), ('C2', '[영향 없음] 정산 배분기 내부 리팩터링', c2),
    ('C3', '[영향 없음] 주석·로그 문구 수정', c3), ('C4', '[영향 없음] 요금표 응답 필드 순서 재배열', c4),
    ('C5', '[영향 없음] API에 노출되지 않는 내부 DTO에 필드 추가', c5), ('C6', '[영향 없음] 외부 PG 클라이언트 호출 인자 추가', c6),
    ('C7', '[영향 없음] 엔티티 컬럼 길이·트랜잭션 속성 변경', c7),
]

# ----------------------------------------------------------------- truth diff
VOCAB_KINDS_OUT = {'auth-scope-changed', 'enum-value-added', 'default-changed'}


def norm(path: str) -> str:
    return re.sub(r'\[\]', '', path)


def _fmap(fields):
    return {norm(x['path']): x for x in fields}


def diff_truth(before: list[dict], after: list[dict], before_m: Model, after_m: Model) -> list[dict]:
    b = {x['route']: x for x in before}
    a = {x['route']: x for x in after}
    out = []

    def add(route, location, field, kind, level, **extra):
        out.append({'route': route, 'location': location, 'field': field, 'kind': kind, 'level': level, 'vocab': kind not in VOCAB_KINDS_OUT, **extra})

    for r in b.keys() - a.keys():
        add(r, 'endpoint', None, 'endpoint-removed', 'breaking')
    for r in a.keys() - b.keys():
        add(r, 'endpoint', None, 'endpoint-added', 'info')
    for r in b.keys() & a.keys():
        x, y = b[r], a[r]
        if x['auth']['required'] != y['auth']['required']:
            add(r, 'endpoint', None, 'auth-required-added' if y['auth']['required'] else 'auth-required-removed', 'breaking' if y['auth']['required'] else 'warning')
        elif x['auth']['detail'] != y['auth']['detail']:
            add(r, 'endpoint', None, 'auth-scope-changed', 'breaking', before=x['auth']['detail'], after=y['auth']['detail'])
        for loc in ('request', 'response'):
            fx, fy = _fmap(x[loc]), _fmap(y[loc])
            for k in fx.keys() - fy.keys():
                add(r, loc, k, 'request-field-removed' if loc == 'request' else 'response-field-removed', 'warning' if loc == 'request' else 'breaking')
            for k in fy.keys() - fx.keys():
                if loc == 'request':
                    add(r, loc, k, 'request-field-added-required' if fy[k]['req'] else 'request-field-added-optional', 'breaking' if fy[k]['req'] else 'info')
                else:
                    add(r, loc, k, 'response-field-added', 'info')
            for k in fx.keys() & fy.keys():
                p, q = fx[k], fy[k]
                if p['cat'] != q['cat']:
                    add(r, loc, k, 'field-type-changed', 'breaking', before=p['cat'], after=q['cat'])
                if loc == 'request' and p['req'] != q['req']:
                    add(r, loc, k, 'request-field-became-required' if q['req'] else 'request-field-became-optional', 'breaking' if q['req'] else 'info')
                if loc == 'request' and p.get('max') and q.get('max') and q['max'] < p['max']:
                    add(r, loc, k, 'request-field-max-size-reduced', 'breaking', before=str(p['max']), after=str(q['max']))
    # an endpoint whose route changed (path or method) is a removal plus an addition; field changes inside it are real
    # but a route-keyed comparison cannot pair them, so they are recorded as secondary (neither required nor penalised)
    bh = {x['handler']: x for x in before if x['route'] in b.keys() - a.keys()}
    ah = {x['handler']: x for x in after if x['route'] in a.keys() - b.keys()}
    for h in bh.keys() & ah.keys():
        x, y = bh[h], ah[h]
        for loc in ('request', 'response'):
            fx, fy = _fmap(x[loc]), _fmap(y[loc])
            for k in fx.keys() - fy.keys():
                add(y['route'], loc, k, 'request-field-removed' if loc == 'request' else 'response-field-removed', 'warning' if loc == 'request' else 'breaking', secondary=True, old_route=x['route'])
            for k in fy.keys() - fx.keys():
                add(y['route'], loc, k, ('request-field-added-required' if fy[k]['req'] else 'request-field-added-optional') if loc == 'request' else 'response-field-added',
                    ('breaking' if fy[k]['req'] else 'info') if loc == 'request' else 'info', secondary=True, old_route=x['route'])
    # enum values and defaults: visible to callers but outside what an interface spec records
    for name, e in after_m.enums.items():
        old = set(before_m.enums[name].values) if name in before_m.enums else set()
        for v in sorted(set(e.values) - old):
            use = _enum_use(after_m, name)
            add('*', 'enum', f'{name}.{v}', 'enum-value-added', 'warning' if 'response' in use else 'info', use=sorted(use))
    if before_m.defaults != after_m.defaults:
        for k in sorted(set(before_m.defaults) | set(after_m.defaults)):
            if before_m.defaults.get(k) != after_m.defaults.get(k):
                add('*', 'request', f'PageQuery.{k}', 'default-changed', 'warning', before=str(before_m.defaults.get(k, '20')), after=str(after_m.defaults.get(k)))
    return out


def _enum_use(m: Model, enum_name: str) -> set[str]:
    use = set()
    for t in endpoints_truth(m):
        for loc in ('request', 'response'):
            for x in t[loc]:
                if x.get('type') == enum_name or x.get('type') == f'List<{enum_name}>':
                    use.add(loc)
    return use


def attributed_truth(base: Model):
    """Final model after all mutations, and the combined v1->v2 truth diff with each entry attributed to its mutation(s).

    Mutations interact (A14 renames a Money field that A5 and A10 also use), so the canonical truth is the combined diff;
    attribution is looked up from each mutation applied alone to the baseline.
    """
    final = base.clone()
    singles = {}
    for mid, desc, fn in MUTATIONS:
        one = base.clone()
        fn(one)
        singles[mid] = diff_truth(endpoints_truth(base), endpoints_truth(one), base, one)
        fn(final)
    combined = diff_truth(endpoints_truth(base), endpoints_truth(final), base, final)
    key = lambda e: (e['route'], e['location'], e['field'], e['kind'])
    root = lambda e: (e['route'], e['location'], (e['field'] or '').split('.')[0])
    for e in combined:
        ids = [mid for mid, es in singles.items() if any(key(x) == key(e) for x in es)]
        if not ids:
            ids = [mid for mid, es in singles.items() if any(root(x) == root(e) for x in es)]
        e['mutation'] = '+'.join(ids) if ids else 'interaction'
    return final, combined
