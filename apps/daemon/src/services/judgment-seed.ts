import { judgmentDatasetLine, type JudgmentKind, type JudgmentSubject } from '@open-design/contracts';

/**
 * A seed dataset for training a local SI judge (laya-train / laya-evals JSONL).
 * Positives come from common Korean SI field and endpoint vocabulary; negatives
 * pair an item with a label of a different concept, including same-family
 * confusions (생성일시 vs 삭제일시). `split` keeps the training and held-out
 * vocabularies disjoint, so a held-out score measures unseen fields and
 * resources. The generator is deterministic for a given seed.
 */
export const SEED_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['memberId', '회원 ID'], ['memberName', '회원명'], ['loginId', '로그인 ID'], ['password', '비밀번호'],
  ['email', '이메일'], ['mobileNo', '휴대전화번호'], ['phoneNo', '전화번호'], ['birthDate', '생년월일'],
  ['gender', '성별'], ['address', '주소'], ['zipCode', '우편번호'], ['detailAddress', '상세주소'],
  ['orderNo', '주문번호'], ['orderDate', '주문일자'], ['orderStatus', '주문 상태'], ['orderAmount', '주문 금액'],
  ['productId', '상품 ID'], ['productName', '상품명'], ['unitPrice', '단가'], ['quantity', '수량'],
  ['totalAmount', '총 금액'], ['discountAmount', '할인 금액'], ['discountRate', '할인율'], ['taxAmount', '세액'],
  ['paymentMethod', '결제 수단'], ['paymentDate', '결제일자'], ['paymentStatus', '결제 상태'], ['cardNo', '카드번호'],
  ['deliveryMemo', '배송 요청 사항'], ['deliveryStatus', '배송 상태'], ['deliveryDate', '배송일자'], ['trackingNo', '운송장번호'],
  ['createdAt', '생성일시'], ['updatedAt', '수정일시'], ['deletedAt', '삭제일시'], ['createdBy', '생성자'],
  ['updatedBy', '수정자'], ['useYn', '사용 여부'], ['delYn', '삭제 여부'], ['sortOrder', '정렬 순서'],
  ['startDate', '시작일자'], ['endDate', '종료일자'], ['deptCode', '부서 코드'], ['deptName', '부서명'],
  ['employeeNo', '사번'], ['employeeName', '직원명'], ['positionName', '직위명'], ['hireDate', '입사일자'],
  ['salaryAmount', '급여액'], ['bankCode', '은행 코드'], ['accountNo', '계좌번호'], ['accountHolder', '예금주'],
  ['fileName', '파일명'], ['fileSize', '파일 크기'], ['filePath', '파일 경로'], ['contentType', '콘텐츠 유형'],
  ['title', '제목'], ['content', '내용'], ['viewCount', '조회수'], ['writerName', '작성자명'],
  ['noticeYn', '공지 여부'], ['replyCount', '댓글 수'], ['categoryCode', '분류 코드'], ['categoryName', '분류명'],
  ['approvalStatus', '결재 상태'], ['approverId', '결재자 ID'], ['approvedAt', '결재일시'], ['rejectReason', '반려 사유'],
  ['contractNo', '계약번호'], ['contractDate', '계약일자'], ['contractAmount', '계약 금액'], ['customerName', '고객명'],
  ['customerNo', '고객번호'], ['businessNo', '사업자등록번호'], ['companyName', '회사명'], ['ceoName', '대표자명'],
  ['stockQty', '재고 수량'], ['warehouseCode', '창고 코드'], ['inboundDate', '입고일자'], ['outboundDate', '출고일자'],
  ['errorCode', '오류 코드'], ['errorMessage', '오류 메시지'], ['requestId', '요청 ID'], ['resultCode', '결과 코드'],
  ['pageNo', '페이지 번호'], ['pageSize', '페이지 크기'], ['totalCount', '전체 건수'], ['keyword', '검색어'],
  ['reservationNo', '예약번호'], ['reservationDate', '예약일자'], ['roomType', '객실 유형'], ['checkInDate', '입실일자'],
  ['checkOutDate', '퇴실일자'], ['couponCode', '쿠폰 코드'], ['pointAmount', '포인트 금액'], ['refundAmount', '환불 금액'],
  ['refundReason', '환불 사유'], ['cancelDate', '취소일자'], ['cancelReason', '취소 사유'], ['memo', '메모'],
];

