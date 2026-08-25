# MonoField 문서 배심원단 사용 가이드

문서 배심원단은 에이전트가 만든 결과물을 한 번 더 검토하고, 기준 점수에 도달할 때까지 수정 라운드를 진행하는 선택 기능입니다. 내부 구현 이름은 `Critique Theater`이지만, MonoField 화면에서는 **문서 배심원단**으로 표시합니다.

## 먼저 답: 켜면 그냥 동작하나요?

아니요. 설정의 토글은 **배심원단 사용 의사와 프로젝트 설정을 켜는 첫 단계**입니다. 실제 실행은 아래 조건을 모두 만족하는 요청에서만 시작합니다.

1. 프로젝트를 연 상태에서 문서 배심원단을 켠다.
2. 프로젝트에 문서 스타일(현재 구현에서는 디자인 시스템 원본)이 연결되어 있다.
3. 요청에 적용할 skill이 있다.
4. 선택한 에이전트가 plain-text stream을 지원한다.
5. 결과가 이미지, 비디오, 오디오 전용 작업이 아니다.

조건 중 하나라도 빠지면 일반 에이전트 실행으로 진행하며, 배심원단 패널은 나타나지 않습니다. 이는 모델에게 배심원 프로토콜을 지시했는데 서버가 이를 해석하지 못하는 상황을 막기 위한 안전 장치입니다.

## 일반 사용자 사용 방법

### 1. 홈이 아니라 프로젝트를 먼저 엽니다

홈 화면에서 토글을 켜면 현재 브라우저 화면의 표시 상태만 바뀔 수 있습니다. 실제 에이전트 실행에 적용하려면 대상 프로젝트를 연 뒤 설정해야 합니다.

### 2. 문서 스타일과 skill을 확인합니다

프로젝트에 문서 스타일을 연결하고, 해당 요청에 적용할 skill이 있는지 확인합니다. 현재 배심원단은 스타일 원본과 skill 정보를 평가 프롬프트에 함께 사용합니다.

현재 구현상 문서 스타일이 `없음`이면 배심원단은 실행되지 않습니다. interface-spec의 내장 skill이 적용되는 경우에도 문서 스타일이 없거나 지원되지 않는 에이전트를 쓰면 일반 실행으로 넘어갑니다.

### 3. 설정에서 문서 배심원단을 켭니다

프로젝트 화면에서 **설정 → 문서 배심원단 → 에이전트 실행 중 문서 배심원단 표시**를 켭니다.

이 설정은 다음 에이전트 실행부터 프로젝트 metadata에 저장되어 서버 측 실행 조건에 반영됩니다. 실행 중인 요청에는 소급 적용되지 않으므로, 토글을 바꾼 뒤 새 요청을 보내야 합니다.

### 4. 지원되는 에이전트를 선택합니다

v1 배심원단은 현재 plain-text stream을 사용하는 adapter만 처리합니다. 현재 코드 기준으로 Aider, Antigravity, DeepSeek, Grok Build, Qwen adapter가 이 형식으로 등록되어 있습니다.

Codex, Claude Code, Cursor Agent처럼 JSON/구조화 stream을 사용하는 adapter는 현재 배심원단을 통과하지 않고 일반 실행으로 처리됩니다. 모델 품질의 문제가 아니라 v1 parser가 구조화 stream을 아직 해석하지 않기 때문입니다.

### 5. 문서 생성 요청을 보냅니다

예를 들어 스타일과 skill이 연결된 프로젝트에서 다음과 같이 요청합니다.

> 고객 주문 관리용 HTML 운영 가이드를 만들고, 접근성·문구·스타일 일관성까지 검토해줘.

배심원단이 시작되면 실행 중에 역할별 진행 상태, 점수, 수정 필요 항목이 표시됩니다. 종료되면 결과는 접힌 상태의 배지로 남습니다.

## 배심원단이 하는 일

현재는 한 에이전트 세션 안에서 다음 다섯 역할이 순서대로 검토합니다.

| 역할            | 현재 평가 관점                  |
| ------------- | ------------------------- |
| Designer      | 결과물 초안과 수정 방향             |
| Critic        | 구조, 가독성, 요청 충족도           |
| Brand         | 연결된 스타일·토큰 준수             |
| Accessibility | 대비, 구조, alt text, focus 등 |
| Copy          | 문구의 명확성, 톤, 장황함           |

기본 동작은 최대 3라운드입니다. Critic 40%, Brand 20%, Accessibility 20%, Copy 20%의 가중 평균이 8.0/10 이상이고 필수 수정 항목이 없어야 통과합니다. Designer는 초안 작성 역할이라 점수 가중치는 0입니다.

3라운드 안에 기준에 못 미치면 기본 정책은 가장 높은 점수의 결과를 남기는 `ship_best`입니다. 따라서 결과 배지의 상태가 `Shipped`인지, `Below threshold`인지 반드시 확인해야 합니다.

## 결과 읽는 법

