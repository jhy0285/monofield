# REA + Laya로 기존 시스템 인수인계하기

MonoField `0.11.7-preview.2`에는 REA MCP 프리셋, `monofield rea` 설정 CLI, `legacy-system-handover` 스킬과 Laya 로컬 판단 연동이 포함됩니다. REA 엔진은 첫 사용 시 고정 버전으로 내려받고, Laya 모델·서버는 별도 설치합니다. 기존 Java 도구·코드 온톨로지·변경 검증·문서 검토 기능도 같은 소스에 포함됩니다.

상황별 도구 선택과 실제 지시 예시는 [REA·Laya 실전 사용 가이드](rea-laya-practical-guide.md)를 참고하세요.

## 역할

| 도구 | SI 인수인계에서 하는 일 |
|---|---|
| REA | 선택한 배포 JavaScript·SQLite 스냅샷·브라우저 동작을 조사하고 Evidence ID·해시·관찰 범위를 남깁니다. |
| MonoField + 로컬 agent | 근거를 읽고 미확인 사항을 구분해 인터페이스·화면 명세 JSON을 작성하고 검토·Excel/PPTX 출력으로 이어갑니다. |
| Laya (선택) | 제한된 질문에 대한 분류, 검증 후보 추천, 근거 일치 여부 검토를 보조합니다. 실행 증거나 승인 권한을 만들지는 않습니다. |

## REA 연결

REA는 MonoField에 들어 있습니다(`rea-agents` 6.7.0). MonoField가 자기 런타임으로 실행하므로 Node.js 설치나 `npx` 다운로드가 필요 없습니다.

1. 설정할 것이 없습니다. **설정 → 외부 MCP → REA 설치·연결 점검**의 **대화에서 AI가 REA 쓰기**가 기본으로 켜져 있습니다. 끄면 대화의 AI에게 REA 도구를 주지 않습니다.
2. 지원되는 로컬 CLI agent로 새 대화를 시작합니다. 기존 대화에 소급 적용된다고 가정하지 마세요.
3. `legacy-system-handover` 스킬을 선택하고 조사할 앱 경로·DB 스냅샷·실행 URL과 수행할 조작을 지정합니다. 스킬은 **Settings → Skills**에서도 확인할 수 있습니다.

같은 설정은 CLI로도 바꿉니다(웹과 같은 `/api/app-config`를 씁니다).

```sh
monofield rea status --json
monofield rea disable --json
monofield rea enable --json
monofield rea configure --ghidra-dir <folder> --java-home <folder> --json   # 실행 파일 분석용(선택)
```

다른 daemon을 선택하려면 `--daemon-url URL`을 추가합니다. `status`는 설정 상태이며 실제 연결을 검증한 상태가 아닙니다(`availability: not-probed`). `configure`는 Ghidra·Java 폴더가 필요할 때만 씁니다. 이때만 `/api/mcp/servers`에 `rea` 항목이 저장되며, 다른 MCP 서버·자격증명은 보존하고 사용자 지정 서버가 `rea` ID를 쓰고 있으면 덮어쓰지 않습니다.

전달 범위:

- **Claude Code**: 관리 프로젝트에서는 `.mcp.json`, 가져온 폴더 프로젝트에서는 `--mcp-config` 인자로 받습니다.
- **Codex CLI**: `-c mcp_servers.rea.*` 설정 덮어쓰기로 실행할 때마다 받습니다. 사용자 Codex 설정 파일은 바꾸지 않습니다.
- **OpenCode**, 지원 ACP adapter: 기존 외부 MCP 전달 경로로 받습니다.

BYOK 채팅 모델만 선택한 경우 로컬 파일·브라우저·외부 MCP 실행 도구가 자동 제공되지 않습니다. 실제 도구가 광고되는 지원 로컬 CLI 경로를 사용하세요.

SQLite 검사는 Node 24.15 이상이 필요하며 내장 런타임이 이를 만족합니다. 브라우저 캡처에는 설치된 Chromium 계열 실행 파일이 필요합니다. 네이티브 바이너리 분석 엔진은 별도입니다. `monofield rea doctor --json`으로 확인하세요.

