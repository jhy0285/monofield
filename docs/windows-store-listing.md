# Microsoft Store listing and certification notes

Text to paste into Partner Center when submitting MonoField. The package and
identity steps are in [windows-store-release.md](windows-store-release.md).
Keep the claims here in step with the release notes and
`docs/testing/`; do not add numbers that were not measured.

## Properties

| Field | Value |
| --- | --- |
| Category | Developer tools |
| Privacy policy URL | `https://monofield.vercel.app/privacy` |
| Website | `https://monofield.vercel.app` |
| Support contact | `https://github.com/jhy0285/monofield/issues` |
| Pricing | Free, all markets |
| System requirements | Windows 10 version 2004 (build 19041) or later, x64 |

## Store listing (Korean)

**Product name:** MonoField

**Short description**

Codex·Claude Code 작업을 SI 산출물까지. Spring 코드에서 인터페이스 명세서
Excel을 만들고, 코드가 바뀌면 바뀐 API와 호출하는 쪽 영향을 보여 줍니다.

**Description**

MonoField는 Codex나 Claude Code CLI로 하던 개발 작업을 한국 SI 산출물로
이어 주는 Windows 작업대입니다.

- Spring·전자정부 표준프레임워크 코드를 읽어 인터페이스 명세서 Excel을
  만듭니다. 한글 필드명은 용어 사전과 소스 주석에서 가져옵니다.
- 코드가 바뀌면 기준 시점과 지금의 코드를 다시 읽어, 계약이 실제로 바뀐
  API만 보여 줍니다. 필드 삭제, 타입 변경, 열거값·기본값·필요 권한 변경을
  "호환성 깨짐 · 확인 필요 · 추가 변경"으로 나눕니다.
- 명세서를 OpenAPI 3.1로 내보내고, OpenAPI 문서에서 명세서를 만들 수도
  있습니다.
- 화면 설계서 PPTX, 레거시 인수인계 문서 같은 다른 산출물도 같은 작업
  공간에서 만듭니다.

AI 기능에는 Codex CLI나 Claude Code CLI가 따로 필요하며, 사용하는 AI
회사의 이용 조건과 요금이 그대로 적용됩니다. 정밀 변경 분석에는 Python 3이
필요합니다. MonoField는 계정이 없고 사용 통계를 보내지 않습니다.

**Features** (one per line)

- Spring 코드에서 인터페이스 명세서 Excel 생성
- 코드 변경 시 바뀐 API와 호출자 호환성 표시
- 열거값·기본값·필요 권한 변경 감지
- OpenAPI 3.1 내보내기와 가져오기
- 전자정부 XML 보안 설정으로 로그인 필요 여부 판정
- Codex·Claude Code CLI 연결

**Keywords** (up to 7): 인터페이스 명세서, SI, Spring, OpenAPI, 전자정부,
Codex, Claude Code

## Store listing (English)

**Short description**

From Codex and Claude Code work to Korean SI deliverables: interface-spec
workbooks generated from Spring code, and the APIs and callers affected when
the code changes.

**Description**

MonoField is a Windows workbench that turns development work done with the
Codex CLI or Claude Code CLI into Korean SI deliverables.

- Reads Spring and eGovFrame code and writes an interface-specification
  Excel workbook, taking Korean field names from a term dictionary and source
  comments.
- When the code changes, it re-reads the code at the baseline and now and
  lists only the APIs whose contract changed, classifying removed fields,
  type changes and enum, default and permission changes as breaking, to check
  or additive.
- Exports specs as OpenAPI 3.1 and builds specs from OpenAPI documents.
- Screen-design PPTX and legacy handover documents are made in the same
  workspace.

AI features need the Codex CLI or Claude Code CLI installed separately; that
provider's terms and charges apply. The precise change analysis needs
Python 3. MonoField has no account and sends no usage statistics.

## Age rating (IARC questionnaire)

Answer as a developer tool with no violence, sexual content, gambling or
purchases. Two answers are yes, and should be given as yes:

- The built-in browser gives **unrestricted internet access**.
- Users can exchange content with an AI model they connect; the app does not
  host users talking to each other.

## Submission options: restricted capability

Partner Center asks why the package declares `runFullTrust`. Paste:

> MonoField is a desktop development workbench built with Electron. It starts
> its own local document service and runs the developer's command-line tools
> (Git, Python, and the Codex or Claude Code CLI the user installed) inside a
> project folder the user chooses, which requires a full-trust desktop
> process. It does not install drivers or services and does not run with
> administrator rights unless the user turns on full access in Settings.

## Notes for certification

> MonoField needs the Codex CLI or Claude Code CLI, signed in by the user, for
> its AI features, and Python 3 for the precise change analysis. Without them
> the app opens and shows the home screen, settings, the in-app Guide Center
> with its intro video and the built-in browser; generating a specification
> needs one of those AI tools. A 15-minute walk-through with a sample project
> is at https://monofield.vercel.app/get-started.
