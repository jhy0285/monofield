"""The synthetic ABT (account-based ticketing) platform: fare, payment and settlement for public transport.

Entirely invented. No real operator, bank, card scheme or system is modelled.
"""
from __future__ import annotations

from dsl import Ctrl, Dto, Enum, Ep, Model, Param, fs


def P(name, type_='Long'):
    return Param('path', name, type_, True)


def Q(name, type_='String', req=False, default=None, var=None):
    return Param('query', name, type_, req, default, var)


def H(name, type_='String', req=True, var=None):
    return Param('header', name, type_, req, None, var)


def build_v1() -> Model:
    m = Model()

    def dto(name, fields, style='lombok_data', module='common', ext=None, doc='', inner_of=None):
        m.dtos[name] = Dto(name, fs(fields), style, module, ext, doc, inner_of)

    def enum(name, values, module='common', json_value=False):
        m.enums[name] = Enum(name, values.split(), module, json_value)

    def ctrl(name, module, base, base_expr, style, doc='', parent=None, service='', aggregate=''):
        m.ctrls[name] = Ctrl(name, module, base, base_expr, style, doc, parent, service, aggregate)

    def ep(*a, **k):
        m.eps.append(Ep(*a, **k))

    # ------------------------------------------------------------ common
    enum('TransportMode', 'BUS METRO TRAM FERRY')
    enum('Severity', 'LOW MEDIUM HIGH')
    dto('Money', 'amount BigDecimal ! ko=금액 ; currency String ! max=3 ko=통화', doc='금액 값 객체')
    dto('OperatorRef', 'operatorId String ! max=20 ko=운수사_ID ; operatorName String max=60 ko=운수사명', doc='운수사 참조')
    dto('BaseResponse', 'createdAt LocalDateTime ko=생성일시 ; updatedAt LocalDateTime ko=수정일시 ; createdBy String ko=생성자', doc='공통 응답 부모')
    dto('TraceableRequest', 'requestId String max=36 ko=요청_ID', doc='추적 가능한 요청 부모')
    dto('PageQuery', 'page Integer min=0 def=0 ko=페이지 ; size Integer min=1 def=20 ko=페이지_크기', doc='페이지 조회 조건')
    dto('AuditEnvelope', 'actor String ; action String ; payload String', doc='내부 감사 이벤트 포장(어느 API에도 노출되지 않음)')

    # ------------------------------------------------------------ account (lombok @Data)
    ac = 'account'
    enum('AccountStatus', 'ACTIVE SUSPENDED CLOSED', ac)
    enum('MediaType', 'CARD MOBILE QR WEARABLE', ac)
    enum('ConcessionType', 'YOUTH SENIOR DISABLED MERIT CHILD', ac)
    enum('LostReason', 'LOST STOLEN DAMAGED', ac)
    dto('TermAgree', 'termCode String ! max=20 ; version String ! max=10 ; agreedAt OffsetDateTime !', module=ac, doc='약관 동의')
    dto('AccountOpenRequest', 'customerName String ! max=50 ko=고객명 ; birthDate LocalDate ! ko=생년월일 ; mobileNo String ! pat=^01[0-9]{8,9}$ ko=휴대폰번호 ; '
        'email String max=100 ko=이메일 ; marketingAgree Boolean ko=마케팅_동의 ; agreeTerms List<TermAgree> ! ko=약관_동의_목록 ; '
        'referrerCode String max=20 ko=추천인_코드 ; internalNote String ignore', module=ac, doc='계정 개설 요청')
    dto('AccountResponse', 'accountId Long ko=계정_ID ; customerName String ko=고객명 ; maskedMobileNo String ko=마스킹_휴대폰 ; email String ; '
        'status AccountStatus ko=계정_상태 ; openedAt LocalDateTime ko=개설일시 ; mediaCount Integer ; balanceLimit Money ko=잔액_한도 ; riskScore Integer ignore',
        module=ac, ext='BaseResponse', doc='계정 응답')
    dto('AccountSummary', 'accountId Long ; customerName String ; status AccountStatus ; openedAt LocalDateTime', module=ac, doc='계정 요약')
    dto('AccountSearchCond', 'status AccountStatus ; keyword String max=30 ko=검색어 ; openedFrom LocalDate ; openedTo LocalDate', module=ac, ext='PageQuery', doc='계정 검색 조건')
    dto('AccountStatusChangeRequest', 'status AccountStatus ! ko=변경_상태 ; reason String ! max=200 ko=사유', module=ac, ext='TraceableRequest', doc='계정 상태 변경 요청')
    dto('MediaRegisterRequest', 'mediaType MediaType ! ; mediaNo String ! max=32 ko=수단_번호 ; issuerCode String max=10 ; deviceBindingId String max=64 ; nickname String max=20', module=ac, doc='결제 수단 등록 요청')
    dto('MediaResponse', 'mediaId Long ; mediaType MediaType ; maskedMediaNo String ; issuerCode String ; registeredAt LocalDateTime ; active Boolean', 'record', ac, doc='결제 수단 응답')
    dto('ConcessionRegisterRequest', 'concessionType ConcessionType ! ; certificateNo String ! max=30 ko=증빙_번호 ; validFrom LocalDate ! ; validTo LocalDate ; documentFileId String max=40', module=ac, doc='감면 자격 등록 요청')
    dto('ConcessionResponse', 'concessionId Long ; concessionType ConcessionType ; validFrom LocalDate ; validTo LocalDate ; verified Boolean ; discountRate BigDecimal', module=ac, doc='감면 자격 응답')
    dto('LostReportRequest', 'mediaId Long ! ; reason LostReason ! ; reportedPlace String max=100 ; contactMobileNo String max=15', module=ac, doc='분실 신고 요청')
    dto('LostReportResponse', 'reportId Long ; blockedAt LocalDateTime ; replacementGuide String', module=ac, doc='분실 신고 응답')
    dto('AutoChargeSettingRequest', 'enabled Boolean ! ; thresholdAmount BigDecimal ; chargeAmount BigDecimal ; payMethodId Long', module=ac, doc='자동 충전 설정 요청')
    dto('AutoChargeSettingResponse', 'enabled Boolean ; thresholdAmount BigDecimal ; chargeAmount BigDecimal ; payMethodId Long ; updatedAt LocalDateTime', module=ac, doc='자동 충전 설정 응답')

    ctrl('AccountController', ac, '/api/v1/accounts', 'ApiPaths.ACCOUNTS', 'rest', '계정·수단 관리', service='AccountService', aggregate='Account')
    A = 'AccountController'
    ep(A, 'POST', '', 'openAccount', '계정 개설', body='AccountOpenRequest', resp='AccountResponse', status=201, auth='public')
    ep(A, 'GET', '/{accountId}', 'getAccount', '계정 단건 조회', params=[P('accountId')], resp='AccountResponse')
    ep(A, 'GET', '', 'searchAccounts', '계정 목록 조회', cond='AccountSearchCond', resp='AccountSummary', wrap='page')
    ep(A, 'PATCH', '/{accountId}/status', 'changeStatus', '계정 상태 변경', params=[P('accountId')], body='AccountStatusChangeRequest', resp='AccountResponse')
    ep(A, 'POST', '/{accountId}/media', 'registerMedia', '결제 수단 등록', params=[P('accountId')], body='MediaRegisterRequest', resp='MediaResponse', status=201)
    ep(A, 'GET', '/{accountId}/media', 'listMedia', '결제 수단 목록 조회', params=[P('accountId')], resp='MediaResponse', wrap='list')
    ep(A, 'DELETE', '/{accountId}/media/{mediaId}', 'removeMedia', None, params=[P('accountId'), P('mediaId')], wrap='apivoid')
    ep(A, 'POST', '/{accountId}/concessions', 'registerConcession', '감면 자격 등록', params=[P('accountId')], body='ConcessionRegisterRequest', resp='ConcessionResponse', status=201)
    ep(A, 'GET', '/{accountId}/concessions', 'listConcessions', '감면 자격 목록 조회', params=[P('accountId')], resp='ConcessionResponse', wrap='list')
    ep(A, 'POST', '/{accountId}/lost-report', 'reportLost', '분실 신고', params=[P('accountId')], body='LostReportRequest', resp='LostReportResponse')
    ep(A, 'PUT', '/{accountId}/autocharge', 'updateAutoCharge', '자동 충전 설정', params=[P('accountId')], body='AutoChargeSettingRequest', resp='AutoChargeSettingResponse')

    # ------------------------------------------------------------ tap / trip (records, ResponseEntity)
    tp = 'tap'
    enum('TapDirection', 'ENTRY EXIT', tp)
    enum('TapResult', 'ACCEPTED REJECTED DUPLICATE BLACKLISTED', tp)
    enum('TripStatus', 'OPEN CLOSED INCOMPLETE CORRECTED', tp)
    enum('CorrectionStatus', 'REQUESTED APPROVED REJECTED', tp)
    enum('DeviceType', 'GATE BUS_READER HANDHELD', tp)
    dto('GeoPoint', 'lat BigDecimal ! ; lng BigDecimal !', 'record', tp, doc='좌표')
    dto('TapEntryRequest', 'mediaToken String ! max=128 ko=수단_토큰 ; deviceId String ! max=32 ; stopId String ! max=20 ; routeId Long ; vehicleNo String max=12 ; '
        'taggedAt OffsetDateTime ! ; offline Boolean ; legacyTerminalCode String max=8 ; gps GeoPoint', 'record', tp, doc='승차 태그 요청')
    dto('TapExitRequest', 'mediaToken String ! max=128 ; deviceId String ! max=32 ; stopId String ! max=20 ; taggedAt OffsetDateTime ! ; tripId Long ; offline Boolean ; gps GeoPoint', 'record', tp, doc='하차 태그 요청')
    dto('TapResponse', 'tapId Long ; result TapResult ; tripId Long ; message String ; fareHint Money ; processedAt OffsetDateTime', 'record', tp, doc='태그 처리 결과')
    dto('TapEvent', 'direction TapDirection ! ; mediaToken String ! max=128 ; stopId String ! ; taggedAt OffsetDateTime ! ; routeId Long', 'record', tp, doc='오프라인 태그 이벤트')
    dto('TapBatchRequest', 'deviceId String ! max=32 ; batchId String ! max=40 ; events List<TapEvent> !', 'record', tp, doc='오프라인 일괄 업로드 요청')
    dto('RejectedTap', 'index Integer ; reason String ; mediaToken String', 'record', tp, doc='거절된 태그')
    dto('TapBatchResponse', 'batchId String ; accepted Integer ; rejected Integer ; duplicates Integer ; rejectedItems List<RejectedTap>', 'record', tp, doc='일괄 업로드 결과')
    dto('TapDetailResponse', 'tapId Long ; direction TapDirection ; deviceId String ; stopId String ; routeId Long ; taggedAt OffsetDateTime ; result TapResult ; accountId Long ; mediaId Long', 'record', tp, doc='태그 상세')
    dto('TripSearchCond', 'accountId Long ! ; from LocalDate ; to LocalDate ; status TripStatus', 'lombok_getset', tp, ext='PageQuery', doc='여정 검색 조건')
    dto('TripSummary', 'tripId Long ; accountId Long ; status TripStatus ; boardedAt OffsetDateTime ; alightedAt OffsetDateTime ; originStopId String ; destStopId String ; totalFare Money', 'record', tp, doc='여정 요약')
    dto('TripLeg', 'legNo Integer ; routeId Long ; routeName String ; boardStopId String ; alightStopId String ; boardedAt OffsetDateTime ; alightedAt OffsetDateTime ; distanceMeters Integer ; fare Money', 'record', tp, doc='여정 구간')
    dto('TripResponse', 'tripId Long ; accountId Long ; status TripStatus ; legs List<TripLeg> ; totalFare Money ; discount Money ; operator OperatorRef ; transferApplied Boolean', 'record', tp, doc='여정 상세')
    dto('TripCorrectionRequest', 'reasonCode String ! max=20 ; description String ! max=500 ; requestedAlightStopId String max=20 ; requestedAlightedAt OffsetDateTime ; attachmentFileIds List<String> ; operator OperatorRef', 'record', tp, doc='여정 정정 요청')
    dto('TripCorrectionResponse', 'correctionId Long ; status CorrectionStatus ; requestedAt OffsetDateTime', 'record', tp, doc='여정 정정 응답')
    dto('CorrectionApprovalRequest', 'approve Boolean ! ; comment String max=300', 'record', tp, doc='정정 승인 요청')
    dto('DeviceHealthResponse', 'deviceId String ; deviceType DeviceType ; lastSeenAt OffsetDateTime ; firmwareVersion String ; batteryPercent Integer ; status String', 'record', tp, doc='단말 상태')

    ctrl('TapController', tp, '/api/v1/taps', '"/api/v1/taps"', 'rest', '승하차 태그 수신', service='TapService', aggregate='TapEvent')
    ctrl('TripController', tp, '/api/v1/trips', '"/api/v1/trips"', 'rest', '여정 조회·정정', service='TripService', aggregate='Trip')
    ctrl('DeviceController', tp, '/api/v1/devices', '"/api/v1/devices"', 'rest', '단말 상태', service='DeviceService', aggregate='Device')
    T = 'TapController'
    ep(T, 'POST', '/entry', 'tapEntry', '승차 태그', body='TapEntryRequest', resp='TapResponse', wrap='entity', auth='public')
    ep(T, 'POST', '/exit', 'tapExit', '하차 태그', body='TapExitRequest', resp='TapResponse', wrap='entity', auth='public')
    ep(T, 'POST', '/batch', 'uploadBatch', '오프라인 태그 일괄 업로드', body='TapBatchRequest', resp='TapBatchResponse', wrap='entity', auth='public')
    ep(T, 'POST', '/batch-file', 'uploadBatchFile', '오프라인 태그 파일 업로드', params=[Q('deviceId', 'String', True)], multipart=True, resp='TapBatchResponse', wrap='entity', auth='public')
    ep(T, 'GET', '/{tapId}', 'getTap', '태그 상세 조회', params=[P('tapId')], resp='TapDetailResponse', wrap='entity', auth='public')
    R = 'TripController'
    ep(R, 'GET', '', 'searchTrips', '여정 조회', cond='TripSearchCond', resp='TripSummary', wrap='page')
    ep(R, 'GET', '/{tripId:[0-9]+}', 'getTrip', '여정 상세 조회', params=[P('tripId')], resp='TripResponse', regex_path=True)
    ep(R, 'POST', '/{tripId}/correction', 'requestCorrection', '여정 정정 요청', params=[P('tripId')], body='TripCorrectionRequest', resp='TripCorrectionResponse', status=201)
    ep(R, 'POST', '/{tripId}/correction/{correctionId}/approve', 'approveCorrection', '여정 정정 승인', params=[P('tripId'), P('correctionId')], body='CorrectionApprovalRequest', resp='TripCorrectionResponse', auth='role:OPERATOR', pre_authorize="hasRole('OPERATOR')")
    ep('DeviceController', 'GET', '/{deviceId}/health', 'getHealth', None, params=[P('deviceId', 'String')], resp='DeviceHealthResponse')

    # ------------------------------------------------------------ fare (explicit getters/setters, inheritance)
    fr = 'fare'
    enum('FareType', 'BASE DISTANCE TRANSFER CONCESSION PENALTY', fr)
    enum('TariffStatus', 'DRAFT ACTIVE RETIRED', fr)
    dto('FareCalcRequest', 'tripId Long ! ; accountId Long ! ; mode TransportMode ! ; distanceMeters Integer ! min=0 ; boardedAt LocalDateTime ! ; alightedAt LocalDateTime ! ; concessionTypes List<String> ; peakHint Boolean', 'pojo', fr, ext='TraceableRequest', doc='요금 산정 요청')
    dto('FareBreakdownItem', 'fareType FareType ; label String ; amount Money ; ruleId String', 'pojo', fr, doc='요금 내역')
    dto('FareCalcResponse', 'tripId Long ; baseFare Money ; distanceFare Money ; transferDiscount Money ; concessionDiscount Money ; penalty Money ; finalFare Money ; '
        'breakdown List<FareBreakdownItem> ; tariffId Long ; legacyCode String ; calculatedAt LocalDateTime', 'pojo', fr, doc='요금 산정 결과')
    dto('TransferEvaluateRequest', 'accountId Long ! ; prevTripId Long ! ; nextTripId Long ! ; prevAlightedAt LocalDateTime ! ; nextBoardedAt LocalDateTime ! ; routeIds List<Long>', 'pojo', fr, doc='환승 판정 요청')
    dto('TransferEvaluateResponse', 'eligible Boolean ; transferWindowMinutes Integer ; discount Money ; reasonCode String ; ruleId String', 'pojo', fr, doc='환승 판정 결과')
    dto('CapEvaluateRequest', 'accountId Long ! ; periodType String ! max=5 ; periodKey String ! max=10 ; pendingFare Money !', 'pojo', fr, doc='한도 판정 요청')
    dto('CapEvaluateResponse', 'capped Boolean ; capAmount Money ; consumed Money ; remaining Money ; appliedFare Money', 'pojo', fr, doc='한도 판정 결과')
    dto('DistanceTier', 'fromMeters Integer ! ; toMeters Integer ; perUnitMeters Integer ! ; unitFare Money !', 'pojo', fr, doc='거리 구간 요율')
    dto('TariffResponse', 'tariffId Long ; mode TransportMode ; name String ; status TariffStatus ; effectiveFrom LocalDate ; effectiveTo LocalDate ; baseFare Money ; tiers List<DistanceTier> ; version Integer', 'pojo', fr, doc='요금표')
    dto('TariffUpsertRequest', 'mode TransportMode ! ; name String ! max=60 ; effectiveFrom LocalDate ! ; effectiveTo LocalDate ; baseFare Money ! ; tiers List<DistanceTier> ! ; changeReason String max=200', 'pojo', fr, ext='TraceableRequest', doc='요금표 등록·개정 요청')
    dto('TariffSearchCond', 'mode TransportMode ; status TariffStatus ; activeOn LocalDate', 'pojo', fr, ext='PageQuery', doc='요금표 검색 조건')
    dto('ConcessionRuleResponse', 'concessionType String ; discountRate BigDecimal ; applicableModes List<TransportMode> ; maxPerDay Integer ; description String', 'pojo', fr, doc='감면 규칙')
    dto('SimScenario', 'mode TransportMode ! ; distanceMeters Integer ! ; concessionTypes List<String> ; transfer Boolean', 'pojo', fr, doc='시뮬레이션 시나리오')
    dto('FareSimulateRequest', 'scenarios List<SimScenario> ! ; tariffId Long', 'pojo', fr, doc='요금 시뮬레이션 요청')
    dto('SimResult', 'index Integer ; finalFare Money ; discount Money', 'pojo', fr, doc='시뮬레이션 결과 한 건')
    dto('FareSimulateResponse', 'results List<SimResult> ; tariffId Long ; simulatedAt LocalDateTime', 'pojo', fr, doc='요금 시뮬레이션 결과')

    ctrl('FareController', fr, '/api/v1/fares', '"/api/v1/fares"', 'rest', '요금 산정·요금표', service='FareService', aggregate='Tariff')
    FC = 'FareController'
    ep(FC, 'POST', '/calculate', 'calculateFare', '요금 산정', body='FareCalcRequest', resp='FareCalcResponse')
    ep(FC, 'POST', '/transfer/evaluate', 'evaluateTransfer', '환승 판정', body='TransferEvaluateRequest', resp='TransferEvaluateResponse')
    ep(FC, 'GET', '/tariffs', 'searchTariffs', '요금표 목록 조회', cond='TariffSearchCond', resp='TariffResponse', wrap='page', auth='public')
    ep(FC, 'GET', '/tariffs/{tariffId}', 'getTariff', '요금표 상세 조회', params=[P('tariffId')], resp='TariffResponse', auth='public')
    ep(FC, 'POST', '/tariffs', 'createTariff', '요금표 등록', body='TariffUpsertRequest', resp='TariffResponse', status=201, auth='role:ADMIN', pre_authorize="hasRole('ADMIN')")
    ep(FC, 'PUT', '/tariffs/{tariffId}', 'updateTariff', '요금표 개정', params=[P('tariffId')], body='TariffUpsertRequest', resp='TariffResponse', auth='role:ADMIN', pre_authorize="hasRole('ADMIN')")
    ep(FC, 'POST', '/caps/evaluate', 'evaluateCap', '이용 한도 판정', body='CapEvaluateRequest', resp='CapEvaluateResponse')
    ep(FC, 'GET', '/concession-rules', 'listConcessionRules', '감면 규칙 조회', resp='ConcessionRuleResponse', wrap='list', auth='public')
    ep(FC, 'POST', '/simulate', 'simulate', None, body='FareSimulateRequest', resp='FareSimulateResponse')

    # ------------------------------------------------------------ billing (lombok getter/setter/builder, generic page, header)
    bl = 'billing'
    enum('InvoiceStatus', 'ISSUED PAID OVERDUE VOID', bl)
    enum('PaymentMethod', 'CARD BANK_TRANSFER POINT SIMPLE_PAY', bl, json_value=True)
    enum('PaymentStatus', 'PENDING APPROVED FAILED CANCELLED REFUNDED', bl)
    enum('RefundReason', 'CUSTOMER_REQUEST DUPLICATE_CHARGE FARE_ERROR', bl)
    dto('InvoiceCreateRequest', 'accountId Long ! ; periodFrom LocalDate ! ; periodTo LocalDate ! ; tripIds List<Long> ; dueDate LocalDate', 'lombok_getset', bl, ext='TraceableRequest', doc='청구서 생성 요청')
    dto('InvoiceLine', 'lineNo Integer ; tripId Long ; description String ; amount Money ; taxAmount Money', 'builder', bl, doc='청구 항목')
    dto('InvoiceResponse', 'invoiceId Long ; accountId Long ; status InvoiceStatus ; issuedAt OffsetDateTime ; dueDate LocalDate ; totalAmount Money ; lines List<InvoiceLine> ; paidAmount Money', 'builder', bl, doc='청구서 응답')
    dto('InvoiceSearchCond', 'accountId Long ; status InvoiceStatus ; issuedFrom LocalDate ; issuedTo LocalDate', 'lombok_getset', bl, ext='PageQuery', doc='청구서 검색 조건')
    dto('InvoiceSummary', 'invoiceId Long ; status InvoiceStatus ; totalAmount Money ; dueDate LocalDate', 'builder', bl, doc='청구서 요약')
    dto('CardInfo', 'cardToken String ! max=64 ; holderName String max=40 ; expiry String pat=^[0-9]{4}$ ; cvcToken String max=64', 'lombok_getset', bl, doc='카드 정보(토큰)')
    dto('PaymentRequest', 'invoiceId Long ! ; method PaymentMethod ! ; amount Money ! ; card CardInfo ; payMethodId Long ; installmentMonths Integer min=0 ; returnUrl String max=300', 'lombok_getset', bl, doc='결제 요청')
    dto('PaymentResponse', 'paymentId Long ; invoiceId Long ; status PaymentStatus ; method PaymentMethod ; amount Money ; approvedAt OffsetDateTime ; pgTransactionId String ; receiptUrl String ; failureCode String ; failureMessage String', 'builder', bl, doc='결제 응답')
    dto('PaymentCancelRequest', 'reason String ! max=200', 'lombok_getset', bl, ext='TraceableRequest', doc='결제 취소 요청')
    dto('RefundRequest', 'amount Money ! ; reason RefundReason ! ; memo String max=200', 'lombok_getset', bl, doc='환불 요청')
    dto('RefundResponse', 'refundId Long ; paymentId Long ; refundedAmount Money ; status String ; refundedAt OffsetDateTime', 'builder', bl, doc='환불 응답')
    dto('PgWebhookPayload', 'eventType String ! ; pgTransactionId String ! ; merchantUid String ! ; status String ! ; amount BigDecimal ! ; currency String ; occurredAt OffsetDateTime ! ; signature String ; rawData Map<String,Object>', 'lombok_data', bl, doc='PG 웹훅 본문')
    dto('CardApprovalCallback', 'approvalNo String ! ; cardCompanyCode String ! ; orderNo String ! ; resultCode String ! ; resultMessage String ; approvedAmount BigDecimal ; approvedAt String', 'lombok_data', bl, doc='카드사 승인 콜백')
    dto('WebhookAck', 'received Boolean ; ackId String', 'builder', bl, doc='웹훅 수신 확인')
    dto('ArrearResponse', 'arrearId Long ; accountId Long ; invoiceId Long ; amount Money ; overdueDays Integer ; collectionStatus String ; lastNoticeAt OffsetDateTime', 'builder', bl, doc='미납 응답')
    dto('ArrearSearchCond', 'minOverdueDays Integer ; collectionStatus String', 'lombok_getset', bl, ext='PageQuery', doc='미납 검색 조건')
    dto('CollectRequest', 'method String ! max=20 ; scheduledAt LocalDateTime ; note String max=200', 'lombok_getset', bl, doc='수납 요청')
    dto('CollectResponse', 'arrearId Long ; accepted Boolean ; scheduledAt LocalDateTime', 'builder', bl, doc='수납 응답')
    dto('AutoChargeExecuteRequest', 'baseDate LocalDate ! ; dryRun Boolean ; accountIds List<Long>', 'lombok_getset', bl, doc='자동 충전 실행 요청')
    dto('AutoChargeExecuteResponse', 'jobId String ; targeted Integer ; started LocalDateTime', 'builder', bl, doc='자동 충전 실행 결과')

    ctrl('InvoiceController', bl, '/api/v1/billing', 'ApiPaths.V1 + "/billing"', 'rest', '청구·미납', service='InvoiceService', aggregate='Invoice')
    ctrl('PaymentController', bl, '/api/v1/payments', 'ApiPaths.PAYMENTS', 'rest', '결제', service='PaymentService', aggregate='Payment')
    ctrl('PaymentWebhookController', bl, '/api/v1/payments/webhook', 'ApiPaths.PAYMENTS + "/webhook"', 'rest', '결제 웹훅', service='PaymentService', aggregate='Payment')
    I = 'InvoiceController'
    ep(I, 'POST', '/invoices', 'createInvoice', '청구서 생성', body='InvoiceCreateRequest', resp='InvoiceResponse', status=201)
    ep(I, 'GET', '/invoices/{invoiceId}', 'getInvoice', '청구서 상세 조회', params=[P('invoiceId')], resp='InvoiceResponse')
    ep(I, 'GET', '/invoices', 'searchInvoices', '청구서 목록 조회', cond='InvoiceSearchCond', resp='InvoiceSummary', wrap='page')
    ep(I, 'GET', '/arrears', 'searchArrears', '미납 목록 조회', cond='ArrearSearchCond', resp='ArrearResponse', wrap='page')
    ep(I, 'POST', '/arrears/{arrearId}/collect', 'collectArrear', '미납 수납 요청', params=[P('arrearId')], body='CollectRequest', resp='CollectResponse')
    ep(I, 'POST', '/autocharge/execute', 'executeAutoCharge', '자동 충전 실행', body='AutoChargeExecuteRequest', resp='AutoChargeExecuteResponse', auth='role:ADMIN')
    PY = 'PaymentController'
    ep(PY, 'POST', '', 'requestPayment', '결제 요청', params=[H('Idempotency-Key', 'String', True, 'idempotencyKey')], body='PaymentRequest', resp='PaymentResponse', status=201)
    ep(PY, 'GET', '/{paymentId}', 'getPayment', '결제 상세 조회', params=[P('paymentId')], resp='PaymentResponse')
    ep(PY, 'POST', '/{paymentId}/cancel', 'cancelPayment', '결제 취소', params=[P('paymentId')], body='PaymentCancelRequest', resp='PaymentResponse')
    ep(PY, 'POST', '/{paymentId}/refund', 'refundPayment', '환불 요청', params=[P('paymentId'), H('X-Operator-Id', 'String', False, 'operatorId')], body='RefundRequest', resp='RefundResponse')
    W = 'PaymentWebhookController'
    ep(W, 'POST', '/pg', 'receivePgWebhook', 'PG 웹훅 수신', params=[H('X-Pg-Signature', 'String', True, 'signature')], body='PgWebhookPayload', resp='WebhookAck', auth='public')
    ep(W, 'POST', '/card-approval', 'receiveCardApproval', '카드 승인 결과 수신', body='CardApprovalCallback', resp='WebhookAck', auth='public', deprecated=False)

    # ------------------------------------------------------------ settlement (eGovFrame .do VO + a newer REST controller)
    st = 'settlement'
    dto('DailySettleSearchVO', 'settleDate String ! max=8 ; operatorId String max=20 ; mode String max=10 ; pageIndex Integer ; pageUnit Integer', 'vo', st, doc='일 정산 조회 조건')
    dto('DailySettleVO', 'settleDate String ; operatorId String ; operatorName String ; tripCount Integer ; grossAmount BigDecimal ; discountAmount BigDecimal ; netAmount BigDecimal ; feeAmount BigDecimal ; status String', 'vo', st, doc='일 정산 결과')
    dto('SettleExecuteVO', 'settleDate String ! max=8 ; operatorIds List<String> ; forceYn String max=1 ; executor String max=30', 'vo', st, doc='정산 실행 요청')
    dto('SettleExecuteResultVO', 'jobId String ; settleDate String ; targetCount Integer ; status String', 'vo', st, doc='정산 실행 결과')
    dto('OperatorSummaryVO', 'operatorId String ; periodFrom String ; periodTo String ; totalNet BigDecimal ; items List<DailySettleVO>', 'vo', st, doc='운수사 정산 요약')
    dto('AdjustmentRegisterVO', 'operatorId String ! max=20 ; settleDate String ! max=8 ; adjustType String ! max=10 ; amount BigDecimal ! ; reason String ! max=300 ; evidenceFileId String max=40', 'vo', st, doc='정산 조정 등록')
    dto('AdjustmentApproveVO', 'adjustId Long ! ; approveYn String ! max=1 ; approver String ! max=30 ; comment String max=300', 'vo', st, doc='정산 조정 승인')
    dto('ClosingRequest', 'closingDate LocalDate ! ; operatorIds List<String> ; mode String max=10', 'lombok_data', st, doc='정산 마감 요청')
    dto('ClosingOperatorItem', 'operator OperatorRef ; netAmount Money ; settlementId Long', 'lombok_data', st, doc='마감 운수사 항목')
    dto('ClosingResponse', 'closingId Long ; closingDate LocalDate ; status String ; operators List<ClosingOperatorItem>', 'lombok_data', st, doc='정산 마감 결과')
    dto('SettlementItem', 'tripCount Integer ; mode TransportMode ; gross Money', 'lombok_data', st, doc='정산 항목')
    dto('SettlementResponse', 'settlementId Long ; operator OperatorRef ; periodFrom LocalDate ; periodTo LocalDate ; gross Money ; net Money ; status String ; items List<SettlementItem>', 'lombok_data', st, doc='정산 상세')
    dto('SettlementSearchCond', 'operatorId String max=20 ; date LocalDate ; status String', 'lombok_data', st, ext='PageQuery', doc='정산 검색 조건')

    ctrl('SettleDailyController', st, '/settle', '"/settle"', 'egov', '일 정산(전자정부 방식)', service='SettleService', aggregate='Settlement')
    ctrl('SettlementController', st, '/api/v1/settlements', '"/api/v1/settlements"', 'rest', '정산', service='SettlementService', aggregate='Settlement')
    S = 'SettleDailyController'
    ep(S, 'GET', '/daily/list.do', 'selectDailySettleList', '일 정산 목록 조회', cond='DailySettleSearchVO', resp='DailySettleVO', wrap='rawlist', auth='xml:ROLE_SETTLE', classic=True)
    ep(S, 'POST', '/daily/execute.do', 'executeDailySettle', '일 정산 실행', body='SettleExecuteVO', resp='SettleExecuteResultVO', wrap='raw', auth='xml:ROLE_SETTLE', classic=True)
    ep(S, 'GET', '/operator/summary.do', 'selectOperatorSummary', '운수사 정산 요약 조회', params=[Q('operatorId', 'String', True), Q('periodFrom', 'String', True), Q('periodTo', 'String', True)], resp='OperatorSummaryVO', wrap='raw', auth='xml:ROLE_SETTLE', classic=True)
    ep(S, 'POST', '/adjust/register.do', 'registerAdjustment', '정산 조정 등록', body='AdjustmentRegisterVO', resp='Map:adjustId=integer,status=string', wrap='map', auth='xml:ROLE_SETTLE', classic=True)
    ep(S, 'POST', '/adjust/approve.do', 'approveAdjustment', '정산 조정 승인', body='AdjustmentApproveVO', resp='Map:adjustId=integer,status=string,approvedAt=string', wrap='map', auth='xml:ROLE_SETTLE', classic=True)
    ep(S, 'GET', '/reconcile/pg.do', 'selectPgReconcile', None, params=[Q('settleDate', 'String', True)], resp='Map:pgTotal=number,ourTotal=number,diff=number,mismatchCount=integer', wrap='map', auth='xml:ROLE_SETTLE', classic=True)
    ep(S, 'POST', '/reconcile/pg/run.do', 'runPgReconcile', '대사 실행', params=[Q('settleDate', 'String', True)], resp='Map:jobId=string,status=string', wrap='map', auth='xml:ROLE_SETTLE', classic=True)
    SE = 'SettlementController'
    ep(SE, 'POST', '/closing', 'closeSettlement', '정산 마감', body='ClosingRequest', resp='ClosingResponse', status=201, auth='role:ADMIN')
    ep(SE, 'GET', '/{settlementId}', 'getSettlement', '정산 상세 조회', params=[P('settlementId')], resp='SettlementResponse')
    ep(SE, 'GET', '', 'searchSettlements', '정산 목록 조회', cond='SettlementSearchCond', resp='SettlementResponse', wrap='page')

    # ------------------------------------------------------------ partner (snake_case, @Value, scopes, no wrapper)
    pt = 'partner'
    dto('PartnerTripView', 'tripId Long json=trip_id ; operatorCode String json=operator_code ; boardedAt OffsetDateTime json=boarded_at ; alightedAt OffsetDateTime json=alighted_at ; '
        'originStopId String json=origin_stop_id ; destStopId String json=dest_stop_id ; fareAmount BigDecimal json=fare_amount ; fareCurrency String json=fare_currency ; mediaType String json=media_type', 'value', pt, doc='운수사 여정 조회')
    dto('PartnerTripPage', 'items List<PartnerTripView> ; nextCursor String json=next_cursor', 'value', pt, doc='운수사 여정 페이지')
    dto('PartnerSettlementView', 'settlementId Long json=settlement_id ; operatorCode String json=operator_code ; periodFrom LocalDate json=period_from ; periodTo LocalDate json=period_to ; netAmount BigDecimal json=net_amount ; status String', 'value', pt, doc='운수사 정산 조회')
    dto('FirmwareAckRequest', 'deviceId String ! json=device_id ; firmwareVersion String ! json=firmware_version ; appliedAt OffsetDateTime ! json=applied_at ; result String ! ; operator OperatorRef', 'lombok_data', pt, doc='펌웨어 적용 확인')
    dto('FirmwareAckResponse', 'ackId String json=ack_id ; accepted Boolean', 'value', pt, doc='펌웨어 확인 응답')
    dto('BlacklistEntry', 'mediaHash String json=media_hash ; reasonCode String json=reason_code ; blockedAt OffsetDateTime json=blocked_at', 'value', pt, doc='차단 항목')
    dto('BlacklistDeltaResponse', 'since String ; nextCursor String json=next_cursor ; added List<BlacklistEntry> ; removed List<String>', 'value', pt, doc='차단 목록 증분')
    dto('EventSubscribeRequest', 'callbackUrl String ! max=300 json=callback_url ; eventTypes List<String> ! json=event_types ; secret String max=64', 'lombok_data', pt, doc='이벤트 구독 요청')
    dto('EventSubscribeResponse', 'subscriptionId String json=subscription_id ; status String', 'value', pt, doc='이벤트 구독 응답')
    ctrl('PartnerController', pt, '/partner/v1', '"/partner/v1"', 'partner', '운수사 연계 API', service='PartnerService', aggregate='PartnerAccess')
    PA = 'PartnerController'
    ep(PA, 'GET', '/trips', 'listTrips', '운수사 여정 조회', params=[Q('from', 'LocalDate', True, var='fromDate'), Q('to', 'LocalDate', True, var='toDate'), Q('operator_code', 'String', True, var='operatorCode'), Q('cursor'), Q('limit', 'Integer', False, '100')],
       resp='PartnerTripPage', wrap='raw', auth='scope:trips.read', pre_authorize="hasAuthority('SCOPE_trips.read')")
    ep(PA, 'GET', '/settlements', 'listSettlements', '운수사 정산 조회', params=[Q('operator_code', 'String', True, var='operatorCode'), Q('month', 'String', True)], resp='PartnerSettlementView', wrap='rawlist', auth='scope:settlements.read', pre_authorize="hasAuthority('SCOPE_settlements.read')")
    ep(PA, 'POST', '/devices/{deviceId}/firmware-ack', 'ackFirmware', '펌웨어 적용 확인', params=[P('deviceId', 'String')], body='FirmwareAckRequest', resp='FirmwareAckResponse', wrap='raw', auth='scope:devices.write', pre_authorize="hasAuthority('SCOPE_devices.write')")
    ep(PA, 'GET', '/blacklist/delta', 'blacklistDelta', '차단 목록 증분 조회', params=[Q('since', 'String', True), Q('cursor')], resp='BlacklistDeltaResponse', wrap='raw', auth='scope:blacklist.read', pre_authorize="hasAuthority('SCOPE_blacklist.read')")
    ep(PA, 'POST', '/events/subscribe', 'subscribeEvents', '이벤트 구독', body='EventSubscribeRequest', resp='EventSubscribeResponse', wrap='raw', status=201, auth='scope:events.write', pre_authorize="hasAuthority('SCOPE_events.write')")

    # ------------------------------------------------------------ admin (inherited controller, alias paths, health)
    ad = 'admin'
    dto('BlacklistEntryRequest', 'mediaId Long ! ; reasonCode String ! max=20 ; memo String max=200 ; expiresAt LocalDateTime', 'lombok_data', ad, doc='차단 등록 요청')
    dto('BlacklistEntryResponse', 'entryId Long ; mediaId Long ; reasonCode String ; blockedAt LocalDateTime ; expiresAt LocalDateTime ; blockedBy String', 'lombok_data', ad, doc='차단 응답')
    dto('AnomalyResponse', 'anomalyId Long ; accountId Long ; ruleCode String ; severity Severity ; detectedAt LocalDateTime ; status String ; evidence List<String>', 'lombok_data', ad, doc='이상거래 응답')
    dto('AnomalySearchCond', 'severity Severity ; status String ; from LocalDate ; to LocalDate', 'lombok_data', ad, ext='PageQuery', doc='이상거래 검색 조건')
    dto('AnomalyResolveRequest', 'resolution String ! max=20 ; note String max=500 ; operator OperatorRef', 'lombok_data', ad, doc='이상거래 처리 요청')
    dto('CodeItem', 'code String ; name String ; useYn String ; sortOrder Integer', 'lombok_data', ad, doc='코드 항목')
    dto('CodeGroupResponse', 'codeGroup String ; name String ; codes List<CodeItem>', 'lombok_data', ad, doc='코드 그룹')
    dto('CodeUpdateRequest', 'name String ! max=100 ; useYn String ! max=1 ; sortOrder Integer', 'lombok_data', ad, doc='코드 수정 요청')
    dto('AuditLogResponse', 'auditId Long ; actor String ; action String ; target String ; occurredAt LocalDateTime ; ip String ; details Map<String,Object>', 'lombok_data', ad, doc='감사 로그')
    dto('AuditSearchCond', 'actor String ; action String ; from LocalDate ; to LocalDate', 'lombok_data', ad, ext='PageQuery', doc='감사 로그 검색 조건')
    dto('HealthResponse', 'status String ; version String ; checkedAt OffsetDateTime', 'lombok_data', ad, doc='상태 점검')
    dto('LookupResponse', 'id String ; label String', 'lombok_data', ad, doc='조회 응답')
    ctrl('AdminBlacklistController', ad, '/api/v1/admin/blacklist', '"/api/v1/admin/blacklist"', 'rest', '운영자 차단 관리', service='AdminService', aggregate='Blacklist')
    ctrl('AdminAnomalyController', ad, '/api/v1/admin/anomalies', '"/api/v1/admin/anomalies"', 'rest', '이상거래 관리', service='AdminService', aggregate='Anomaly')
    ctrl('AdminCodeController', ad, '/api/v1/admin/codes', '"/api/v1/admin/codes"', 'rest', '공통 코드 관리', parent='AbstractLookupController', service='AdminService', aggregate='Code')
    ctrl('AdminAuditController', ad, '/api/v1/admin/audit-logs', '"/api/v1/admin/audit-logs"', 'rest', '감사 로그', service='AdminService', aggregate='AuditLog')
    ctrl('HealthController', ad, '/health', '"/health"', 'rest', '상태 점검', service='AdminService', aggregate='Health')
    ep('AdminBlacklistController', 'GET', '', 'listBlacklist', '차단 목록 조회', resp='BlacklistEntryResponse', wrap='list', auth='role:ADMIN')
    ep('AdminBlacklistController', 'POST', '', 'addBlacklist', '차단 등록', body='BlacklistEntryRequest', resp='BlacklistEntryResponse', status=201, auth='role:ADMIN')
    ep('AdminBlacklistController', 'DELETE', '/{entryId}', 'removeBlacklist', '차단 해제', params=[P('entryId')], wrap='void204', auth='role:ADMIN')
    ep('AdminAnomalyController', 'GET', '', 'searchAnomalies', '이상거래 조회', cond='AnomalySearchCond', resp='AnomalyResponse', wrap='page', auth='role:ADMIN')
    ep('AdminAnomalyController', 'POST', '/{anomalyId}/resolve', 'resolveAnomaly', '이상거래 처리', params=[P('anomalyId')], body='AnomalyResolveRequest', resp='AnomalyResponse', auth='role:ADMIN')
    ep('AdminCodeController', 'GET', '/{codeGroup}', 'getCodeGroup', '코드 그룹 조회', params=[P('codeGroup', 'String')], resp='CodeGroupResponse', alias=['/groups/{codeGroup}'], auth='role:ADMIN')
    ep('AdminCodeController', 'PUT', '/{codeGroup}/{code}', 'updateCode', '코드 수정', params=[P('codeGroup', 'String'), P('code', 'String')], body='CodeUpdateRequest', resp='CodeItem', auth='role:ADMIN')
    ep('AdminCodeController', 'GET', '/lookup/{id}', 'lookup', '코드 단건 조회', params=[P('id', 'String')], resp='LookupResponse', auth='role:ADMIN', inherited=True)
    ep('AdminAuditController', 'GET', '', 'searchAudit', '감사 로그 조회', cond='AuditSearchCond', resp='AuditLogResponse', wrap='page', auth='role:ADMIN')
    ep('HealthController', 'GET', '', 'health', None, resp='HealthResponse', wrap='raw', auth='public')
    return m
