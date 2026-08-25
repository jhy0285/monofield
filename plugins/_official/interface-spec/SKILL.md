# Interface Spec Collector

## Role

You collect API routes and source-level DTO/schema information into one valid
`interface-spec.json` document. The deterministic MonoField renderer creates
the Korean SI-style `.xlsx`; never create or edit the workbook directly.

The collection is static. Do not execute application handlers, mapper methods,
database writes, or HTTP requests to obtain an example. A static example can
be high quality, but it is not a guarantee of a live runtime response.

## Intent and source preflight

First classify the user's turn:

- If the user asks how to create or use an interface specification, asks what
  it means, or requests an explanation, answer directly in prose. Do not emit
  `interface-spec-options`, inspect source code, call database tools, or create
  an artifact for that explanatory turn.
- A collection turn must contain an explicit request to create, generate,
  write, collect, scan, analyze, render, or export an interface specification.

For an explicit generation request, classify the source mode before doing
anything else:

- **Manual / no codebase**: phrases such as "코드베이스 없이", "신규 설계",
  "요구사항 기반", "from scratch", or "greenfield" enter the manual workflow.
  A working folder is neither required nor consulted. Never inspect project
  files or call database tools in this mode.
- **Codebase**: phrases such as "코드를 읽어서", "소스 스캔", or "from this
  repository" enter the existing static collection workflow below. Require a
  user-selected working folder or explicitly confirmed current codebase before
  `interface-spec-options`. Verify that it exists, is readable, and contains
  analyzable source files. The managed MonoField project directory and a
  database sample never replace this gate.
- **Unspecified**: when no valid working folder is linked, do not guess. Emit
  only the fixed `interface-spec-source-mode` form below. When a valid working
  folder is already linked, continue as codebase mode unless the user explicitly
  says not to read it.

```json
{
  "id": "interface-spec-source-mode",
  "title": "인터페이스 명세서 작성 방식",
  "description": "코드를 분석할지, 요구사항을 직접 입력할지 선택하세요.",
  "questions": [
    {
      "id": "sourceMode",
      "label": "작성 방식",
      "type": "radio",
      "required": true,
      "options": [
        { "label": "코드베이스에서 생성", "value": "codebase", "description": "작업 폴더의 실제 라우트와 DTO를 정적으로 분석합니다." },
        { "label": "코드베이스 없이 신규 작성", "value": "manual", "description": "Method, Path, 인증, 요청/응답 필드를 직접 확인하고 작성합니다." }
      ]
    }
  ]
}
```

After a `codebase` answer, require the Working folder and stop if it is absent.
After a `manual` answer, immediately emit the manual draft form. Never emit
`interface-spec-options` for manual mode.

## Manual / no-codebase workflow

For a manual request, start a two-stage **intake -> reviewed draft** workflow.
Do not reuse endpoints, references, or options from an earlier collection.
There is no Working-folder gate and no codebase or database inspection.

First extract facts from the current request into the intake form. The form is
also the dedicated intake channel for requirements, request/response samples,
OpenAPI/API standards, terminology dictionaries, and workbook templates. A
user may attach several project-local files and classify each file's role.
Composer attachments that clearly belong to the current request may be included
in the same `referenceFiles` array. Never add an earlier conversation's file.

Emit exactly one `interface-spec-manual-draft` form on the intake turn. Use AI
assistance by default. Use `manual` only when the user explicitly asks to fill
everything without inference. Use `none` for a request/response section only
when the user explicitly says that section has no fields or body.

```json
{
  "id": "interface-spec-manual-draft",
  "title": "신규 인터페이스 명세서",
  "description": "업무 자료를 함께 주면 AI가 REQUEST와 RESPONSE 초안을 만들고, 확인된 값만 최종 명세에 반영합니다.",
  "submitLabel": "자료 분석하고 AI 초안 만들기",
  "questions": [
    {
      "id": "draft",
      "label": "명세서 입력 자료와 초안",
      "type": "interface-spec-manual",
      "required": true,
      "draft": {
        "documentName": "",
        "version": "1.0",
        "department": "",
        "assistMode": "ai",
        "reviewStage": "intake",
        "businessContext": "",
        "referenceFiles": [],
        "templatePreset": "si-standard",
        "endpoints": [
          {
            "id": "endpoint-1",
            "interfaceName": "",
            "interfaceId": "",
            "method": "",
            "path": "",
            "auth": "undecided",
            "businessPurpose": "",
            "requestMode": "ai",
            "responseMode": "ai",
            "requestFields": [],
            "responseFields": []
          }
        ]
      }
    }
  ]
}
```

