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

1. **Settings → MCP → Add MCP server**에서 **REA (Reverse Engineer Anything)**를 선택하고 저장·활성화합니다.
2. 지원되는 로컬 CLI agent로 새 대화를 시작합니다. 기존 대화에 서버가 소급 연결된다고 가정하지 마세요.
3. `legacy-system-handover` 스킬을 선택하고 조사할 앱 경로·DB 스냅샷·실행 URL과 수행할 조작을 지정합니다. 스킬은 **Settings → Skills**에서도 확인할 수 있습니다.

같은 설정은 실행 중인 MonoField daemon에 CLI로 적용할 수 있습니다.

```sh
monofield rea configure --json
monofield rea status --json
monofield rea disable --json
```

다른 daemon을 선택하려면 `--daemon-url URL`을 추가합니다. `status`는 설정 상태이며 실제 연결을 검증한 상태가 아닙니다(`availability: not-probed`). CLI는 다른 MCP 서버·자격증명을 보존하고, 사용자 지정 서버가 `rea` ID를 사용 중이면 덮어쓰지 않습니다. 웹과 CLI 모두 기존 `/api/mcp/servers`를 사용합니다.

프리셋 명령은 다음과 같습니다.

```sh
npx -y rea-agents@6.7.0 --mcp
```

REA 6.7.0은 Node `^22.19.0 || ^24.11.0 || >=26.0.0`을 요구합니다. 이 흐름의 SQLite 검사는 **Node 24.15 이상**을 사용하세요. Node와 npm을 PATH에서 실행할 수 있어야 합니다. 첫 `npx` 실행은 인터넷에서 패키지를 설치합니다. 브라우저 캡처에는 설치된 Chromium 계열 실행 파일이 필요합니다. 네이티브 바이너리 분석 엔진은 별도입니다.

사용자님의 [rea-yj](https://github.com/jhy0285/rea-yj) 소스 체크아웃을 직접 사용하려면 해당 저장소를 빌드하고 프리셋의 명령을 `node`, 인자를 `/absolute/path/to/rea-yj/scripts/rea.mjs`, `--mcp`로 바꿔 저장할 수 있습니다. 사용자 MCP 설정 이외의 전역 agent 설정은 자동 변경하지 않습니다.

BYOK 채팅 모델만 선택한 경우 로컬 파일·브라우저·외부 MCP 실행 도구가 자동 제공되지 않습니다. 실제 도구가 광고되는 지원 로컬 CLI 경로를 사용하세요. CLI adapter별 MCP 주입 범위는 같지 않습니다.

현재 앱이 외부 MCP 설정을 전달하는 경로는 Claude Code, OpenCode 및 지원 ACP adapter입니다. **Codex CLI에는 이 설정이 자동 전달되지 않습니다.** Codex를 사용한다면 사용자 Codex 환경에서 아래 명령으로 등록하고 새 대화를 시작하세요. 앱의 MCP 설정 화면에서도 선택한 agent의 전달 지원 여부를 표시합니다.

```sh
codex mcp add rea -- npx -y rea-agents@6.7.0 --mcp
```

이 명령은 사용자 Codex 설정에 서버를 추가하므로 직접 선택해 실행합니다. MonoField는 이를 자동 실행하지 않습니다.

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

분류 결과는 advisory입니다. 전체 시스템이 맞다는 판정·배포 승인으로 사용하지 않습니다. 로컬 서버가 없으면 REA 기반 조사·문서 출력은 계속 사용할 수 있습니다. Laya 가중치는 MonoField 설치본에 포함하지 않으며 서버를 자동 시작하지 않습니다.

## 실제로 검증한 범위

[합성 주문·정산 실행 보고서](testing/rea-handover-2026-10-22.md)에서 REA CLI → agent 수집 → MonoField 문서 CLI 출력과 재현 결과를 확인할 수 있습니다. 정상 정산·중복·미결제·취소 동작, DB 스키마 및 저장 행을 대조했습니다. 고객 시스템이나 Java/Spring 운영 앱 전체를 검증한 결과는 아닙니다. REA가 완성 명세를 직접 자동 생성하는 기능도 아닙니다.

이 릴리스의 MCP 프리셋은 agent에 REA 도구를 제공하는 연결 기능입니다. 조사는 사용자가 지정한 대상·시나리오에서 수행하며, 전체 시스템을 자동 탐색하는 전용 대시보드는 제공하지 않습니다. 모델 판단·정적 분석·실행 관찰의 근거와 미확인 사항을 구분해 검토하세요.
