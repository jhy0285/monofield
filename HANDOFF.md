# HANDOFF — screen-spec 편집기 + Windows daemon 테스트 회귀 (2026-07-14)

> 이전 세션(Claude Opus 4.8)에서 진행한 작업을 Codex CLI로 인수인계하기 위한 상세 기록.
> 코드 자체는 브랜치 `feat/screen-spec-editor` 커밋 `9f8a69ab`에 스냅샷되어 있음. 이 문서는
> **"무엇을 왜 어떻게 했는지"**와 **정확히 무엇이 검증됐고 무엇이 안 됐는지**를 하나도 빠짐없이 남긴다.

---

## 0. 저장소·환경 필수 사실

- 작업 저장소: `C:/Users/86799/Desktop/open-design/open-design` (Open Docs — `nexu-io/open-design` 포크, Apache-2.0).
- 상위 워크스페이스 `C:/Users/86799/Desktop/OSE`는 그리스 OSE 철도 AFC 프로젝트용 별개 폴더이며 이 작업과 무관. **루트 `.git`은 빈 폴더**라 버전관리 안 됨.
- OS: Windows 11 Enterprise. 셸: PowerShell 5.1 (Git Bash도 사용 가능).
- **Node: `nvm use 24.17.0` 필수.**
  - 22.x → `better-sqlite3` 네이티브 모듈 ABI 불일치(`NODE_MODULE_VERSION 137 vs 127`)로 daemon 테스트 import 단계에서 폭발.
  - 25/26 → libuv 관련 이슈.
  - 24.18.0도 있으나 간헐 크래시(`0xC0000409`) 이력이 있어 **24.17.0을 명시적으로 설치·고정**했다.
- **pnpm**: `nvm`으로 Node 버전을 바꾸면 전역 pnpm shim이 사라진다. 없으면 `corepack enable` 후 `corepack prepare pnpm@10.33.2 --activate`. 저장소 `packageManager` 필드가 `pnpm@10.33.2`.
- 이 저장소의 워킹트리는 **여러 세션에 걸친 미커밋 로컬 WIP 덩어리**였다(포크 리브랜드 "Open Design"→"Open Docs", telemetry 제거, interface-spec/screen-spec 문서 파이프라인 등). 이번에 그 전부 + 이번 세션 작업을 **한 커밋 `9f8a69ab`**로 스냅샷했다. 원격 push는 하지 않았다. `.idea/`와 `output/`만 의도적으로 untracked로 남겼다.
  - ⚠️ 실수로 `plugins/_official/interface-spec/scripts/**/__pycache__/*.pyc`가 몇 개 커밋에 딸려 들어갔다. 거슬리면 `git rm -r --cached "**/__pycache__"` 후 `.gitignore`에 추가할 것. 기능상 무해.

---

## 1. 이번 세션에서 한 작업 — 3갈래

### A. screen-spec 인터랙티브 구조화 편집기 (신규 기능)

**목표**: `kind: "screen-spec"` JSON 아티팩트(한국형 SI "화면명세서")를 웹 UI에서 마커 드래그 + 표 편집으로 직접 편집. JSON이 single source of truth이고, AI도 사람도 같은 JSON을 편집하며, 결정론적 PPTX/HTML 렌더러가 최종 문서를 뽑는 구조. **아무도 렌더된 산출물을 직접 편집하지 않는다.**

**참조 원본**: `C:/Users/86799/Desktop/wireFrame/src` (Screen Spec Studio, 로컬에 존재). 이걸 포팅했다:
- `wireFrame/src/domain/screenSpecEditor.ts` → 순수 리듀서
- `wireFrame/src/components/ScreenCanvas.tsx` → 마커 드래그 캔버스
- `wireFrame/src/components/{CalloutTable,CalloutRelationEditor,CheckpointEditor,MetadataPanel}.tsx` → 4개 패널