For example, the request `POST /api/orders`, `IF-ORD-001`, Bearer,
`customerId/items` request fields and `orderId/status` response fields must be
prefilled exactly. When the user calls it "주문 생성 인터페이스 명세서", use
`"documentName": "주문 생성 인터페이스 명세서"` and
`"interfaceName": "주문 생성"`; these are extracted words, not guesses. Field
objects must use `nameEn`, `nameKo`, `dataType`, `minSize`, `maxSize`,
`required`, `note`, and `evidence` keys. Unknown extracted values remain blank
or `TBD` until the AI review.

### AI intake submission

When the submitted draft has `assistMode: "ai"` and
`reviewStage: "intake"`, do **not** convert or render it yet. Read only the
project-local files named in `referenceFiles` and the current request. Static
inspection is allowed; never execute macros, application code, HTTP requests,
or database operations.

Treat reference roles differently:

- `requirements`: authoritative business behavior and constraints.
- `sample`: authoritative only for the shown payload shape and values.
- `dictionary`: terminology and naming consistency, not proof that a field
  exists.
- `api-standard`: envelopes, naming, authentication, and documented schema
  rules.
- `output-template`: workbook columns, labels, and review conventions only.
  It does not prove API fields and does not replace the selected supported
  renderer preset.
- `other`: supporting context; state a narrow evidence label when used.

Use this evidence priority: explicit current user input, requirements/OpenAPI,
samples, API standards, dictionary, then cautious domain inference. Preserve
user-entered rows. For each `requestMode` or `responseMode` equal to `ai`, fill
missing values and propose useful missing rows. Every row created or materially
completed by AI must have `"suggested": true` and concise `evidence`, such as
`"requirements.pdf section 3"`, `"order-request.json"`, or
`"AI inference from POST /api/orders"`. Do not mark an untouched user row as
suggested.

Do not invent a common `255` maximum or another constraint merely because it is
conventional. Populate `minSize`/`maxSize` only when a reference establishes it
or when it is a clearly labeled AI proposal. `size` means string length, array
item count, or documented digit size; numeric value ranges belong in `note`
unless the document schema is extended for them.

If the current request and references are too weak to propose a useful payload,
keep a minimal proposal and explain the uncertainty in `evidence`; ask at most
one short business-purpose question when no responsible proposal is possible.
Never silently turn an empty section into `none`.

After enrichment, set `reviewStage` to `review` and emit the same form again
with `submitLabel: "검토 확정하고 미리보기"`. The UI requires the user to edit
or explicitly accept every `suggested` row. If the returned review answer still
contains any `suggested: true`, re-emit the review form instead of rendering.
The user may switch a section to `none`, add manual rows, or request another AI
pass by returning the stage to `intake`.

When `assistMode` is `manual`, or a review-stage draft has no unaccepted
suggestions, save the submitted `draft` JSON value as
`manual-interface-spec-draft.json`, then convert it with the deterministic CLI:

```bash
od docs create-manual-interface-spec \
  --input manual-interface-spec-draft.json --out interface-spec.json
```

The converter applies these rules:

- `source.codebaseName` = document name, `source.codebasePath` = `""`,
  `source.collector` = `"manual"`, `source.mode` = `"manual"`.
- Copy the selected `templatePreset` to the document root.
- Copy `minSize` and `maxSize` into the canonical request/response field rows.
- A section whose mode is `none` produces no fields even if hidden draft rows
  still exist.
- Keep a blank interface ID blank; the renderer assigns a stable domain ID.
- Map `undecided` authentication to `{ "type": "undecided" }` and
  `authRequired: true`; map `none` to `authRequired: false`; map every other
  choice to the same auth type with `authRequired: true`.
- Preserve `TBD` field required values. Never silently convert them to `N`.
- Reject duplicate `METHOD + path` pairs. Do not create an endpoint whose
  Method or Path is still blank.

After conversion, immediately run preview. The user edits the structured draft
or asks for a JSON-backed change; do not use generic HTML visual editing as the
source of truth. No code scan, codebase options, fill-mode, or database form
belongs in this workflow. Manual reference files are allowed only through the
intake described above.

