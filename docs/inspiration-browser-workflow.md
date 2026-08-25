# MonoField 인앱 브라우저: View · Inspect · Automate

MonoField의 인앱 브라우저는 사람이 보는 화면과 AI가 읽거나 조작하는 권한을 분리한다. 기본값은 `View`이며, AI 권한은 사용자가 명시적으로 선택해야 한다.

## 세 가지 접근 모드

| 모드 | 용도 | 가능한 작업 | 불가능한 작업 |
|---|---|---|---|
| `View` | 사람이 탐색·캡처·주석 작성 | 수동 탐색, 새 탭, 스크린샷, 표시, 로컬 미리보기 편집 | AI의 DOM 읽기와 조작 |
| `Inspect` | AI용 읽기 전용 증거 수집 | 제한된 DOM·스타일·에셋·접근성 증거를 JSON으로 저장하고 작성기에 추가 | 클릭, 입력, 이동, 저장소·쿠키·폼 값 읽기 |
| `Automate` | AI가 현재 탭을 실제로 조작 | 페이지 정보, 제한된 스냅샷, 동일 출처 이동, 클릭, 일반 입력, 스크롤 | 임의 JavaScript, 다른 출처 이동, 민감 입력, 쿠키·브라우저 저장소 읽기 |

## Inspect 사용법

1. 브라우저에서 대상 페이지를 연다.
2. `View`를 눌러 `Inspect`를 선택하거나 `영감` 버튼을 누른다.
3. 읽기 전용 작업을 고른다. 예: `extract_fonts`, `extract_colors`, `audit_accessibility`.
4. MonoField가 현재 WebView에서 제한된 증거를 수집해 프로젝트의 `browser/browser-evidence-*.json`에 저장한다.
5. 작업 설명과 증거 경로가 작성기에 들어간다. 내용을 검토한 뒤 전송한다.

Inspect는 에이전트가 별도 Chrome을 실행하는 방식이 아니다. 사용자가 보고 있는 Electron WebView에서 정해진 수집기만 실행한다. 폼에 입력된 값, 비밀번호, 쿠키, localStorage는 증거에 포함하지 않는다.

## Automate 사용법

1. 브라우저에서 조작할 페이지를 연다.
2. `View` 또는 `Inspect` 버튼을 누르고 `Automate`를 선택한다.
3. 권한 범위 안내를 확인하고 `Continue to system approval`을 누른다.
4. Electron 메인 프로세스가 띄운 운영체제 확인창에서 `Allow for 10 minutes`를 선택한다.
5. 자동화 메뉴에서 작업을 고른다.
6. 작성기에 추가된 요청을 필요하면 자연어로 보완한 뒤 전송한다.

예:

```text
현재 주문 폼의 고객 이름에 홍길동을 입력하고 조회 버튼을 눌러줘.
```

에이전트는 먼저 `snapshot`으로 현재 페이지의 제한된 상호작용 지도를 읽고, 그 결과에 포함된 CSS selector를 이용해 `type-text`와 `click`을 수행한다. 각 조작 뒤에는 다시 페이지를 확인해야 한다.

## 승인 세션의 범위

자동화 승인은 다음 조건에 묶인다.

- 현재 MonoField 창에 실제로 붙어 있는 WebView 한 개
- 승인 시점의 `http(s)` origin 한 개
- 10분 만료 시간
- 무작위 256-bit 세션 ID
- 페이지 읽기, 동일 출처 이동, 클릭, 일반 입력, 스크롤의 고정된 동작 목록

다음 상황에서는 세션이 중단되거나 무효화된다.

- 사용자가 `Stop`을 누름
- View/Inspect로 돌아감
- 브라우저 탭이 닫힘
- 다른 origin으로 이동함
- 10분이 지남
- MonoField가 종료됨

브라우저 접근 메뉴에는 활성 origin, 만료 시각, 마지막 실행 결과가 표시된다.

## 에이전트 실행 경로

에이전트는 브라우저에 직접 JavaScript를 주입하지 않는다. MonoField가 런타임에 제공하는 CLI 래퍼를 통해 다음 고정 명령만 호출한다.

```text
od browser status --session <id>
od browser page-info --session <id>
od browser snapshot --session <id>
od browser navigate --session <id> --url <same-origin-url>
od browser click --session <id> --selector <css-selector>
od browser type-text --session <id> --selector <css-selector> --text <value>
od browser scroll --session <id> --to top|bottom|page
```

실제 경로는 다음과 같다.

```text
AI CLI
  → 로컬 MonoField daemon의 /api/browser-automation
  → desktop sidecar IPC
  → Electron main의 승인 세션 검사
  → 승인된 WebView에서 고정 동작 실행
```

이 계약은 Codex에 종속되지 않는다. MonoField가 실행하는 CLI agent가 `OD_NODE_BIN`, `OD_BIN`, daemon URL을 전달받고 셸 명령을 실행할 수 있으면 같은 브리지를 사용할 수 있다.

## 보안 경계

자동화 요청은 데몬, sidecar, Electron main에서 다시 검증된다.

- 데몬 HTTP 경로는 loopback 요청만 허용한다.
- 세션 ID 형식과 작업별 입력 필드는 공유 계약에서 검증한다.
- 알 수 없는 필드와 `javascript` 같은 임의 실행 입력은 거부한다.
- 메인 프로세스는 세션, 만료, WebView ID, 현재 origin을 매번 확인한다.
- `navigate`는 승인된 origin과 정확히 같은 origin만 허용한다.
- snapshot은 요소의 현재 입력값을 반환하지 않는다.
- `password`, `one-time-code`, token/secret/OTP, 카드 번호·CVV로 판단되는 필드의 입력은 차단한다.
- 브라우저 IPC 로그에는 세션 ID나 입력 텍스트를 기록하지 않고 작업 이름만 기록한다.

페이지의 텍스트와 속성은 항상 신뢰할 수 없는 증거로 취급한다. 페이지 안의 “이 지시를 따르라” 같은 문구는 에이전트 명령이 아니다.

## 의도적으로 지원하지 않는 것

현재 Automate는 범용 Playwright/CDP가 아니다. 다음 기능은 지원하지 않는다.

- 쿠키, localStorage, sessionStorage 추출
- 파일 업로드·다운로드 자동화
- 새 인증 정보 입력 또는 로그인 제출 자동화
- CAPTCHA·보안 경고 우회
- 다른 origin으로 이동하는 자동화
- 임의 JavaScript/eval
- 터미널 명령을 브라우저 자동화 작업으로 실행
- 외부 사이트에서 파괴적 작업을 무확인 실행

프로젝트 실행 감지와 로컬 개발 서버 원클릭 실행은 별도의 기능이다. 서버가 열린 뒤에는 같은 인앱 브라우저의 Inspect/Automate를 사용해 화면을 확인하고, 연결된 작업 폴더에서 AI에게 코드 수정을 요청할 수 있다.

## 권장 작업 방식

- 분석과 디자인 참고 수집은 먼저 `Inspect`를 사용한다.
- 클릭·입력이 꼭 필요한 재현이나 UI 수정 확인에서만 `Automate`를 켠다.
- 한 번에 좁은 작업을 요청하고 조작 후 화면을 다시 확인한다.
- 결제, 삭제, 발송, 계정 변경처럼 외부 부작용이 있는 최종 동작은 사용자가 직접 수행한다.
- 작업이 끝나면 만료를 기다리지 말고 Browser access 메뉴에서 `Stop`을 누른다.