/**
 * Short, generic identifiers (`id`, `status`, `amount`, `custNm`) whose Korean label is a qualifier plus the
 * concept ("주문 ID", "결제 금액"). The long, specific fields above never taught this: a model trained on them
 * alone scored `id → 주문 ID` at 0.01. Each entry is [identifier, correct labels, pool of clearly wrong labels];
 * every correct label gets the next two wrong ones from the pool. The train and held-out lists are written out
 * (not shuffled) so the identifiers stay disjoint, and they are kept apart from the shuffled seed above so
 * adding them does not move any other split.
 */
type GenericField = readonly [identifier: string, correct: readonly string[], wrong: readonly string[]];

export const SEED_GENERIC_TRAIN: ReadonlyArray<GenericField> = [
  ['name', ['이름', '회원명', '상품명'], ['번호', '금액', '일자', '주소', '상태', '수량']],
  ['type', ['유형', '구분', '결제 유형'], ['금액', '이름', '일자', '번호', '주소', '수량']],
  ['code', ['코드', '분류 코드', '상태 코드'], ['일자', '이름', '금액', '주소', '수량', '비고']],
  ['no', ['번호', '일련번호', '계약번호'], ['이름', '금액', '주소', '상태', '일자', '수량']],
  ['count', ['건수', '수', '조회수'], ['일자', '이름', '주소', '상태', '금액', '비고']],
  ['date', ['일자', '날짜', '등록일자'], ['금액', '상태', '이름', '번호', '주소', '수량']],
  ['desc', ['설명', '상세 설명'], ['번호', '일자', '금액', '이름']],
  ['description', ['설명', '상품 설명'], ['금액', '코드', '일자', '번호']],
  ['remark', ['비고', '참고 사항'], ['금액', '일자', '번호', '이름']],
  ['note', ['비고', '메모'], ['번호', '상태', '금액', '일자']],
  ['seq', ['순번', '일련번호'], ['이름', '금액', '주소', '일자']],
  ['level', ['등급', '단계'], ['이름', '일자', '금액', '주소']],
  ['url', ['URL', '링크'], ['금액', '수량', '이름', '일자']],
  ['rate', ['비율', '할인율'], ['이름', '번호', '주소', '일자']],
  ['total', ['합계', '총계'], ['이름', '일자', '주소', '상태']],
  ['price', ['가격', '판매가'], ['이름', '일자', '상태', '주소']],
  ['qty', ['수량', '주문 수량'], ['이름', '일자', '주소', '상태']],
  ['phone', ['전화번호', '연락처'], ['이메일', '주소', '이름', '금액']],
  ['tel', ['전화번호', '연락처'], ['주소', '이름', '금액', '일자']],
  ['flag', ['여부', '구분'], ['금액', '이름', '일자', '주소']],
  ['message', ['메시지', '내용'], ['번호', '일자', '금액', '이름']],
  ['reason', ['사유', '이유'], ['금액', '번호', '일자', '이름']],
  ['result', ['결과', '처리 결과'], ['이름', '일자', '주소', '금액']],
  ['comment', ['댓글', '의견'], ['금액', '번호', '일자', '주소']],
  ['age', ['나이', '연령'], ['금액', '이름', '주소', '일자']],
  ['size', ['크기', '용량'], ['이름', '일자', '주소', '상태']],
  ['regDt', ['등록일자', '등록일시'], ['수정일자', '삭제일시', '이름', '금액']],
  ['modDt', ['수정일자', '수정일시'], ['등록일자', '삭제일시', '이름', '금액']],
  ['regId', ['등록자 ID', '등록자'], ['수정자 ID', '수정일자', '이름', '금액']],
  ['modId', ['수정자 ID', '수정자'], ['등록자 ID', '등록일자', '이름', '금액']],
  ['custNm', ['고객명', '고객 이름'], ['고객번호', '주소', '금액', '일자']],
  ['prodCd', ['상품 코드', '제품 코드'], ['상품명', '일자', '금액', '주소']],
  ['ordNo', ['주문번호', '주문 번호'], ['회원 ID', '주문 상태', '금액', '이름']],
  ['amt', ['금액', '합계 금액'], ['수량', '이름', '일자', '주소']],
  ['cnt', ['건수', '횟수'], ['금액', '이름', '주소', '일자']],
];

