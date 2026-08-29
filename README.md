<p align="center">
  <a href="https://monofield.vercel.app">
    <img src="apps/monofield-site/mark.svg" width="72" height="72" alt="MonoField mark" />
  </a>
</p>

<h1 align="center">MonoField</h1>

<p align="center">
  <strong>code / design / documents</strong><br />
  One workspace, every kind of work
</p>

<p align="center">
  <a href="https://monofield.vercel.app">Website</a> ·
  <a href="https://github.com/jhy0285/monofield/releases/latest/download/MonoField-default-setup.exe">Download for Windows</a> ·
  <a href="https://github.com/jhy0285/monofield/releases/latest">Latest release</a> ·
  <a href="docs/open-source-compliance.md">Open-source notices</a>
</p>

<p align="center">
  <img alt="Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-f4f4f2?style=flat-square&labelColor=111111" />
  <img alt="Local-first desktop" src="https://img.shields.io/badge/runtime-local--first-f4f4f2?style=flat-square&labelColor=111111" />
  <img alt="Node 24" src="https://img.shields.io/badge/Node-24-f4f4f2?style=flat-square&labelColor=111111" />
  <img alt="Windows desktop" src="https://img.shields.io/badge/Desktop-Windows-f4f4f2?style=flat-square&labelColor=111111" />
  <a href="https://github.com/jhy0285/monofield/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/jhy0285/monofield?style=flat-square&label=GitHub%20Stars&color=f4f4f2&labelColor=111111" /></a>
</p>

<p align="center">
  <a href="https://monofield.vercel.app">
    <img src="apps/monofield-site/social-card.svg" width="860" alt="MonoField — code / design / documents" />
  </a>
</p>

MonoField is a local-first desktop workbench for people who need to move from a
request to a result without losing the project context along the way. The
working folder, Git changes, run configuration, live browser, governed database
access, references, and deliverables stay attached to one project.

```text
connect                         work                         prove
folder · files · browser     →  ask · edit · run          →  diff · build · UI check
database · rules · brand        compose · review · export    code · XLSX · PPTX · PDF
```

> **한국어 소개** — MonoField는 작업 폴더, Git 변경사항, 실행 화면, 승인된
> 데이터베이스, 참고 자료와 산출물을 하나의 프로젝트에 연결합니다. 코드 수정부터
> 인터페이스·화면 명세서, 프로토타입, 슬라이드와 export까지 같은 근거를 사용하고,
> diff·빌드·브라우저 검증으로 결과를 확인합니다.

## Two ways to work

| | Software development | Documents / design |
| --- | --- | --- |
| **Start with** | A codebase or multi-project workspace | A brief, source files, code, browser evidence, or an empty draft |
| **Work with** | Git diff, discovered run configs, terminal and server logs, in-app browser, governed DB access | Brand systems, dictionaries, references, structured editors, previews and comments |
| **Deliver** | Reviewed code with build/test and UI evidence | Interface specs, screen specs, responsive pages, prototypes, decks, spreadsheets, PDFs and media |

The two project modes do not lock the conversation. Use **Ask** for explanation,
analysis, and review; use **Docs** when the task should produce or revise a
structured deliverable.

## What makes it useful

- **The folder is the execution boundary.** The selected project is the root
  used by the agent, run configuration, Git view, browser, and database policy.
- **The result stays reviewable.** Compare before and after, inspect build and
  test results, then verify the running interaction in an approved browser tab.
- **Database access is explicit.** Credentials stay in the encrypted Desktop
  vault; each project or module uses a selected read/write policy and audit
  trail.
- **Documents can use real evidence.** Generate interface and screen
  specifications from selected code, browser state, approved schema, files,
  dictionaries, and brand rules—then review and export the result.
- **Guidance is built in.** First-run onboarding is followed by a seven-step
  development walkthrough or a four-step documents/design walkthrough. Both can
  be opened again from the product guide.

## Runtime capability boundary

MonoField can connect to supported **local CLI agents** and to **BYOK / OpenAI-
compatible endpoints**, but these are not identical execution paths.

- A capable local CLI adapter can work against the selected project root and
  participate in file edits, terminal commands, Git, browser verification, and
  governed database workflows.