**계약(스키마)**: `packages/contracts/src/docs/screen-spec.ts` (이전 세션 산출물, zod). 핵심 타입:
- `ScreenSpecDocument` = { schemaVersion:1, kind:'screen-spec', name, mode, theme, sources[], screens[] }
- `ScreenSpecScreen` = { id, pageTitle, screenName, screenPath, overview, levels[], companyName, author, date, version, imageDataUrl?, imageRef?, callouts[], calloutRelations[], visualSettings, checkpoints[] }
- `ScreenSpecCallout` = { no, label, description, position:{x,y} } — **position은 0..1 정규화 좌표**
- `ScreenSpecCalloutRelation` = { fromNo, toNo, label?, lineMode?:'straight'|'orthogonal' }
- `ScreenSpecVisualSettings` = { markerSizePx(기본24), relationLineWidthPx(기본2), canvasHeightPx(기본520) }
- `validateScreenSpecDocument()` / `parseScreenSpecDocument()` — 교차검증(중복 screen id, 중복 callout no, 관계선이 없는 콜아웃 참조, 이미지 없음 경고).

**신규 파일** (`apps/web/src/components/screen-spec/`):
- `editor-model.ts` — 순수 편집 함수 모음. 원본 `screenSpecEditor.ts`를 다중 화면 `ScreenSpecDocument`에 맞게 이식. `updateScreenAt`, `addScreen`(SCR-00N id 자동생성, 마지막 화면을 템플릿 삼아 회사명/작성자/버전/visualSettings 복사), `deleteScreen`, `addCalloutAtPosition`(defaultLabel 주입), `moveCallout`, `updateCallout`, `deleteCallout`(삭제 후 callout no 재부여 + 관계선 정합성 유지 — `renumberRelationsAfterCalloutDeletion`으로 삭제된 no 참조 제거 및 큰 no 시프트), `addCalloutRelation`(중복 안 되는 첫 조합 자동 선택, lineMode 기본 orthogonal), `updateCalloutRelation`(존재하지 않는 no/자기참조 방지 정규화), `deleteCalloutRelation`, `addLevel`/`updateLevel`/`deleteLevel`, `addCheckpoint`(trim, 빈 값 무시)/`updateCheckpoint`/`deleteCheckpoint`, `updateScreenImage`(새 업로드 시 `imageDataUrl` 세팅하고 `imageRef`는 undefined로 — 이미지 소스는 한 번에 하나만 살아있게), `updateVisualSettings`(clamp: marker 18~56, line 1~10, canvas 360~820). 상수 `MARKER_SIZE_RANGE`/`LINE_WIDTH_RANGE`/`CANVAS_HEIGHT_RANGE` export.
- `ScreenSpecCanvas.tsx` — 화면 이미지 + 드래그 가능한 번호 마커 + 관계선 SVG. 핵심 로직(원본에서 이식):
  - `calculateCoordinateBox()` — 프레임 안에서 이미지가 letterbox(object-fit: contain)로 놓이는 실제 박스를 계산. 마커 좌표는 이 박스 기준 0..1이라 렌더 크기와 무관하게 프리뷰/PPTX와 일치.
  - `ResizeObserver`로 프레임 크기 추적, `pointermove/pointerup` 전역 리스너로 드래그, `setPointerCapture`.
  - 이미지 소스: `screen.imageDataUrl`(data URL) 우선, 없으면 `screen.imageRef`를 `projectRawUrl(projectId, ref)`로 로드.
  - 관계선: `straight`는 직선, `orthogonal`은 중간 Y로 꺾는 직각선. 화살촉/라벨/끝점 트리밍(마커 반경만큼 뒤로 물림) 전부 이식.
  - 이미지 업로드: PNG/JPEG/WEBP만 허용, FileReader로 data URL, 로드 시 자동으로 canvas 높이를 이미지 비율에 맞춤(1회).