export const SEED_GENERIC_HELDOUT: ReadonlyArray<GenericField> = [
  ['id', ['ID', '아이디', '주문 ID', '회원 ID'], ['주문 상태', '결제 금액', '생성일시', '이메일', '배송지 주소', '회원명', '수량', '삭제 여부']],
  ['status', ['상태', '주문 상태', '처리 상태', '배송 상태'], ['주문번호', '생성일시', '결제 금액', '회원명', '이메일', '수량', '주소', '일자']],
  ['amount', ['금액', '결제 금액', '주문 금액', '합계 금액'], ['상태', '회원명', '생성일시', '주소', '이메일', '번호', '사용 여부', '이름']],
  ['state', ['상태', '진행 상태'], ['번호', '금액', '일자', '이름']],
  ['value', ['값', '설정 값'], ['일자', '이름', '주소', '상태']],
  ['time', ['시간', '시각'], ['금액', '이름', '주소', '상태']],
  ['number', ['번호', '일련번호'], ['이름', '일자', '주소', '금액']],
  ['text', ['텍스트', '본문'], ['번호', '금액', '일자', '상태']],
  ['image', ['이미지', '대표 이미지'], ['금액', '일자', '번호', '상태']],
  ['parentId', ['상위 ID', '부모 ID'], ['하위 ID', '이름', '금액', '일자']],
  ['rgstDt', ['등록일자', '등록일시'], ['수정일자', '삭제일시', '이름', '금액']],
  ['updtDt', ['수정일자', '수정일시'], ['등록일자', '삭제일시', '이름', '금액']],
  ['userNm', ['사용자명', '사용자 이름'], ['사용자 ID', '연락처', '금액', '일자']],
  ['statCd', ['상태 코드', '상태'], ['상품 코드', '일자', '금액', '이름']],
  ['dlvAddr', ['배송지 주소', '배송 주소'], ['배송 상태', '결제 금액', '이름', '일자']],
  ['ordAmt', ['주문 금액', '주문액'], ['주문번호', '주문 상태', '이름', '일자']],
];

const CONFUSIONS: Readonly<Record<string, readonly string[]>> = {
  createdAt: ['수정일시', '삭제일시'], updatedAt: ['생성일시'], deletedAt: ['생성일시'],
  startDate: ['종료일자'], endDate: ['시작일자'], unitPrice: ['수량', '총 금액'], quantity: ['단가'],
  totalAmount: ['할인 금액', '세액'], discountAmount: ['할인율', '총 금액'], discountRate: ['할인 금액'],
  createdBy: ['수정자'], updatedBy: ['생성자'], useYn: ['삭제 여부'], delYn: ['사용 여부'],
  inboundDate: ['출고일자'], outboundDate: ['입고일자'], checkInDate: ['퇴실일자'], checkOutDate: ['입실일자'],
  mobileNo: ['이메일', '주소'], phoneNo: ['이메일'], email: ['전화번호'], memberId: ['주문번호', '회원명'],
  orderNo: ['회원 ID', '상품 ID'], refundAmount: ['환불 사유'], cancelDate: ['취소 사유'], approverId: ['반려 사유'],
};

export const SEED_RESOURCES: ReadonlyArray<readonly [string, string]> = [
  ['orders', '주문'], ['members', '회원'], ['products', '상품'], ['payments', '결제'], ['deliveries', '배송'],
  ['notices', '공지사항'], ['posts', '게시글'], ['comments', '댓글'], ['files', '첨부파일'], ['categories', '분류'],
  ['employees', '직원'], ['departments', '부서'], ['approvals', '결재'], ['contracts', '계약'], ['customers', '고객'],
  ['coupons', '쿠폰'], ['reservations', '예약'], ['rooms', '객실'], ['refunds', '환불'], ['inventories', '재고'],
  ['warehouses', '창고'], ['invoices', '청구서'], ['accounts', '계좌'], ['codes', '공통코드'], ['menus', '메뉴'],
  ['roles', '권한'], ['schedules', '일정'], ['surveys', '설문'], ['events', '이벤트'], ['banners', '배너'],
  ['faqs', '자주 묻는 질문'], ['inquiries', '문의'], ['reviews', '리뷰'], ['points', '포인트'], ['shipments', '출고'],
  ['suppliers', '공급업체'], ['projects', '프로젝트'], ['tasks', '작업'], ['vehicles', '차량'], ['devices', '단말기'],
];