사용자님의 [rea-yj](https://github.com/jhy0285/rea-yj) 소스 체크아웃을 직접 사용하려면 해당 저장소를 빌드하고 **설정 → 외부 MCP**에서 사용자 지정 서버로 명령 `node`, 인자 `/absolute/path/to/rea-yj/scripts/rea.mjs`, `--mcp`를 `rea` ID로 저장합니다. 사용자 MCP 설정 이외의 전역 agent 설정은 자동 변경하지 않습니다.

## 브라우저 기록과 명세서 대조

REA `capture_browser_scenario` 기록(`rea.browser-scenario-capture`)을 프로젝트 폴더에 두면, 인터페이스 명세서 편집기의 **브라우저 증거 대조 (REA)** 패널이나 CLI로 명세서가 실제 요청·응답과 맞는지 대조합니다. 명세서에 없는 엔드포인트·필드, 이름·타입 불일치, 문서화되지 않은 오류 코드를 찾고, 선택한 항목을 **편집기에 반영해 사용자가 저장**하게 합니다(CLI는 `--write`를 줄 때만 파일을 씁니다). 기록 본문은 저장된 SHA-256과 맞을 때만 읽습니다.

```sh
monofield rea evidence --project <id> --json
monofield rea cross-check --project <id> --input docs/orders.interface-spec.json --evidence evidence/capture.json --json
monofield rea apply --project <id> --input docs/orders.interface-spec.json --evidence evidence/capture.json --write
```

관찰되지 않은 필드는 "없음"이 아니라 "관찰되지 않음"입니다. 반영된 새 행은 한글명이 비어 있으므로 저장 후 **판단 검토**를 실행하세요. 응답 예시는 `--include-examples`를 줄 때만 복사합니다(실제 데이터일 수 있음). 자세한 사용법은 [실전 가이드](rea-laya-practical-guide.md#작성한-명세서를-브라우저-기록과-대조하기)를 보세요.

## Laya 연결과 근거 검토

[로컬 모델 설치 가이드](jev-decisions.md#local-compatible-models)에 따라 Laya 서버를 loopback에서 실행합니다. MonoField의 **Integrations → JEV / local decisions**에서 local backend를 선택하거나:

```sh
monofield jev configure --backend local --local-url http://127.0.0.1:8000 --model multilingual --json
monofield jev models --json
```

예를 들어 REA에서 확보한 정산 응답을 다음 검토 입력에 담을 수 있습니다. `review.json`:

```json
{
  "task": "implementation",
  "objective": "미결제 주문은 정산되지 않아야 한다.",
  "evidence": "REA 브라우저 근거의 pending-rejected-result: 주문 1002, PENDING, HTTP 409, ORDER_NOT_PAID. 실제 Evidence ID와 저장한 원본 파일도 함께 검토한다."
}
```

```sh
monofield jev review --request-file review.json --json
```

인터페이스 명세서 편집기의 **판단 검토**는 같은 연결로 한글 필드명과 업무명을 한 항목씩 확인합니다. 자세한 사용법과 실제 측정치는 [판단 검토 문서](judgment-checks.md)를 보세요.

분류 결과는 advisory입니다. 전체 시스템이 맞다는 판정·배포 승인으로 사용하지 않습니다. 로컬 서버가 없으면 REA 기반 조사·문서 출력은 계속 사용할 수 있습니다. Laya 가중치는 MonoField 설치본에 포함하지 않으며 서버를 자동 시작하지 않습니다.

## 실제로 검증한 범위

[합성 주문·정산 실행 보고서](testing/rea-handover-2026-10-22.md)에서 REA CLI → agent 수집 → MonoField 문서 CLI 출력과 재현 결과를 확인할 수 있습니다. 정상 정산·중복·미결제·취소 동작, DB 스키마 및 저장 행을 대조했습니다. 고객 시스템이나 Java/Spring 운영 앱 전체를 검증한 결과는 아닙니다. REA가 완성 명세를 직접 자동 생성하는 기능도 아닙니다.

이 릴리스의 MCP 프리셋은 agent에 REA 도구를 제공하는 연결 기능입니다. 조사는 사용자가 지정한 대상·시나리오에서 수행하며, 전체 시스템을 자동 탐색하는 전용 대시보드는 제공하지 않습니다. 모델 판단·정적 분석·실행 관찰의 근거와 미확인 사항을 구분해 검토하세요.
