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

1. **REA는 모노필드에 들어 있습니다.** `rea-agents` 6.7.0이 데몬의 고정 의존성으로 함께 설치되고(잠금 파일이 해시를
   기록), 모노필드 자신의 실행 환경(개발 중에는 Node.js, 설치본에서는 Node.js로 동작하는 Electron)으로 실행됩니다.
   그래서 **Node.js 설치와 npx 다운로드가 필요 없습니다.** 내장본을 쓸 수 없을 때(설치본에 없거나 실행 환경의 Node.js가
   REA 지원 범위 밖)만 예전처럼 `npx -y rea-agents@6.7.0 --mcp`가 REA를 내려받아 실행합니다. 이때는 Node.js 24.15
   이상과 npm이 필요합니다(REA는 Node 22.19+, 24.11+, 26+를 지원하지만 SQLite 검사는 24.15+가 필요).
2. MonoField **Settings → 외부 MCP**에서 **REA를 MCP 목록에 추가**를 누르고 저장하거나 `monofield rea configure --json`을
   실행합니다. 저장되는 명령은 그대로 `npx -y rea-agents@6.7.0 --mcp`이지만, 대화가 시작될 때 이 고정 버전 항목은
   내장본으로 바뀌어 실행됩니다. 명령이나 버전을 직접 바꾼 항목은 바꾸지 않습니다.
3. **Claude Code**를 쓰면 새 대화에서 바로 REA 도구가 보입니다.
   **Codex**는 MonoField 설정이 자동 전달되지 않으므로 한 번 직접 등록합니다. 내장본을 등록하려면 점검 화면 아래쪽
   "다른 AI 도구에 내장 REA를 직접 등록할 때 쓰는 실행 정보"(또는 `monofield rea doctor`)에 나오는 명령·인자·환경 변수를
   씁니다. 내장본 대신 npx를 쓰려면:

   ```sh
   codex mcp add rea -- npx -y rea-agents@6.7.0 --mcp
   ```

4. 브라우저 캡처에는 설치된 Chrome/Edge 등 Chromium 계열 브라우저가 필요합니다.
5. **한 화면에서 점검**: Settings → MCP(또는 Integrations → MCP) 맨 위의 **REA 설치·연결 점검**이
   내장 REA(쓸 수 있으면 Node.js와 npx는 "필요 없음"으로 표시), Node.js 버전(rea-agents 6.7.0 패키지가 선언한
   `^22.19.0 || ^24.11.0 || >=26.0.0`), npx, MCP 등록(이상 내장본이 없을 때 필수)과
   Chromium 계열 브라우저, Ghidra, 다른 네이티브 엔진(Hopper·IDA), Java·JADX·Apktool·tshark·adb(선택)를 한 번에 보여 줍니다.
   MCP에 REA가 없으면 **REA를 MCP 목록에 추가**를 누른 뒤 저장합니다. 터미널에서는 `monofield rea doctor [--json]`.
   PATH와 일반 설치 위치만 확인하고 아무것도 설치하지 않으므로, 다른 곳에 설치한 도구는 "찾지 못함"으로 나올 수 있습니다.
   "준비됨"이어도 실제 연결은 새 에이전트 대화에서 REA 도구가 보이는지로 확인합니다.