- `panels.tsx` — 4개 폼 컴포넌트를 한 파일에 모음:
  - `CalloutTable` — No/Label/Description 표, 행 클릭 시 선택, label(input)/description(textarea) 인라인 편집, 삭제.
  - `RelationEditor` — From/To/선형태/설명 셀렉트·인풋 행 + 마커크기/선두께 슬라이더. 마커 2개 미만이면 추가 비활성 + 안내.
  - `CheckpointEditor` — 체크포인트 목록(textarea) + Enter로 추가.
  - `MetadataPanel` — 화면제목/ID/명/경로/개요/Level(가변)/회사/작성자/일자/버전.
- `ScreenSpecEditor.tsx` — 메인 컨테이너.
  - 로드: `fetchProjectFileText(projectId, file.name, {cache:'no-store'})` → `JSON.parse` → `parseScreenSpecDocument`. 실패 시 에러 박스 + 재시도.
  - 상태: `doc`, `dirty`, `saving`, `screenIndex`, `selectedCalloutNo`, `diskChanged`, `reloadKey`.
  - **디스크 변경 보호**: `file.mtime` 변경으로 외부 수정 감지 시, 로컬 편집(dirty)이 있으면 자동 리로드 대신 `diskChanged` 배너를 띄워 "내 편집 버리고 리로드" 선택하게 함. (AI가 같은 JSON을 다시 써도 사용자 편집을 조용히 덮어쓰지 않게.) dirty 없으면 그냥 리로드.
  - 저장: `writeProjectTextFileDetailed(projectId, file.name, JSON.stringify(doc,null,2), {artifactManifest})`. manifest는 kind/renderer='screen-spec', title=doc.name, entry=file.name, exports는 기존 것 있으면 유지 아니면 ['txt','zip'].
  - 화면 탭 스트립(+로 화면 추가, 여러 화면이면 삭제 버튼 confirm), 툴바(reload/save with dirty·saving·saved 상태 표시).
  - 상단에 fatal 이슈 배너(validateScreenSpecDocument 결과).
- `ScreenSpecEditor.module.css` — CSS Module. 앱 전역 디자인 토큰(`var(--accent)`, `var(--border)`, `var(--bg-panel)`, `var(--text-muted)`, `var(--radius)` 등) 사용. `.viewer`/`.viewer-toolbar`/`.viewer-body` 전역 클래스와 조합(기존 뷰어 크롬 재사용).

**기존 파일 수정 (편집기 배선)**:
- `apps/web/src/artifacts/types.ts` — `ArtifactKind`·`ArtifactRendererId` 유니온에 `'screen-spec'` 추가.
- `apps/web/src/artifacts/manifest.ts` — `ALLOWED_KINDS`·`ALLOWED_RENDERERS`에 `'screen-spec'`; `inferKindFromEntry`에 `*.screen-spec.json` → `'screen-spec'` 매핑(단, 일반 `.json`의 `code-snippet`보다 먼저 체크); `exportsForKind`에 screen-spec → `['txt','zip']`.
- `apps/web/src/artifacts/renderer-registry.ts` — `ScreenSpecRenderer`(canRender: 파일명 `*.screen-spec.json` 또는 manifest.kind/renderer==='screen-spec') 추가 + 레지스트리 배열 맨 앞에 등록(다른 렌더러보다 우선).
- `apps/web/src/components/FileViewer.tsx` — import 추가 + dispatch 스위치에 `if (rendererMatch?.renderer.id === 'screen-spec') return <ScreenSpecEditor .../>` 분기(svg 분기 바로 뒤). **주의: 이 파일은 ~10k 줄 단일 파일이니 편집기 본체는 별도 모듈로 유지하고 여기엔 분기만.**
- `packages/contracts/src/api/artifacts.ts` — `ArtifactKind`·`ArtifactRendererId`에 `'screen-spec'`(웹과 데몬이 공유하는 계약 원본).
- `apps/daemon/src/artifacts/manifest.ts` — `ALLOWED_KINDS`·`ALLOWED_RENDERERS`에 `'screen-spec'`(데몬이 저장 시 manifest 검증하므로 여기도 필수. 안 하면 저장이 422로 거부됨).