- BYOK and OpenAI-compatible endpoints are available for conversation and
  document generation. They do not automatically inherit Desktop file,
  terminal, browser, or database tools.
- Tool and model coverage depends on the installed adapter and its current
  version. A detected third-party CLI should not be assumed to have full parity
  with Codex, Claude Code, Gemini CLI, or OpenCode until its capabilities are
  shown and verified in MonoField.

This boundary is displayed because the model is the engine—not the security or
tooling boundary.

## Install

- [Windows installer](https://github.com/jhy0285/monofield/releases/latest/download/MonoField-default-setup.exe)
- [Portable package](https://github.com/jhy0285/monofield/releases/latest/download/MonoField-default-portable.zip)
- [Release notes and checksums](https://github.com/jhy0285/monofield/releases/latest)
- Microsoft Store — shown on the [MonoField website](https://monofield.vercel.app)
  after the public listing is certified

The installer link downloads the EXE directly from the latest GitHub Release.
The current public Desktop build targets Windows 10/11. Direct-download builds
are unsigned, so Windows can show an unrecognized-publisher warning; verify the
download with the release's `SHA256SUMS.txt`. See
[the user guide](https://monofield.vercel.app/downloads/monofield-user-guide-ko.pdf)
for illustrated setup and real workflows.

Installed Desktop builds check the public release feed in the background. When
a newer version is available, MonoField shows a once-per-version update notice
with the release notes, direct download, and an optional GitHub Star link. If
Desktop notifications are enabled, the same notice can appear through Windows
while MonoField is in the background.

### Run from source

Requirements: Node.js 24, pnpm 10.33.x, and at least one supported local CLI
agent for the complete development workflow.

```powershell
# Windows native (run once; Corepack may require elevated Program Files access)
npm install -g pnpm@10.33.2
pnpm install
pnpm build:web
pnpm dev:desktop
pnpm tools-dev status --json
```

Pick a working folder in MonoField to make it the active project root. Useful
focused checks:

```powershell
pnpm check:contracts
pnpm check:web
pnpm build:web
pnpm check:daemon
```

The product and Desktop app are **MonoField**. The command-line entry point is
`monofield`.

## Security and data boundary

Project files stay in the working folder you choose. Stored credentials are
referenced by connection ID and remain in the encrypted Desktop vault; they are
not inserted into model prompts. Database access follows the selected policy,
and writes require the corresponding permission or approval.

Local-first does **not** mean an external provider receives nothing. When you
choose an external runtime, the prompt and context explicitly sent for that run
are processed under that provider's terms. Review the provider, project policy,
and selected context before using confidential data.

See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md) for the complete
boundary and reporting process.

## Repository map

```text
apps/
  daemon/          local API, agent runtimes, Git, DB and document services
  desktop/         Electron shell, encrypted vault and in-app browser
  web/             product UI
  monofield-site/  public website
packages/
  contracts/       shared API and prompt contracts
  components/      reusable UI primitives
plugins/           official and community workflows
tools/             development, packaging and release tooling
```

## Open source and attribution

MonoField is an independent derivative of the Apache-2.0 licensed
[Open Design](https://github.com/nexu-io/open-design) project. It is not
affiliated with, endorsed by, or maintained by that project.

Required upstream and third-party notices remain in [LICENSE](LICENSE),
[NOTICE](NOTICE), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Release
requirements are documented in
[docs/open-source-compliance.md](docs/open-source-compliance.md).

## If MonoField helps

If the project saved you a tool switch, made a change easier to verify, or gave
you a useful way to connect code with documents, please
[star MonoField on GitHub](https://github.com/jhy0285/monofield). It helps other
people find the project and gives the maintainers a clear signal to keep going.

MonoField가 실제 작업에 도움이 됐거나 방향이 마음에 들었다면
[GitHub Star](https://github.com/jhy0285/monofield)로 응원해 주세요. 더 많은
사람이 프로젝트를 발견하고 계속 개선하는 데 큰 힘이 됩니다.

---

<p align="center"><strong>One workspace, every kind of work</strong></p>