6. **실행 파일(exe·dll)까지 보려면 Ghidra**: REA는 Ghidra를 포함하지 않고, 설치된 Ghidra를 `GHIDRA_INSTALL_DIR`
   환경 변수(절대 경로)로 찾습니다. Java는 `JAVA_HOME`(없으면 PATH의 java)을 씁니다. PATH에 Ghidra가 있어도 이 변수가
   없으면 찾지 못합니다.
   1. [Ghidra](https://github.com/NationalSecurityAgency/ghidra/releases)와 그 버전이 요구하는 JDK를 설치합니다.
   2. Settings → **외부 MCP**의 REA 항목을 펼쳐 **선택 폴더**의 **Ghidra 폴더**(`C:\ghidra_<버전>_PUBLIC`)와, 필요하면
      **Java(JDK) 폴더**(`C:\Program Files\...\jdk-<버전>`)를 입력하고 저장합니다. 터미널에서는
      `monofield rea configure --ghidra-dir <폴더> [--java-home <폴더>]`이고, 지우려면 `--clear-ghidra-dir`,
      `--clear-java-home`입니다. 두 입력은 아래 **Env (KEY=VALUE)** 칸의 `GHIDRA_INSTALL_DIR`·`JAVA_HOME` 줄과 같은
      값입니다. 시스템 환경 변수로 넣어도 됩니다.
   3. 점검 화면의 **Ghidra**가 초록이면 됩니다(폴더 안에 `support\analyzeHeadless.bat`가 있는지까지 봅니다).

   주의: REA는 이 두 값이 **비어 있거나 상대 경로면 시작 자체를 하지 않습니다.** 입력 칸을 비워 두면 그 값은 아예 저장되지
   않으니 안전하고, 상대 경로는 입력 칸이 경고하며 점검 화면이 빨간 필수 항목으로 알려 줍니다. 저장된 폴더는 다른
   환경 변수처럼 암호화 저장소에 들어가 화면에는 "저장됨(숨김)"으로만 보이며, 바꾸려면 새 경로를 입력합니다. REA 6.7.0의 Windows Ghidra 지원은 "P0(실험적)"이며 일반
   PE 실행 파일·DLL만 받습니다(.NET 어셈블리는 REA의 별도 .NET 분석으로). 근거: rea-agents 6.7.0 패키지의 README와
   환경 변수 검사 코드(npm 레지스트리에서 받아 읽기만 함, 실행하지 않음).
7. 사용자님의 포크(`jhy0285/rea-yj`)를 쓰려면 MCP 명령을
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

## REA 증거를 화면으로 보기 (REA Studio)

REA가 남긴 증거 JSON(브라우저 캡처, SQLite 검사, 정적 분석, 기능 추적)은 100KB~1MB라 그대로는 읽기 어렵습니다.
프로젝트 파일 목록에서 이런 JSON을 열면 **REA 스튜디오** 화면이 열리고, **원본 JSON** 버튼으로 텍스트로 돌아갈 수 있습니다.
(REA 증거인지는 파일 앞부분만 보고 판단하므로 다른 JSON 파일은 그대로 열립니다.)

- **브라우저 캡처**: 단계별 소요 시간 막대, 단계마다 캡처한 스크린샷·DOM·접근성 트리, 모든 요청(API만 보기, 경로 필터)과 요청·응답 본문.
- **SQLite 검사**: 테이블과 외래 키를 관계도로 그리고, 컬럼·UNIQUE·CHECK·샘플 행을 보여 줍니다.
- **정적 분석**: REA가 밝힌 적용 범위·의미 분석 범위·미확인 개수, 애플리케이션 그래프, 미확인으로 남은 이유.
- **기능 추적·분석 뷰**: 시드와 일치 여부, REA가 적은 사실.

화면은 REA가 말한 것만 보여 줍니다. 본문·스크린샷은 데몬이 기록된 SHA-256과 맞는지 확인한 뒤에만 표시하고(맞지 않으면
표시하지 않고 알립니다), REA의 한계(limitations)와 미확인(unknowns)은 그대로 펼쳐 둡니다. 제약 조건은 `CREATE TABLE` 선언에서
읽은 것이라 연결이 실제로 강제했는지는 알 수 없고, 기능 추적이 "일치 없음"이어도 그 기능이 없다는 뜻이 아닙니다.

같은 내용을 터미널에서도 볼 수 있습니다 (같은 데몬 API):

```sh
monofield rea files --project <프로젝트ID>
monofield rea show  --project <프로젝트ID> --file evidence/browser.json [--json]
```

### 증거를 대화에 넣기

스튜디오의 단계·요청·테이블·그래프 노드·추적 경로마다 **대화에 넣기** 버튼이 있고, 위쪽에 **파일 전체를 대화에 넣기**가 있습니다.
누르면 채팅 입력창 끝에 `<rea-evidence file="…" evidence_id="…" pointer="steps[step_index=1]">` 블록이 붙습니다(입력창이 비어
있으면 "아래 REA 증거를 기준으로 만들어 주세요…" 안내문이 앞에 붙고, 이미 쓴 내용은 지우지 않으므로 여러 개를 모은 뒤 보내면 됩니다).
블록에는 무엇을 했는지(동작·결과·페이지·그 단계의 API 호출), 출처(REA 버전·confidence·authority), REA의 미확인·한계 개수가 들어갑니다.
단계의 스크린샷이 기록된 SHA-256과 맞으면 증거 파일 옆 `rea-cite/` 폴더에 PNG로 저장하고 그 경로를 블록에 적으므로, 에이전트가
그 파일을 열어 화면을 봅니다.

캡처된 값(요청·응답 본문, 화면 문구, SQLite 행)은 실제 데이터라 기본으로는 **구조만** 넣습니다. JSON은 키와 타입(`{ id: number, … }`),
화면은 접근성 트리에서 역할과 제목·버튼·열 이름만 남기고 셀 값·본문 문구는 뺍니다. **캡처된 값 포함**을 켜야 본문 발췌, 화면 문구,
SQLite 행 5개가 들어갑니다. 터미널(외부 에이전트)에서는 같은 블록을 이렇게 받습니다(블록은 stdout, 저장한 파일은 stderr):

```sh
monofield rea cite --project <프로젝트ID> --file evidence/browser.json --step 1 [--include-values] [--json]
monofield rea cite --project <프로젝트ID> --file evidence/db.json --table orders
```

### 원본과 재현본 대조

다시 만든 화면·기능은 원본과 **같은 시나리오로 REA 브라우저 캡처**를 한 번 더 남긴 뒤, 원본 캡처를 열고 **재현본과 대조**를 누릅니다.
같은 프로젝트의 다른 브라우저 캡처를 고르면 단계마다 **일치 / 다름 / 재현본에 없음 / 재현본에만 있음**이 나옵니다.

- 단계는 단계 ID가 절반 이상 같으면 ID로, 아니면 순서로 짝짓습니다.
- 비교 항목: 동작, 결과, 페이지 경로(origin은 무시: 재현본은 보통 다른 주소에서 돕니다), 그 단계의 API 호출(경로의 숫자·UUID는 `{n}`·`{id}`로
  바꿔 `/orders/1001`과 `/orders/7`을 같은 경로로 봄, 상태 코드는 순서대로 비교), 화면 문구(양쪽에 접근성 트리가 있으면 그것으로, 없으면
  캡처한 HTML의 글자로; **화면 문구도 비교**를 끄면 제외).
- 행을 펼치면 두 스크린샷이 좌우로 놓이고, 다른 호출(`409 → 200`)과 다른 문구(`-` 원본, `+` 재현본)가 보입니다.
- **차이를 대화에 넣기**는 대조 결과를 그대로 입력창에 붙여 에이전트가 재현본을 고치게 합니다.

화면이 없는 계산(게임의 판정식, 정산 로직 등)은 **케이스 결과 파일** 두 개로 대조합니다. 에이전트에게 같은 입력을 원본과 재현본에
돌려 아래 형식으로 저장하게 하세요(`"cases"`가 첫 키이거나 `"format"` 바로 다음이어야 목록에서 알아봅니다).

```json
{ "cases": [ { "id": "pan-320", "input": { "x": 320 }, "output": 0 } ] }
```

이 파일을 열면 대조 화면이 나오고, 케이스는 `id` → `input` → 순서로 짝짓습니다. 숫자는 **숫자 허용 오차** 안이면 같은 값으로 보고, 다르면
첫 차이 위치(`$.pan`, `$[2]`)를 보여 줍니다. 터미널에서는 차이가 있으면 종료 코드 1로 끝나므로 에이전트가 0이 될 때까지 고치게 할 수 있습니다.

```sh
monofield rea compare --project <프로젝트ID> --original evidence/original.json --remake evidence/remake.json [--no-text] [--json]
monofield rea compare --project <프로젝트ID> --original cases/original.json --remake cases/remake.json --tolerance 0.001
```

일치는 **기록된 실행끼리 같았다**는 뜻이지 재현본이 모든 경우에 같다는 뜻은 아닙니다. 기록하지 않은 단계·입력은 비교되지 않습니다.

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

## 다른 사이트의 화면을 참고하기 (레퍼런스 보드)

남의 화면 구조·흐름·필드 구성만 참고하려면 대부분 REA가 필요 없습니다. 내장 브라우저에서 **레퍼런스로 담기**를 누르면 주소·캡처·구조 요약·메모가
프로젝트의 레퍼런스 보드에 쌓이고, **프로젝트에 넣기**로 "패턴만 가져오고 문구·이미지·브랜드는 쓰지 말 것"이라는 규칙과 함께 입력창에 부탁문이
만들어집니다. 버튼을 눌렀을 때의 흐름과 API까지 필요한 카드만 **REA로 흐름 기록**을 누르면, MonoField에 들어 있는 REA가 새 임시 브라우저로 적은 단계를
실행해 증거를 카드에 붙입니다(로그인 화면은 기록하지 않음). 적용한 뒤에는 **우리 화면과 비교**가 같은 단계를 우리 앱에서 기록해, 단계 성공 여부·페이지
이동·서버 요청 종류·화면 요소 종류를 레퍼런스와 비교하고 차이를 AI 부탁문으로 넣어 줍니다. CLI는 `monofield refs`(`record`, `compare` 포함). 자세한 사용법은 [레퍼런스 보드](reference-board.ko.md)를 보세요.

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
- **네이티브 바이너리 화면**: REA 스튜디오는 브라우저·SQLite·JavaScript 정적 분석·기능 추적만 화면으로 그립니다. 게임 등 실행 파일
  분석 결과(함수 목록, 디스어셈블)는 아직 "기타" 사실 목록으로만 보입니다.

근거: REA 저장소 README(`jhy0285/rea-yj` 커밋 `bb54082`)와 등록된 MCP 도구 목록,
MonoField의 [REA 실행 보고서](testing/rea-handover-2026-10-22.md),
[JEV·로컬 판단 문서](jev-decisions.md).