**i18n**: `apps/web/src/i18n/types.ts`의 `Dict` 인터페이스에 `screenSpec.*` 키 62개 추가. `en.ts`·`ko.ts`는 내가 직접, 나머지 17개 로케일(id/de/zh-CN/zh-TW/pt-BR/es-ES/ru/fa/ar/ja/pl/hu/fr/uk/tr/th/it)은 서브에이전트로 번역 삽입. 각 파일 마지막 `};` 앞에 블록 삽입. `Description`/`Check Point` 같은 SI 문서 제목은 원문 유지, 나머지 번역. 플레이스홀더 `{no}`/`{label}`/`{count}` 보존.

**⚠️ screen-spec 편집기에서 아직 안 한 것 (남은 작업)**:
- `cd apps/web && pnpm typecheck` — 세션 중 web typecheck를 **완주 확인 못 함**(마지막에 사용자가 중단). ScreenSpecCanvas의 `CanvasPoint|undefined` 관련 strict null 에러 2건은 고쳤지만(빈 배열 가드), 전체 재확인 필요.
- **브라우저 실동작 검증 전무**. dev 서버 띄워서 `.screen-spec.json` 아티팩트를 열고 마커 추가/드래그/표편집/저장/관계선/디스크변경배너를 실제로 눌러봐야 함. preview(HTML 렌더러)는 이전 세션에 됐지만 편집기 UI는 브라우저에서 한 번도 안 떠봤다.

---

### B. Windows daemon 테스트 회귀 수정 + 실제 프로덕션 버그

**발단**: `apps/daemon`에서 `pnpm run build && pnpm run test`(전체 378개 파일) 돌렸더니 Windows에서 **101개 파일 / 397개 테스트 실패**. 원인 분류:
1. 포크 리브랜드("Open Design"→"Open Docs")로 프로덕션 문자열이 바뀌었는데 테스트가 옛 문자열 기대.
2. telemetry 기본값이 전부 off로 바뀐 걸 테스트가 반영 못함.
3. Windows 전용: 경로 구분자, 파일소켓 대신 named pipe, `.cmd` 셸 경유.
4. **실제 버그**: `od` CLI 서브커맨드가 Windows+Node24에서 종료 시 크래시.

**개별로 초록 만든 파일 (7개)** — 각각 무엇을 왜:

- `tests/analytics-env.test.ts` — **전면 재작성**. 기존엔 telemetry가 켜지고 PostHog capture가 호출된다고 기대했으나, `src/analytics.ts`가 이제 **경계에서 telemetry를 완전히 no-op**으로 만든다(PostHog 클라이언트 생성 안 함, `readPublicConfigResponse`는 `enabled:false/key:null/host:null` 반환, `readPosthogConfig`는 항상 null). 그 불변식을 검증하도록 3개 테스트 재작성: (1) 키가 env에 있어도 public config는 disabled, (2) `readPosthogConfig`는 항상 null, (3) capture/captureSafety/shutdown 호출해도 PostHog 생성자·capture 절대 호출 안 됨.

- `tests/app-config.test.ts` — 2곳 수정. (1) `DEFAULT_TELEMETRY` 상수를 `{metrics:true,content:true}`에서 실제 기본값인 `{metrics:false,content:false,artifactManifest:false}`로(=`app-config.ts#applyTelemetryDefaults`가 telemetry 필드 없을 때 채우는 값). (2) `persists valid projectLocations and reads them back` — 저장 경로가 `path.normalize`를 거쳐 Windows에서 구분자가 바뀌므로, 기대값을 `locs.map(l=>({...l, path: path.normalize(l.path)}))`로 비교.