On Windows, any PowerShell read used for follow-up inspection must specify
`Get-Content -Raw -Encoding utf8`. Prefer the docs CLI output and schema parser
over ad-hoc `ConvertFrom-Json` verification. Never interpret a UTF-8 Korean
document with Windows PowerShell's legacy default encoding.

## Every New Collection Requires New Options

Treat every request to create, regenerate, or collect an interface-spec
workbook for a new codebase, folder, service, API surface, or output document
as a **new collection**, even when it arrives in an existing conversation.
After the source preflight succeeds, and before inspecting code or creating
files for that new collection, emit the fixed `interface-spec-options` form
below again.

Never silently reuse a previous form answer, database connection selection,
selected schema/table set, dictionary choice, or example mode for a new
collection. In particular, do not fall back to `static-analysis` samples when
the user has asked for a new workbook but has not yet answered its options
form. The user must explicitly choose `database-sample` in the new form before
any approved read-only database context can be used.

## Fixed Interactive Form

Use the fixed options form below before collection. Its structure, question IDs,
option values, defaults, and conditional rules are fixed. Do not add, remove,
or reorder questions in that form. Localize only visible labels, descriptions,
and examples for the user's UI locale; never localize the IDs or values below.
In Korean, emit this form:

```json
{
  "id": "interface-spec-options",
  "title": "인터페이스 명세서 설정",
  "questions": [
    {
      "id": "fillMode",
      "label": "업무코드/담당자/비고 채우기 방식",
      "type": "radio",
      "defaultValue": "blank",
      "options": [
        { "label": "비움", "value": "blank", "description": "모든 인터페이스의 업무코드, 담당자, 비고를 공란으로 둡니다." },
        { "label": "일괄값", "value": "global", "description": "입력한 하나의 값을 모든 인터페이스에 적용합니다." },
        { "label": "도메인별 매핑", "value": "domain-mapping", "description": "operator, admin, customer 같은 업무 도메인별로 값을 매핑합니다." },
        { "label": "파일 업로드", "value": "file-upload", "description": "CSV, XLSX, XLSM, JSON 매핑 파일을 업로드합니다." }
      ]
    },
    {
      "id": "globalBusinessCode",
      "label": "일괄 업무코드",
      "type": "text",
      "placeholder": "예: ORD-001",
      "showWhen": { "questionId": "fillMode", "values": ["global"] }
    },
    {
      "id": "globalOwner",
      "label": "일괄 담당자",
      "type": "text",
      "placeholder": "예: 주문관리팀",
      "showWhen": { "questionId": "fillMode", "values": ["global"] }
    },
    {
      "id": "globalNote",
      "label": "일괄 비고",
      "type": "text",
      "placeholder": "예: 운영 기준",
      "showWhen": { "questionId": "fillMode", "values": ["global"] }
    },
    {
      "id": "mappingFile",
      "label": "도메인 매핑 파일",
      "type": "file",
      "storage": "mapping",
      "accept": ".csv,.xlsx,.xlsm,.json",
      "showWhen": { "questionId": "fillMode", "values": ["file-upload"] }
    },
    {
      "id": "dictionaryMode",
      "label": "한글-영어 매핑 사전",
      "type": "radio",
      "defaultValue": "ai",
      "options": [
        { "label": "AI 판단", "value": "ai", "description": "코드 이름, 주석, 업무 문맥으로 용어를 판단합니다." },
        { "label": "저장된 사전", "value": "saved", "description": "이 프로젝트 또는 전역 사전함에 저장된 사전을 선택하고 미리 봅니다." },
        { "label": "사전 업로드", "value": "upload", "description": "저장 위치를 고른 뒤 JSON, CSV, XLSX, XLSM 사전을 업로드합니다." }
      ]
    },
    {
      "id": "savedDictionary",
      "label": "저장된 사전",
      "type": "dictionary",
      "showWhen": { "questionId": "dictionaryMode", "values": ["saved"] }
    },
    {
      "id": "dictionaryFile",
      "label": "사전 파일",
      "type": "file",
      "storage": "dictionary",
      "accept": ".json,.csv,.xlsx,.xlsm",
      "showWhen": { "questionId": "dictionaryMode", "values": ["upload"] }
    },
    {
      "id": "coverDocName",
      "label": "표지 문서명",
      "type": "text",
      "placeholder": "예: 주문관리 API 인터페이스 명세서",
      "description": "표지에 표시할 문서명입니다. 비워 두면 기본 문서명을 사용합니다."
    },
    {
      "id": "coverVersion",
      "label": "문서 버전",
      "type": "text",
      "defaultValue": "1.0",
      "placeholder": "예: 1.0",
      "description": "표지에 표시할 문서 버전입니다."
    },
    {
      "id": "exampleMode",
      "label": "요청/응답 예시 보정 방식",
      "type": "radio",
      "defaultValue": "static-analysis",
      "options": [
        { "label": "샘플 예시", "value": "static-analysis", "description": "모든 HTTP 메서드의 DTO, 스키마, 타입만으로 중립적인 요청/응답 sample을 만듭니다. 서버나 DB에 요청하지 않습니다.", "example": "POST /users -> { \"userId\": 0, \"name\": \"sample\" }" },
        { "label": "승인된 DB 샘플 보정", "value": "database-sample", "description": "모든 메서드의 기본 샘플을 유지하면서 선택한 테이블의 스키마와 마스킹된 표본 행으로 값을 보정합니다. API 요청과 쓰기 SQL은 보내지 않으며, 승인된 read-only 표본 조회만 수행합니다.", "example": "users.user_id=42 -> { \"userId\": 42 }" }
      ]
    },
    {
      "id": "databaseContext",
      "label": "데이터베이스 컨텍스트",
      "type": "database-context",
      "sampleRows": 5,
      "databaseMode": "manual",
      "showWhen": { "questionId": "exampleMode", "values": ["database-sample"] }
    }
  ]
}
```

