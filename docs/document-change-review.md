# 근거 기반 명세서와 변경 검토

MonoField의 인터페이스 명세서 편집기에서 소스 변경을 확인하고 AI 갱신안을 검토할 수 있습니다. 원본 문서와 AI 제안은 별도 파일로 유지합니다.

1. 프로젝트의 인터페이스 명세서를 열고 편집 중인 내용을 저장합니다.
2. **Git 변경 분석**을 누릅니다. 기록된 수집 커밋 이후의 변경, 작업 중인 변경, 새 파일을 분석합니다. 수집 커밋이 없으면 현재 HEAD와 작업 파일을 비교합니다.
3. 영향을 받은 인터페이스와 코드 근거가 없는 항목 수를 확인합니다.
4. **AI 갱신 요청 작성**을 누르면 현재 채팅 입력란에 요청이 준비됩니다. 사용할 모델과 요청 내용을 확인하고 전송합니다.
5. AI가 원본 옆의 `*.proposed.json`에 변경분을 작성한 뒤 **AI 제안 검토**를 누릅니다. daemon이 원본에 변경분을 합쳐 형식을 검사하고, 화면에서 변경된 필드·설명·출처를 비교합니다. 기존 전체 문서 형태의 제안도 지원합니다.
6. **검토한 제안 적용**은 편집 가능한 초안을 불러옵니다. 수정 후 **저장**하고 XLSX를 출력합니다.

원본이 분석 이후 바뀌면 제안 적용을 중단합니다. 편집기 저장도 불러온 문서의 SHA-256을 확인하고 같은 파일의 daemon 저장을 직렬화합니다. 동시에 같은 버전을 저장하면 하나만 반영하고 나머지는 충돌로 처리합니다. daemon을 거치지 않는 외부 프로그램의 파일 쓰기는 별도 동기화가 필요합니다.

## 근거와 검토 상태

필드의 `evidence`와 `evidenceRefs`를 보존합니다. 근거는 코드, 요구사항, 브라우저, 데이터베이스, 수동 입력을 구분하며 출처와 함께 행·심볼·커밋·파일 해시·수집 시각을 기록할 수 있습니다. 근거 참조는 출처 표시입니다. 해당 내용이 독립적으로 검증됐다는 의미는 아닙니다.

`reviewStatus`는 `unreviewed`, `accepted`, `edited`를 구분합니다. 기존 문서는 그대로 읽을 수 있습니다. 근거가 있는 문서의 XLSX에는 **문서 근거** 시트가 추가되고 HTML 미리보기에도 같은 정보가 포함됩니다.

## CLI

UI와 같은 로컬 daemon API를 사용합니다.

```bash
monofield docs impact --project <project-id> --input docs/orders.interface-spec.json --json
```

결과에는 문서 해시, 비교 커밋, 변경 파일, 영향을 받은 항목, 코드 근거가 없는 항목, 제안 파일 경로, AI 요청이 포함됩니다. 필요하면 기존 로컬 에이전트 워크플로에 `updatePrompt`를 전달합니다.

AI 요청의 긴 파일·인터페이스 목록은 개수와 일부 항목만 보냅니다. CLI 보고서에는 전체 목록이 남아 있으므로 필요한 때 가져옵니다. 큰 원본 문서는 로컬 도구로 관련 인터페이스만 추출하고, 변경하지 않는 항목을 모델에 반복해서 읽히거나 쓰게 하지 않습니다.

변경분 제안 예시입니다. 해시는 분석 결과의 `contentSha256`이고, 인덱스와 ID는 실제 원본을 사용합니다.

```json
{
  "schemaVersion": 1,
  "kind": "interface-spec-proposal",
  "baseContentSha256": "<분석 결과의 64자리 SHA-256>",
  "changes": [
    { "op": "test", "path": "/endpoints/0/interfaceId", "value": "IF-001" },
    { "op": "replace", "path": "/endpoints/0/responseFields/0/dataType", "value": "String" },
    { "op": "add", "path": "/endpoints/0/responseFields/0/reviewStatus", "value": "unreviewed" }
  ]
}
```

JSON Pointer의 `add`, `remove`, `replace`, `test`를 지원합니다. 기존 값을 지울 때는 `remove`, 새 속성에는 `add`를 사용합니다. ID 검사 실패, 잘못된 경로·형식, 알 수 없는 속성, 원본 해시 불일치가 있으면 전체 제안을 거부합니다. 검증과 병합은 모델 호출 없이 수행하며 원본 파일을 쓰지 않습니다.

```bash
monofield docs proposal --project <project-id> \
  --input docs/orders.interface-spec.json \
  --proposal docs/orders.interface-spec.proposed.json \
  --expected-sha <contentSha256> --json
```

기본 결과는 작은 검증 요약입니다. 재구성한 전체 JSON이 필요한 외부 도구만 `--include-document`를 지정합니다. UI는 같은 API에서 전체 문서를 받아 비교하므로 모델에 검증 결과의 전체 문서를 다시 보낼 필요가 없습니다. [토큰 절약 기준](token-efficiency.md)도 참고하세요.

## 검증과 현재 범위

- Git 영향 분석은 인터페이스의 `sourceFile`과 코드 `evidenceRefs`를 직접 대조합니다. DTO 의존성의 전이 분석은 AI 검토에서 확인해야 합니다. 코드 근거가 없는 항목을 최신이라고 단정하지 않습니다.
- `source.codebasePath`는 프로젝트 안의 실제 디렉터리여야 합니다. 프로젝트 밖으로 나가는 경로와 심볼릭 링크는 분석하지 않습니다. 파일 접근은 기존 프로젝트 권한 경계를 따릅니다.
- 필수 자동 브라우저 캡처 실패나 브라우저 연결 부재는 실행 상태를 `failed`로 기록합니다. 성공 범위는 페이지 정보·DOM·스크린샷 수집이며, 업무 동작의 정상 여부를 자동으로 보증하지 않습니다.
- 긴 자동화 자료는 서로 다른 사실·필수조건·코드를 잘라내지 않습니다. 안전하게 줄일 반복 문장이 없으면 전체 자료를 유지하므로 설정된 크기로 반드시 줄어드는 것은 아닙니다.
- 공식 OpenAI의 GPT-5 및 지정된 추론 모델은 Responses API로 스트리밍하며 `store: false`를 사용합니다. 호환 제공자는 기존 Chat Completions 경로를 유지합니다. 출력 한도 초과·실패·완료 전 연결 중단을 성공으로 처리하지 않습니다. 프로젝트에 첨부한 PNG/JPEG/GIF/WebP 화면 이미지를 OpenAI 채팅의 이미지 입력으로 전달합니다. 실제 모델 호출에는 기존 사용자 인증이 필요합니다.
- [DB 스키마 감시와 화면·API 영향 분석](database-schema-watch.md)은 저장된 읽기 승인과 문서 연결 근거를 따라 변경을 확인합니다. 연결 없는 항목의 영향은 미확인으로 남깁니다. 업무별 동작 단언과 언어별 import/ORM 의존 관계 자동 추론은 후속 고도화 범위입니다.