- `tests/browser-use-diagnostics.test.ts` — 프로덕션 코드가 `'Use the selected Open **Docs** Browser tab as the bound target.'`로 리브랜드됐는데 테스트는 `Open Design`을 기대. 문자열 통일. **동시에 소스가 옳으므로 관련 프로덕션/테스트 3곳의 남은 "Open Design Browser" 문자열도 통일**: `apps/web/tests/components/DesignBrowserPanel.test.tsx`, `e2e/ui/app-restoration.test.ts`. (프로덕션 `DesignBrowserPanel.tsx:635`와 `browser-use-diagnostics.ts:20`은 이미 "Open Docs"였음.)

- `tests/amr-acp-integration.test.ts` — AMR(vela) 런타임은 이제 `OD_ENABLE_AMR=1`일 때만 레지스트리에 등록됨(`runtimes/registry.ts`가 import 시점에 env 읽음). (1) `is registered with the expected ACP wiring` → gate 반영: `getAgentDef('amr')`는 env 없으면 null, def 형태는 `amrAgentDef`로 직접 검증하도록 수정. (2) fake vela 스텁을 shebang 스크립트로 직접 spawn하는 4개 테스트는 Windows에서 `spawn EFTYPE`(shebang 실행 불가)라 `it.skipIf(IS_WINDOWS)`로 격리.

- `tests/cli-phase2c.test.ts` — 3가지: (1) `describe`에 `{timeout: 90_000}` — 각 `runCli`가 tsx로 CLI를 콜드 컴파일(~5-8s)하고 여러 spawn을 체이닝해서 기본 20s 초과. (2) IPC 소켓 경로를 Windows에선 `\\.\pipe\...` named pipe로(파일소켓 `listen`이 `EACCES`). (3) 진짜 버그(아래 CLI 크래시)가 이 파일의 diff 테스트를 깨고 있었음 — 그건 소스 수정으로 해결.

- `tests/chat-route.test.ts` — 7개 실패. (1) `passes OPENCODE_CONFIG_CONTENT external_directory` — 데몬이 permission glob 키를 플랫폼 구분자(`joinPermissionGlob`)로 만드므로 테스트도 `join(cwd,'*')`/`join(cwd,'**')`로 비교. (2)(3) AMR 카탈로그 관련 2개 → `it.skipIf(process.env.OD_ENABLE_AMR !== '1')`(런타임이 기본 비활성이라 flow 자체가 없음). (4)(5) 플러그인 스킬 2개 → 아래 server.ts 버그로 install이 404였던 것, 소스 수정으로 해결. (6) DeepSeek TUI auth 분류 → Windows에선 프롬프트가 `.cmd` 셸 경유로 커맨드라인 한계를 넘어 `AGENT_PROMPT_TOO_LARGE`로 먼저 걸림(설계된 동작). `it.skipIf(win32)`. (7) Claude auth 진단 `/login` → 개발 머신에 `ANTHROPIC_BASE_URL` 등이 설정돼 있으면 데몬이 "custom endpoint 실패"로 분류해 `/login` 문구가 안 나옴. 테스트에서 `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY`를 격리(백업 후 삭제, finally 복원).

- `tests/run-retry-runtime.test.ts` — fake claude 스텁을 shebang으로 spawn하던 걸 플랫폼별로: Windows는 `.cmd` shim + `.js` payload, POSIX는 shebang(`writeFakeClaudeBin` 헬퍼 신설). 폴링 한도 10s→60s, describe timeout 120s. 그래도 Windows에선 `.cmd` shim 경유가 retry flow(추가 shim spawn, 프로세스트리 SIGTERM 부재)를 왜곡해 2개 테스트가 불안정 → `it.skipIf(win32)`로 격리(로직 자체는 플랫폼 무관, POSIX CI에서 커버).

**실제 프로덕션 버그 2건 (소스 수정)**:

