# REA·Laya 실전 사용 가이드 (SI 인수인계)

설정 절차 자체는 [REA + Laya로 기존 시스템 인수인계하기](rea-laya-handover.md)에
있습니다. 이 문서는 **어떤 상황에서 무엇을 쓰는지**, 그리고 실제로 어떻게 지시하는지를
정리합니다.

## 한 줄 정리

| 도구 | 역할 | 하지 않는 일 |
| --- | --- | --- |
| **MonoField 스캐너** (`scan_spring.py`, `scan_openapi.py` 등) | 소스·OpenAPI 계약에서 인터페이스 명세서를 결정론적으로 생성 | 실행 동작 관찰 |
| **REA** (Reverse Engineer Anything, MCP 서버) | 소스가 없거나 부족할 때 실행 화면·네트워크·배포물·SQLite에서 **근거(Evidence ID)** 수집 | 명세서 자동 완성, 전체 시스템 자동 탐색 |
| **Laya** (로컬 판단 모델) | "이 근거가 이 주장을 뒷받침하는가?" 같은 **닫힌 질문**에 확률로 답하는 보조 판단 | 코드 작성, 승인, 실행 증거 생성 |
| **Codex / Claude Code** | 위 근거를 읽고 명세서 JSON 작성·코드 수정 | — |

## 상황별 선택

| 인수인계 상황 | 먼저 쓸 것 | REA 도구 | 비고 |
| --- | --- | --- | --- |
| Spring 소스가 있다 | `scan_spring.py` | 필요 없음 | eGov `.do`·`*VO`·한글 Javadoc 지원 |
| springdoc/Swagger JSON이 있다 | `scan_openapi.py` | 필요 없음 | 계약이 코드보다 늦을 수 있으니 소스 스캔과 비교 |
| 소스는 없고 **실행 중인 화면**에 접속할 수 있다 | REA | `capture_browser_scenario`, `inspect_web_page` | 화면 조작 → API 요청·응답 본문·스크린샷 → 화면명세서·인터페이스 명세서 |
| 고객사 보안 때문에 **MonoField PC에서 접속 불가** | 현장 담당자가 브라우저 개발자 도구에서 **HAR 저장** | `inspect_web_network_capture` | 실행 권한 없이 요청·응답만 분석. HAR에는 토큰·개인정보가 들어갈 수 있으니 반출 규정 확인 |
| 프런트엔드 **JS 번들**만 있다 | REA | `analyze_web_bundle`, `analyze_javascript_application`, `trace_web_source_location` | 리터럴 API 경로·모듈 관계. 동적 경로는 화면 관찰로 보완 |
| **AS-IS/TO-BE 전환** 사업 | REA | `compare_web_captures`, `compare_web_screenshots` | 같은 시나리오를 두 시스템에서 캡처해 차이를 근거로 남김 |
| **C#/.NET** 레거시 | REA | `inspect_managed_artifact`, `inspect_managed_members` | 정적 검사, 실행하지 않음 |
| **SQLite** 스냅샷 | REA | `inspect_sqlite_database` | 스키마 → 필요한 테이블·컬럼만 조회 |
| **Oracle·Tibero·MySQL** 운영 DB | DBA에게 스키마 DDL/메타데이터 추출 요청 | 해당 없음 | REA는 SQLite만, MonoField DB 연결은 현재 PostgreSQL만 지원 |
| **Java WAR/JAR만** 있고 소스 없음 | (미검증) WAR를 풀고 Java 디컴파일러로 소스 복원 → `scan_spring.py` | REA 대상 아님 | REA의 JADX 연동은 Android APK 전용 |

## REA 연결 (Windows 기준)

1. **Node.js 24.15 이상**과 npm을 설치합니다(REA는 Node 22.19+, 24.11+, 26+를
   지원하지만 SQLite 검사는 24.15+가 필요).
2. MonoField **Settings → MCP → Add MCP server**에서 **REA**를 추가하거나
   `monofield rea configure --json`을 실행합니다. 프리셋은
   `npx -y rea-agents@6.7.0 --mcp`입니다.
3. **Claude Code**를 쓰면 새 대화에서 바로 REA 도구가 보입니다.
   **Codex**는 MonoField 설정이 자동 전달되지 않으므로 한 번 직접 등록합니다.

   ```sh
   codex mcp add rea -- npx -y rea-agents@6.7.0 --mcp
   ```

4. 브라우저 캡처에는 설치된 Chrome/Edge 등 Chromium 계열 브라우저가 필요합니다.
5. 사용자님의 포크(`jhy0285/rea-yj`)를 쓰려면 MCP 명령을
   `node <rea-yj 경로>/scripts/rea.mjs --mcp`로 바꿉니다. 포크는 현재 6.4.0이고
   프리셋은 6.7.0이라 도구 목록이 다를 수 있습니다. 둘 중 하나로 통일하세요.

## 실제로 이렇게 지시합니다

`legacy-system-handover` 스킬을 선택하고, **대상·허용 조작·질문**을 분명히
적습니다. 대상이 모호하면 에이전트가 되묻도록 스킬이 설계돼 있습니다.