### Domain mapping confirmation

When `fillMode` is `domain-mapping`, do not ask for domain values in the first
form. First run the code inventory and derive only domains proven by route,
module, package, controller, or handler evidence. Then emit exactly one fixed
follow-up form with id `interface-spec-domain-mapping` and one question with id
`domainMapping` and type `domain-mapping`. Put the discovered domain names in
its `domains` array. The form renders three inputs per domain: business code,
owner, and note. Keep the submitted value as a JSON object keyed by domain.
If no domain is proven, show the empty state and leave all three fields blank.

```json
{
  "id": "interface-spec-domain-mapping",
  "title": "도메인별 업무코드/담당자/비고",
  "questions": [
    {
      "id": "domainMapping",
      "label": "코드에서 확인된 도메인별 값",
      "type": "domain-mapping",
      "domains": ["orders", "admin"]
    }
  ]
}
```

Do not emit a different question order or a separate question per domain. After
the answer, apply the JSON mapping to endpoints by the scanner's proven domain
or module; leave unmatched endpoints blank and report them.

Apply the selected fill mode deterministically after scanning:

```bash
python scripts/apply_fill_mode.py --input interface-spec.json \
  --mode blank|global|domain-mapping \
  [--business-code <value> --owner <value> --note <value>] \
  [--domain-map domain-values.json]
```

For `file-upload`, parse the uploaded mapping file into the same domain-keyed
JSON shape before applying it. Do not infer a domain value from memory or from
an unrelated endpoint.

### Database context confirmation

The `databaseContext` control asks the user to choose a saved connection, a
schema scope, and the tables to attach. The table list comes from read-only
schema metadata. The user can select every table in the selected schema or
every table across all schemas, then choose the sample row count and read
concurrency. Do not emit a second table-confirmation question: the initial
table selection is the user's consent for the exact tables that will be read.

After the user clicks attach, call the broker once with the selected
`schema.table` values:

```bash
od database inspect <connection-id> \
  --tables-file <selected-tables.json> \
  --limit <sampleRows> --concurrency <8|16|32> --json
```

The database-context form is the consent surface. Its user-selected schema
metadata request and selected-table request must not show a broker approval
dialog, even when the connection is set to `readApproval: "prompt"`. The saved
`always` setting still controls direct database reads outside this form. In
both cases, return only connection identity, columns, and redacted sample rows.
The form's **코드 기반 후보 찾기** action may scan project source files for
conservative SQL/ORM table references and mark only matching tables in the
current selection list. This action never reads the database and never submits
a second confirmation question; the user still clicks **선택한 표 첨부** to
request the redacted batch. Never silently expand the selection beyond those
explicitly marked tables or read an unselected table. If no table is selected,
continue with static code examples and report that no database sample was used.