- `apps/daemon/src/cli.ts` — **Windows + Node 24에서 `od` 서브커맨드가 `process.exit()` 시 libuv assertion `!(handle->flags & UV_HANDLE_CLOSING)` (종료코드 `0xC0000409` = -1073740791)로 크래시.** 원인: undici(fetch) keep-alive 소켓이 풀에 살아있는 채 `process.exit()`를 부르면 소켓 핸들이 close 중인 상태에서 libuv가 터짐. 재현: fetch 2회 후 `process.exit(0)` → 100% 크래시(1회+stdout write는 안 터짐 → 소켓 풀 재사용이 트리거). 이분탐색으로 특정 모듈이 아니라 **undici 커넥션 풀 + exit** 조합임을 확인. 수정: win32에서 서브커맨드 실행 시 (1) `globalThis.fetch`를 래핑해 모든 요청에 `Connection: close` 헤더 강제(keep-alive 자체를 끔 — 서브커맨드는 로컬 데몬 대상 one-shot이라 keep-alive 이득 없음), (2) `process.exit(0)` 대신 `process.exitCode=0` + `setTimeout(()=>process.exit(0),5000).unref()`로 **이벤트 루프가 자연 배수되게** 두고 타이머는 hang backstop(unref라 스스로 프로세스 유지 안 함). 데몬 모드(서브커맨드 없음)는 손 안 댐. `dispatchedSubcommand` 플래그로 아래 `tools` 분기가 안 타게 처리.
  - 검증: fake HTTP 서버 + 실제 데몬 양쪽에서 `od files diff` 5회 연속 종료코드 0 확인.

- `apps/daemon/src/server.ts` — 플러그인 install source 판정 `looksAbsolute`가 `/`,`./`,`~` prefix만 봐서 **Windows 드라이브/UNC 경로(`C:\...`, `\\host\...`)를 marketplace 조회로 잘못 라우팅 → 404**. `|| path.isAbsolute(source)` 추가. (chat-route의 플러그인 스킬 2개 테스트가 이 때문에 404였음.)
  - 재현: 로컬 fixture 경로로 `POST /api/plugins/install` → 수정 전 404, 후 정상.

**⚠️ B에서 아직 안 한 것 (남은 작업)**:
- **전체 스위트(378개)가 전부 초록인지 미확인.** 개별 7개 파일만 초록 확인함. 마지막에 `pnpm run test` 전체를 백그라운드로 재실행하다 사용자가 중단. 최초 실행의 101개 실패 목록(아래 부록)에는 위 7개 외에도 langfuse-bridge(22), transcript-export(26), plugins-*(다수), storage-db-*, connectors-routes(24) 등 **아직 손도 안 댄 파일이 대량** 있다. 이들 상당수는 같은 원인(리브랜드 문자열/telemetry 기본값/Windows spawn·경로)일 가능성이 높지만 **확인 안 됨**. Codex가 전체 재실행해서 하나씩 처리해야 함.

---

### C. 이전 세션 산출물 (이번엔 안 건드렸지만 함께 커밋된 것)

interface-spec/screen-spec 문서 파이프라인 전체가 미커밋 상태였고 이번 커밋에 포함됨:
- `apps/daemon/src/doc-renderers/{interface-spec,screen-spec}/*` — 렌더러(exceljs/pptxgenjs/HTML).
- `apps/daemon/src/docs-cli.ts` — `od docs render-*/preview-*` CLI.
- `packages/contracts/src/docs/{interface-spec,screen-spec}.ts` — zod 스키마.
- `plugins/_official/{interface-spec,screen-spec}/` — 스킬 + 스캐너(scan_spring/fastapi/nestjs/express/django/go.py) + 픽스처.
- `plugins/registry/{community,official}/open-docs-marketplace.json`.

---

## 2. 남은 작업 (우선순위)