**화면 기반 인수인계**

```text
http://test.example.go.kr:8080 의 민원 신청 화면을 REA로 조사해 줘.
테스트 계정 tester01로 로그인해서 목록 조회 → 상세 → 신청서 임시저장까지만 조작해.
각 단계에서 호출된 API의 요청·응답 본문과 화면 스크린샷을 근거로 남기고,
인터페이스 명세서와 화면명세서 초안을 만들어. 관찰하지 못한 필수 여부는 TBD로 둬.
```

**HAR 기반 (현장 반출)**

```text
docs/evidence/minwon-20261023.har 를 REA로 분석해서 호출된 API 목록과
요청·응답 필드를 정리하고 인터페이스 명세서 초안을 만들어.
HAR 안의 토큰·주민번호 같은 값은 명세서 예시에 옮기지 말고 마스킹해.
```

**전환 사업 비교**

```text
AS-IS(http://old.example) 와 TO-BE(http://new.example) 에서 같은 "사용자 조회" 시나리오를
REA로 각각 캡처하고 compare_web_captures 로 요청·응답 차이를 비교해 줘.
차이가 있는 필드만 인터페이스 명세서 변경 제안으로 만들어.
```

에이전트가 쓴 명세서는 **AI 제안 검토**에서 이번에 추가된 **호출자 호환성**
(호환성 깨짐 / 확인 필요 / 추가 변경)과 함께 검토한 뒤 적용합니다. 브라우저 기록이 있으면
아래 [브라우저 기록과 대조](#작성한-명세서를-브라우저-기록과-대조하기)로 명세서가 기록과
맞는지도 확인합니다.

## 작성한 명세서를 브라우저 기록과 대조하기

REA의 `capture_browser_scenario`가 남긴 기록(`rea.browser-scenario-capture` JSON)에는 화면
조작 중 **실제로 오간 요청·응답**이 들어 있습니다. 에이전트가 이를 보고 쓴 명세서, 또는
소스에서 뽑은 명세서가 그 기록과 맞는지 MonoField가 기계적으로 대조합니다. 기록 파일을
프로젝트 폴더에 넣어 두면 됩니다.

**화면**: 인터페이스 명세서를 열고 **브라우저 증거 대조 (REA)** 패널에서 기록 파일을
고른 뒤 **증거와 대조**를 누릅니다(편집 내용은 먼저 저장해야 합니다. 대조는 저장된
파일을 읽습니다). 발견 사항은 엔드포인트별로 묶여 나오고, 반영할 항목을 체크한 뒤
**선택한 N건을 편집기에 반영**을 누르면 **편집기에만** 들어갑니다. 저장은 직접 합니다.

**CLI** (같은 데몬 API를 호출합니다):

```sh
monofield rea evidence --project <프로젝트ID>
monofield rea cross-check --project <프로젝트ID> --input docs/orders.interface-spec.json \
  --evidence evidence/minwon-capture.json --json
monofield rea apply --project <프로젝트ID> --input docs/orders.interface-spec.json \
  --evidence evidence/minwon-capture.json --finding '<cross-check가 알려준 id>' --write
```

`--write` 없이 `apply`를 실행하면 결과만 출력하고 파일은 바꾸지 않습니다. `--input` 없이
`--write --out docs/observed.interface-spec.json`을 쓰면 기록에서 관찰한 엔드포인트만으로
초안을 새로 만듭니다. 같은 파일에 덮어쓸 때는 대조 이후 파일이 바뀌었으면 거부합니다.

발견 사항의 뜻:

| 종류 | 의미 | 반영하면 |
| --- | --- | --- |
| 명세서에 없는 엔드포인트 | 기록에는 호출이 있는데 명세서에 행이 없음 | 경로를 일반화(`/orders/1001` → `/orders/{id}`)해 새 행 추가 |
| 명세서에 없는 필드 | 응답·요청·쿼리에 있는데 명세 필드가 아님 | 한글명이 빈 새 행 추가 |
| 필드 이름 불일치 | 기록의 이름이 명세 필드와 대소문자·`_`만 다름 (`net_amount` ≠ `netAmount`) | 명세 필드 이름을 기록 쪽 이름으로 변경 |
| 데이터 타입 불일치 | 명세 타입과 관찰된 JSON 타입이 다름 | 타입을 관찰값으로 변경 |
| 문서화되지 않은 오류 응답 | 4xx·5xx 응답의 코드가 엔드포인트 메모에 없음 | 메모에 관찰된 오류 코드 추가 |
| 증거 본문이 변경됨 | 기록의 본문이 저장된 SHA-256과 맞지 않음 | 반영 대상 아님, 기록을 다시 받아야 함 |

반영 대상이 아닌 항목(요청 실패, 관찰되지 않은 명세 필드, 실행되지 않은 엔드포인트,
본문을 읽을 수 없음)은 참고용으로만 표시합니다.

주의:

- **"관찰되지 않음"은 "없음"이 아닙니다.** 명세에 있는데 기록에 없는 필드는 그 시나리오에서
  나타나지 않았을 뿐입니다. 응답 필드는 성공(2xx) 본문에서만 비교하고, 오류 본문은 오류
  코드 요약에만 씁니다. 경로 파라미터 값은 비교하지 않습니다.
- 반영으로 추가된 행은 **한글명이 비어 있고 필수 여부가 `TBD`, 검토 상태가 `unreviewed`**
  입니다. 저장한 뒤 **판단 검토**를 실행하고 한글명을 채우세요.
- **응답 예시는 기본으로 복사하지 않습니다.** 기록된 본문은 실제 운영 데이터일 수 있습니다.
  개인정보가 없는지 확인한 뒤에만 `--include-examples`(화면에서는 "기록된 응답 예시도 함께
  복사")를 쓰세요. 복사하면 `exampleSource: live-probe`로 표시됩니다.
- 반영된 항목에는 기록 파일과 트랜잭션 ID를 가리키는 `kind: browser` 근거가 붙습니다. 이
  근거 첨부를 끄려면 `--no-attach-evidence`(화면에서는 첨부 체크 해제)를 씁니다.
- 메모는 화면 언어가 한국어이면 한국어, 그 밖이면 영어로 씁니다(CLI는 기본 한국어,
  `--note-lang ko|en`).

## Laya는 언제 쓰나

Laya는 문장을 생성하지 않고 **정해진 질문에 라벨·점수·예/아니오 확률**로 답하는
작은 판단 모델입니다(Apache-2.0, 로컬 실행). SI 인수인계에서 쓸 만한 곳은 세
가지입니다.

1. **근거 검토**: "REA가 캡처한 409 응답이 '미결제 주문은 정산 불가' 규칙을
   뒷받침하는가?" → `monofield jev review --request-file review.json --json`
   (supporting / contradicting / unknown).
2. **변경 요청 분류**: 들어온 요청을 버그·기능·명세 수정, 위험도 높음·낮음으로 1차 분류.
3. **검증 후보 고르기**: 여러 시나리오 중 먼저 확인할 것을 고를 때 참고 점수.

설정(PowerShell, 별도 Python 가상환경):

```powershell
python -m venv .venv; .venv\Scripts\Activate.ps1
python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
python -m pip install 'laya[serve]==0.4.20'
$env:LAYA_HOST='127.0.0.1'; $env:LAYA_PORT='8000'; $env:LAYA_DEVICE='cpu'
$env:LAYA_MODELS='multilingual'; $env:LAYA_DEFAULT_MODEL='multilingual'
$env:LAYA_PRELOAD='1'; $env:LAYA_JEV_STRICT='1'; $env:LAYA_REVISION='reviewed'
laya-serve
```

```sh
monofield jev configure --backend local --local-url http://127.0.0.1:8000 --model multilingual --json
```

주의할 점:

- **한국어에는 `multilingual` 체크포인트**를 씁니다. 영어 기본 모델은 입력 길이가 짧습니다.
- 공개 리뷰에 따르면 선택지가 많은 분류에서 정확도가 크게 떨어지고, 확률이
  과신되는 경향이 있습니다. **자기 업무 예시 수십 건으로 먼저 검증**하고 임계값을
  정한 뒤 쓰세요. JEV용 임계값을 그대로 옮기지 마세요.
- 결과는 참고용입니다. 명세서 승인·배포 판단의 근거로 쓰지 않습니다. Laya 없이도
  REA 조사와 문서 출력은 그대로 됩니다.

## 공통 주의사항

- **운영 시스템에서 쓰기 조작 금지.** 화면 시나리오는 테스트 계정·테스트 데이터로만
  실행합니다. DB는 백업 사본이나 정지 상태 스냅샷을 씁니다.
- REA 분석은 로컬에서 실행되지만, 에이전트가 받은 도구 결과는 **선택한 모델
  제공자로 전송**됩니다. 고객사 데이터 반출 기준을 먼저 확인합니다.
- 근거 상태를 그대로 옮깁니다. `not_exposed`, `no-match`, `unknown`은 "없음"이
  아닙니다. 관찰하지 않은 동시성·권한·장애 복구·외부 연계는 미확인으로 남깁니다.

## 현재 공백 (후속 과제)

- **Oracle·Tibero 스키마 연결**: 공공 SI에서 가장 흔한 DB지만 MonoField DB 연결은
  PostgreSQL만 지원합니다.
- **JVM 배포물(WAR/JAR) 분석**: 소스 없는 Java 서버는 디컴파일 후 스캔하는 우회만 가능합니다.
- **Codex 자동 MCP 전달**: Claude Code·OpenCode와 달리 Codex는 수동 등록이 필요합니다.

근거: REA 저장소 README(`jhy0285/rea-yj` 커밋 `bb54082`)와 등록된 MCP 도구 목록,
MonoField의 [REA 실행 보고서](testing/rea-handover-2026-10-22.md),
[JEV·로컬 판단 문서](jev-decisions.md).