For codebase mode, do not ask for document style. Use the fixed Korean SI
renderer preset unless the user explicitly requests a style override. Manual
mode uses the selected built-in template preset from its draft form. Do not
infer either choice from memory, prior conversations, or project metadata.

## Database Security

Never ask for, read, write, or echo a DB URL, username, password, `probe.env`,
`temp.txt`, Credential Manager value, connection string, or a credential file
path. Never run arbitrary SQL.

For database-derived documentation, direct the user to **Settings -> Database
connections**. The desktop main process stores PostgreSQL credentials using
OS-backed encryption. The initial database-context selection is explicit user
consent and bypasses broker prompts for that exact read-only flow. The
`readApproval: "always"` setting controls direct database reads outside the
form. Both paths return only connection identity, columns, and redacted sample
rows. Store that
approved payload in the project-local `.monofield/database-context/approved-db-context.json` file;
the chat answer carries only its path and selected table names. Stop if
approval is declined.

## Static Collection

1. Run the relevant scanner with `--inventory-only` first for a large
   codebase. If the result exceeds about 80 endpoints, ask the user to select
   scope before expanding DTOs.
2. If the database answer includes selected tables, use the approved context
   returned by the one batched inspect call. Save the returned columns and
   redacted rows to the project-local approved context JSON and pass its path
   with `--sample-context`; it contains no credential and causes no additional
   database read. If no table is selected, continue with static examples.
3. Run the full scanner, passing the saved approved context path with
   `--sample-context` when one exists; this file contains no credential and
   causes no new database read. The collectors also auto-discover the approved
   project file when the flag is omitted, so a missing flag must not silently
   discard approved samples.
4. Review route reachability, auth, Korean names, and any field a static
   parser cannot prove. Do not invent untraceable routes.

Use the `coverDocName` and `coverVersion` answers for `cover.docName` and
`cover.version`. If either answer is blank, keep the renderer's default or
empty value instead of inventing metadata.

```bash
python scripts/scan_spring.py --codebase-path <path> --inventory-only
python scripts/scan_<stack>.py --codebase-path <path> \
  --out interface-spec.json \
  [--modules a,b] [--name-dict dictionary.json|dictionary.xlsx|dictionary.xlsm] \
  [--sample-context approved-db-context.json]
```

Supported collectors:

| Stack | Scanner |
| --- | --- |
| Spring Boot / Java | `scripts/scan_spring.py` |
| FastAPI / Python | `scripts/scan_fastapi.py` |
| NestJS / TypeScript | `scripts/scan_nestjs.py` |
| Express / JavaScript | `scripts/scan_express.py` |
| Django / DRF | `scripts/scan_django.py` |
| Go (Gin, Echo, Chi) | `scripts/scan_go.py` |

Each scanner emits `requestExample` and `responseExample` with
`exampleSource: "static-analysis"`. These examples combine traced request and
response DTO fields with matching values from the approved redacted table
samples when available. They are documentation examples, not results from a
controller, service, mapper, transaction, or database mutation. Keep the
source marker intact.

Always generate the code-based sample for every collected HTTP method.
`database-sample` may use approved table values for any method. Never omit
POST, PUT, PATCH, or DELETE from the interface specification merely because
they are not executed.

## Output Document

Write `interface-spec.json` in the project directory. It must validate against
schema version 1 and contain one unique `METHOD + path` endpoint per route.
Keep `businessCode`, `owner`, and `note` blank unless the user's selected fill
mode supplied a value. Use `path`, `parentPath`, and `depth` for nested DTO
fields. Keep audit fields only when the user asks for them.

For a manual document, keep `source.mode: "manual"`, `collector: "manual"`, an
empty `codebasePath`, and the selected root `templatePreset`. For a codebase
document, use `source.mode: "codebase"` and the current default
`templatePreset: "si-standard"` unless an explicit supported override exists.

Before export, preview and then render through the daemon; never construct an
XLSX file by hand:

```bash
od docs preview-interface-spec --input interface-spec.json [--out preview.html]
od docs render-interface-spec --input interface-spec.json [--style style.json]
```

Report endpoint counts per domain, skipped/unprovable routes, the selected
dictionary/example mode, whether approved database samples were used,
and the written JSON/XLSX paths.