const ACTIONS: ReadonlyArray<readonly [string, string, string]> = [
  ['POST', '/api/v1/{r}', '{k} 등록'],
  ['GET', '/api/v1/{r}/{id}', '{k} 상세 조회'],
  ['GET', '/api/v1/{r}', '{k} 목록 조회'],
  ['PUT', '/api/v1/{r}/{id}', '{k} 수정'],
  ['DELETE', '/api/v1/{r}/{id}', '{k} 삭제'],
  ['POST', '/api/v1/{r}/{id}/cancel', '{k} 취소'],
  ['POST', '/api/v1/{r}/{id}/approve', '{k} 승인'],
  ['GET', '/api/v1/{r}/export', '{k} 엑셀 다운로드'],
];

export interface SeedCase { kind: JudgmentKind; subject: JudgmentSubject; correct: boolean }

/** mulberry32: small, deterministic and good enough for shuffling a seed set. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], next: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function fieldCases(pairs: ReadonlyArray<readonly [string, string]>, next: () => number): SeedCase[] {
  const labels = pairs.map(([, ko]) => ko);
  const out: SeedCase[] = [];
  for (const [identifier, ko] of pairs) {
    out.push({ kind: 'field-label', subject: { identifier, koreanLabel: ko }, correct: true });
    const wrong = (CONFUSIONS[identifier] ?? []).filter((w) => labels.includes(w) && w !== ko);
    while (wrong.length < 2 && labels.length > 2) {
      const w = labels[Math.floor(next() * labels.length)]!;
      if (w !== ko && !wrong.includes(w)) wrong.push(w);
    }
    for (const w of wrong.slice(0, 2)) out.push({ kind: 'field-label', subject: { identifier, koreanLabel: w }, correct: false });
  }
  return out;
}

function genericCases(entries: ReadonlyArray<GenericField>): SeedCase[] {
  const out: SeedCase[] = [];
  for (const [identifier, correct, wrong] of entries) {
    correct.forEach((label, i) => {
      out.push({ kind: 'field-label', subject: { identifier, koreanLabel: label }, correct: true });
      for (const offset of [0, 1]) {
        out.push({ kind: 'field-label', subject: { identifier, koreanLabel: wrong[(2 * i + offset) % wrong.length]! }, correct: false });
      }
    });
  }
  return out;
}

function businessCases(resources: ReadonlyArray<readonly [string, string]>, next: () => number): SeedCase[] {
  const out: SeedCase[] = [];
  for (const [r, k] of resources) {
    ACTIONS.forEach(([method, pathTemplate, nameTemplate], i) => {
      const path = pathTemplate.replace('{r}', r);
      const subject = (businessName: string): JudgmentSubject => ({ method, path, businessName });
      out.push({ kind: 'business-name', subject: subject(nameTemplate.replace('{k}', k)), correct: true });
      const others = ACTIONS.filter((_, j) => j !== i);
      out.push({ kind: 'business-name', subject: subject(others[Math.floor(next() * others.length)]![2].replace('{k}', k)), correct: false });
      const otherResources = resources.filter(([rr]) => rr !== r);
      if (otherResources.length) out.push({ kind: 'business-name', subject: subject(nameTemplate.replace('{k}', otherResources[Math.floor(next() * otherResources.length)]![1])), correct: false });
    });
  }
  return out;
}

export function seedJudgmentCases(options: { split?: 'train' | 'heldout' | 'all'; seed?: number; kinds?: readonly JudgmentKind[] } = {}): SeedCase[] {
  const next = random(options.seed ?? 20261101);
  const kinds = options.kinds ?? ['field-label', 'business-name'];
  const pick = <T>(items: readonly T[]) => {
    const shuffled = shuffle(items, next);
    const cut = Math.floor(shuffled.length * 0.7);
    return options.split === 'heldout' ? shuffled.slice(cut) : options.split === 'train' ? shuffled.slice(0, cut) : shuffled;
  };
  const fields = pick(SEED_FIELDS), resources = pick(SEED_RESOURCES);
  const generic = options.split === 'heldout' ? SEED_GENERIC_HELDOUT : options.split === 'train' ? SEED_GENERIC_TRAIN : [...SEED_GENERIC_TRAIN, ...SEED_GENERIC_HELDOUT];
  const cases = [
    ...(kinds.includes('field-label') ? fieldCases(fields, next) : []),
    ...(kinds.includes('business-name') ? businessCases(resources, next) : []),
    ...(kinds.includes('field-label') ? genericCases(generic) : []),
  ];
  return shuffle(cases, next);
}

export function seedJudgmentDataset(options: Parameters<typeof seedJudgmentCases>[0] = {}): string {
  const lines = seedJudgmentCases(options).map((c) => judgmentDatasetLine(c));
  return lines.length ? `${lines.join('\n')}\n` : '';
}