| 상태 | 의미 | 권장 행동 |
| --- | --- | --- |
| Shipped | 기준 점수를 충족한 결과 | 결과를 검토하고 export 또는 후속 편집 |
| Below threshold | 라운드를 모두 썼지만 기준에 미달, 최선 결과를 반환 | 요청을 구체화하거나 직접 수정 후 다시 실행 |
| Timed out | 제한 시간 안에 완료하지 못함 | 요청 범위를 줄이고 다시 실행 |
| Interrupted | 사용자가 중단함 | 새 요청으로 다시 실행 |
| Degraded | 모델 출력이 배심원 프로토콜을 따르지 못함 | 지원 adapter인지 확인하고 일반 실행 또는 재시도 |

각 실행의 transcript와 최종 artifact는 프로젝트에 연결되며, 종료 배지에서 Replay로 검토 과정을 다시 볼 수 있습니다.

## interface-spec에서의 현실적인 사용 범위

현재 문서 배심원단은 HTML·프로토타입처럼 스타일과 문구 품질이 중요한 결과물에 더 맞춰져 있습니다. interface-spec의 XLSX와 JSON 명세에 대해 다음을 전문적으로 검사하지는 않습니다.

- HTTP method, path, 인터페이스 ID
- 인증 방식과 오류 코드
- request/response 필드 타입, 필수 여부, 최소·최대 길이
- 용어사전과 필드 정의의 충돌
- Excel template의 열·시트 구조
- JSON과 XLSX export 사이의 일관성

따라서 현재 interface-spec 작업에서는 배심원단을 품질 보증의 필수 단계로 사용하지 마세요. 인터페이스 명세 전용 배심원단이 추가되기 전까지는 기존의 deterministic validation, template preview, XLSX export 검증을 기준으로 사용해야 합니다.

향후에는 문서 종류별로 역할과 인원수를 설정할 수 있는 구조가 필요합니다. 예를 들어 interface-spec에는 API 계약, 보안, 데이터 모델, 용어사전, Excel 품질 검토자를 두는 방식이 적합합니다.

## 운영자가 전체 사용자에게 켜는 방법

개별 프로젝트 토글 대신 사내 배포 환경에서 다음 환경변수를 주입하면, 적격한 실행에 배심원단을 기본 활성화할 수 있습니다.

```text
OD_CRITIQUE_ENABLED=1
OD_CRITIQUE_MAX_ROUNDS=3
OD_CRITIQUE_SCORE_THRESHOLD=8
OD_CRITIQUE_PER_ROUND_TIMEOUT_MS=90000
OD_CRITIQUE_TOTAL_TIMEOUT_MS=240000
OD_CRITIQUE_FALLBACK_POLICY=ship_best
```

환경변수 변경은 Daemon과 Desktop을 모두 재시작한 뒤 적용됩니다. 이 설정도 지원되지 않는 adapter, 문서 스타일이 없는 프로젝트, skill이 없는 요청을 강제로 배심원단에 넣지는 않습니다.

skill 작성자는 `SKILL.md` frontmatter에 아래 정책을 둘 수 있습니다.

```yaml
od:
  critique:
    policy: required # required | opt-in | opt-out
```

우선순위는 `opt-out` skill 차단 → `required` skill 강제 → 프로젝트 토글 → 환경변수 → rollout 기본값 순서입니다.

## 알려진 제한과 운영 주의사항

- 기본값은 꺼져 있습니다.
- v1의 패널 인원과 역할은 고정 5명입니다.
- 점수 기준과 역할별 가중치는 UI에서 변경할 수 없습니다.
- 실제로는 한 모델 세션이 역할을 나누어 답하는 구조이지, 독립적인 다섯 모델이 토론하는 구조는 아닙니다.
- Windows에서 artifact symlink를 거부해야 하는 보안 회귀 테스트 1건이 현재 실패합니다. Windows 배포 전에는 이 파일 경계 검사를 보완해야 합니다.
- 실제 운영 모델과 각 adapter 조합은 사내 대표 문서로 conformance 검증 후 rollout해야 합니다.

## 문제 해결

**토글을 켰는데 패널이 보이지 않습니다.**

프로젝트 안에서 토글을 켰는지, 문서 스타일과 skill이 연결됐는지, adapter가 plain-text stream인지 순서대로 확인합니다. Codex, Claude Code, Cursor Agent의 현재 adapter는 배심원단 v1 대상이 아닙니다.

**`Degraded` 상태가 나옵니다.**

모델이 정해진 배심원 태그 형식을 지키지 못했거나 출력이 너무 큰 경우입니다. 일반 실행으로 다시 시도하거나 지원되는 adapter로 바꿉니다.

**`Below threshold`인데 결과가 있습니다.**

실패한 결과가 아니라, 제한된 라운드 안에서 가장 높은 점수의 결과입니다. 최종 사용 전에는 반드시 수정 필요 항목을 확인합니다.

## 관련 구현

- `apps/daemon/src/critique/` — 실행, 점수, 저장, 중단 처리
- `apps/daemon/src/prompts/panel.ts` — 배심원 프롬프트와 역할 정의
- `apps/web/src/components/Theater/` — 실시간 패널과 replay UI
- `apps/web/src/components/SettingsDialog.tsx` — 프로젝트별 토글