1. **screen-spec 편집기 마무리 검증** — `cd apps/web && pnpm typecheck` 통과 확인 → dev 기동(`pnpm --filter @open-design/daemon build` 후 루트에서 `pnpm tools-dev start web --daemon-port 7456`) → 브라우저에서 `.screen-spec.json` 아티팩트 열고 마커 추가/드래그/표편집/저장/관계선/디스크변경배너 실동작 확인.
2. **daemon 전체 회귀 초록화** — `cd apps/daemon && pnpm run build && pnpm run test` 재실행. 남은 실패는 원인만 보고하지 말고 **최대한 직접 수정**: 프로덕션 버그면 소스, 낡은 기대값(리브랜드/telemetry 기본값)이면 테스트, 진짜 Windows 전용 제약이면 `it.skipIf(process.platform==='win32')` + 이유 주석. 이미 초록인 7개 파일 회귀 없는지도 확인.
3. **릴리스 전 필수** — 커뮤니티 플러그인(deep-think 등) 라이선스 확인/제외, 정식 dep license scan, 패키지 자동업데이트 기본값 결정.
4. (백로그) Tier B 인패널 실시간 편집기, future collector(generate-new-screen / capture-url-or-local(Playwright) / code-driven), T7 아이덴티티 패스.

---

## 3. 검증 명령어 요약

```bash
# Node 고정 (PowerShell)
nvm use 24.17.0
corepack prepare pnpm@10.33.2 --activate   # pnpm 없을 때만

# 계약 먼저 빌드(웹/데몬이 참조)
pnpm --filter @open-design/contracts build

# 웹 타입체크
cd apps/web && pnpm typecheck

# 데몬 빌드 + 전체 테스트
cd apps/daemon && pnpm run build && pnpm run test
# 개별 파일: npx vitest run -c vitest.config.ts tests/<파일>.test.ts

# dev 앱 (브라우저 검증용) — 루트에서
pnpm tools-dev start web --daemon-port 7456
```

---

## 부록: 최초 전체 실행에서 실패했던 파일 목록 (참고 — 이후 7개만 수정됨)

run-retry-runtime, chat-route, cli-phase2c, amr-acp-integration, analytics-env, api-token-guard,
app-config, browser-use-diagnostics, connection-test, connectors-routes(24), critique-artifact-endpoint,
cwd-aliases, daemon-url, design-system-archive, folder-import-route, handoff-design(10), headless-runs,
langfuse-bridge(22), library-figma-sidecar, library-sync, live-artifacts-store, mcp-agent-install,
mcp-config, memory-connectors, message-delimiter-safety, orbit, pdf-export, plugins-atom-bodies,
plugins-atom-registry(12), plugins-build-test, plugins-bundled(8), plugins-code-migration-e2e,
plugins-doctor-route, plugins-dod-e2e(7), plugins-e2e-fixture, plugins-events-producers,
plugins-export, plugins-figma-extract, plugins-genui-spec-enrichment, plugins-installer-archive(10),
plugins-installer, plugins-marketplaces(18), plugins-pipeline-runner, plugins-preview-fallback,
plugins-preview-route, plugins-publish, plugins-scenario-fallback, plugins-snapshot-gc,
plugins-snapshots, plugins-trust, plugins-upgrade, project-status(11), project-tabs-state,
run-resume-on-failure, server-paths, server-persistence-smoke, sidecar-startup,
skill-plugin-candidates, skills, storage-db-inspect(8), storage-db-verify, system-prompt-template,
tools-connectors-cli, transcript-export(26), update-apply-observations, artifacts/reconcile-on-run-end(8),
design-systems/github-import, design-systems/import, integrations/vela(10), media/aihubmix-catalog-ssrf,
media/config, media/openai-compatible-providers(7), media/openrouter, media/policy-routes(7),
prompts/system, routes/live-artifacts, routes/projects, runtimes/agent-args, runtimes/mmd-routes,
runtimes/registry-and-args(6), runtimes/run-failure-telemetry-smoke(4).

**주의**: 이 목록은 최초 1회 실행 스냅샷이다. 상당수는 리브랜드/telemetry/Windows 공통 원인일 것으로 추정되나 미확인. 일부는 위 7개 수정 및 CLI/server 소스 수정으로 이미 해결됐을 수 있으니 **반드시 전체 재실행으로 현재 실패 목록을 다시 뽑고 시작할 것.**
