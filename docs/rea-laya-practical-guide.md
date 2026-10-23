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
(호환성 깨짐 / 확인 필요 / 추가 변경)과 함께 검토한 뒤 적용합니다.

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
python -m pip install 'laya[serve]==0.3.28' 'transformers<5'
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
