# DB 스키마 감시와 화면·API 영향 분석

프로젝트에 연결한 PostgreSQL의 스키마를 주기적으로 확인하고, 문서에 기록된 의존 관계를 따라 영향을 받은 API와 화면을 표시합니다. 인터페이스 명세서와 화면 명세서 편집기에 **화면·API·DB 영향 분석** 패널이 있습니다. 같은 기능을 `monofield` CLI에서도 실행할 수 있습니다.

## 시작하기

1. Desktop의 DB 연결 설정에서 PostgreSQL 연결을 등록하고 읽기 승인을 설정합니다. 현재 DB broker는 PostgreSQL을 지원합니다.
2. 프로젝트 또는 현재 개발 모듈에서 사용할 DB를 선택하고 개발용 연결을 활성화합니다.
3. 명세서 편집기에서 **감시 켜기**를 누르고 간격을 지정합니다. 기본 60초이며 10초부터 24시간까지 설정할 수 있습니다.
4. **지금 확인**을 눌러 첫 스키마를 기준으로 수집합니다. 이후 감시는 daemon이 실행 중인 동안 계속됩니다. 첫 자동 확인은 다음 감시 주기에 수행됩니다.
5. 변경을 확인하고 필요한 문서 수정과 검토를 마친 뒤 **확인한 변경을 새 기준으로 지정**을 누릅니다. 다음 확인에서도 같은 변경이 유지되며, 자동으로 기준을 덮어쓰지 않습니다.

백그라운드 감시는 저장된 읽기 승인이 있는 연결만 사용합니다. 매번 승인이 필요한 정책이면 승인 창을 반복해서 열지 않고 실패 상태를 표시합니다. Desktop 연결이 끊기거나 DB 선택이 바뀌어도 이전 스키마를 현재 정상 상태로 표시하지 않습니다. 현재 개발 모듈의 DB 선택을 다시 확인하며, 이전 모듈의 수집 결과를 새 모듈에 노출하지 않습니다.

## 감지하는 변경

- 테이블 추가·삭제, 컬럼 추가·삭제, 전체 타입과 크기 및 NULL 허용 여부 변경.
- 제약조건·인덱스·기본값 정의 변경은 테이블 구조 해시의 변화로 감지합니다. 이 경우 테이블의 연결 근거가 있는 항목을 검토 대상으로 표시합니다.
- 행 데이터는 수집하지 않습니다. 기본값이나 제약조건의 실제 표현식은 Desktop 밖으로 전달하지 않고 해시만 보존합니다.
- DB 계정이 조회할 수 있는 테이블의 범위에서 분석합니다. 권한 변화도 관찰 가능한 스키마의 변화로 나타날 수 있습니다.

스키마 감시는 PostgreSQL의 주기적인 메타데이터 조회입니다. 변경 직후 즉시 전달하는 DB 이벤트 구독은 아닙니다. 뷰·함수·트리거·권한 변경 자체의 완전한 감시는 현재 범위 밖이며, 마지막 확인 시각을 함께 확인해야 합니다.

감시 상태와 스키마 메타데이터는 재시작 후에도 유지됩니다. 저장 경계는 루트 [AGENTS.md의 Daemon data directory contract](../AGENTS.md#daemon-data-directory-contract)를 따릅니다. 연결 URL·비밀번호는 기존 Desktop 저장소에 남습니다.

## 문서의 연결 근거

API 필드가 특정 DB 컬럼에 의존한다면 해당 필드의 `evidenceRefs`에 정확한 대상을 기록합니다. 연결 ID는 실제 프로젝트에서 선택한 ID를 사용합니다.

```json
{
  "kind": "database",
  "ref": "public.orders.id",
  "database": {
    "connectionId": "<선택한 연결 ID>",
    "schema": "public",
    "table": "orders",
    "column": "id"
  }
}
```

화면 또는 화면의 callout이 특정 API에 의존하면 화면의 `evidenceRefs` 또는 callout의 `evidenceRefs`에 문서와 항목 ID를 기록합니다.

```json
{
  "kind": "requirement",
  "ref": "주문 목록 API",
  "document": {
    "path": "docs/orders.interface-spec.json",
    "itemId": "IF-001"
  }
}
```

`itemId`를 생략하면 해당 문서 전체의 항목에 연결됩니다. API ID가 없으면 `GET /orders`처럼 실제 method와 path를 합친 식별자를 사용합니다. 코드 근거의 `ref`와 기존 `sourceFile`도 코드 변경 영향의 시작점으로 사용합니다.

**연결 영향 분석**은 저장된 문서를 읽고 `DB 컬럼 → API → 화면` 또는 `코드 → API → 화면` 경로를 표시합니다. 순환 관계도 처리하며 변경 원인에서 영향을 받은 항목까지의 경로를 남깁니다. 자동 검색은 프로젝트 JSON 중 지원 명세서를 읽고 `*.proposed.json` 초안은 제외합니다. 큰 프로젝트에서는 패널에 분석할 문서를 줄마다 입력해 범위를 선택합니다.

명세서 경로·항목이 없거나 기존 DB 근거가 단순 문자열뿐이면 확인할 연결로 표시합니다. 연결 근거가 없는 항목은 영향 여부를 알 수 없는 항목으로 남깁니다. 코드를 읽지 않고 의존 관계를 추측하거나, 수집 실패를 변경 없음으로 바꾸지 않습니다. 언어별 import/ORM 관계를 자동으로 추론하는 기능은 아닙니다. DTO와 DB 관계를 수집할 때 관련 코드 근거와 문서 연결을 함께 기록해야 전이 영향에 포함됩니다.

분석은 문서를 자동 수정하거나 AI를 호출하지 않습니다. 기존 [명세서 변경 검토](document-change-review.md) 흐름에서 AI 제안을 검토하고 적용합니다.

## CLI

```bash
monofield database watch <project-id> enable --interval 60 --json
monofield database watch <project-id> check --json
monofield database watch <project-id> status --json
monofield docs graph --project <project-id> --json
monofield docs graph --project <project-id> --inputs-file selected-documents.json --json
monofield database watch <project-id> acknowledge --expected-sha <latestSha256> --json
monofield database watch <project-id> disable --json
```

`selected-documents.json`은 프로젝트 상대 경로의 JSON 배열입니다. UI와 CLI 모두 같은 daemon API를 사용합니다. 확인 이후 다른 스키마가 수집되면 오래된 해시의 기준 갱신 요청은 충돌로 거부합니다. 감시와 그래프 분석은 모델 토큰을 사용하지 않습니다.
