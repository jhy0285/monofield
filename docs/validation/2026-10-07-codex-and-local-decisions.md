# Native development and local decisions — 2026-10-07

This is a small observed workflow, not a general benchmark. The production web
build and native Linux Electron app were used with actual pointer/keyboard
input. Codex CLI 0.159.0-alpha.3 ran `gpt-6.1-sol`, low reasoning, workspace-write
sandbox and disabled external plugins. Both lanes started from the same Git
baseline of a dependency-free Node 24/SQLite Support Desk. Each feature used a
new CLI session or MonoField conversation; each lane evolved independently.

The three requests added status filtering, CSV export and ticket creation.
Independent HTTP, Python `csv`, SQLite restart and Chromium interaction checks
passed **21/21 in each lane**. These are separate from agent-written tests.

| Task | Entry | Observed seconds | Input | Cached input | Output |
| --- | --- | ---: | ---: | ---: | ---: |
| Filter | Direct Codex | 74.5 | 117,474 | 106,624 | 3,299 |
| Filter | MonoField, after plugin fix | 83.2 | 134,364 | 111,616 | 2,547 |
| CSV | Direct Codex | 58.4 | 119,777 | 103,552 | 1,927 |
| CSV | MonoField, after plugin fix | 60.9 | 115,722 | 96,768 | 1,618 |
| Create | Direct Codex | 74.5 | 126,328 | 113,280 | 2,939 |
| Create | MonoField, after plugin fix | 102.0 | 148,732 | 135,040 | 3,287 |

CLI timing includes launch and inference. UI timing additionally includes
native focus/type/send and polling. MonoField's corresponding agent-run times
were 74.6, 52.8 and 93.2 seconds. All token values are provider-reported aggregates
across the agent's tool loop; a cache hit does not mean zero input tokens. One
sample per task cannot establish a speed or cost advantage. Claude was installed
but unauthenticated and was not included in the actual comparison.

## Defects found and fixed

- Development projects could inherit an automatic document/prototype plugin.
  Development metadata now prevents this fallback; explicit selections remain.
- The automatically focused Docs Files root duplicated the directory already
  supplied through native Codex cwd. Only that exact redundant root is omitted;
  file, subfolder, browser and terminal targets remain.
- New conversations reset a coding chat to document mode. They now preserve the
  active conversation mode.
- Long lines expanded the side-by-side diff so its After column was off screen.
  Both columns now fit ordinary workspace widths and wrap long code lines.

After the second prompt fix, an actual repeat of the filter task from the same
original Git baseline reported **0 added prompt characters**, input 133,479,
cached input 123,008 and output 2,781. It completed in 82.4 seconds including UI
input/polling, and its three meaningful tests passed. Aggregate tool-loop token
counts still vary with the model's actions.

A fresh, identical-folder `Reply exactly READY` calibration then reported the
same **17,077 input / 12,160 cached input / 5 output** in both paths, with 0 added
MonoField prompt characters. Both answers were exactly `READY`. Timing was 3.5
seconds for direct CLI and 9.0 seconds for UI focus/type/send/poll; these are
not identical timer boundaries.

## Real UI and recovery checks

Native Run started the actual Node/SQLite project and opened its in-app browser.
The page's product consent and system confirmation were exercised. The browser
CLI read the real tab, filled a title with the permitted pointer/DOM input path,
clicked Create with the native pointer, and a closed filter was visually checked
in the captured page. Independent browser assertions covered the full workflow.

The owned project process group was verified by PID, cwd and process-group ID,
then terminated with SIGKILL. MonoField showed `failed`; an actual Run click
returned it to `ready`, preserving the ticket in SQLite. Daemon/web restarts for
new builds also retained the project and local model configuration.

The app remained open for approximately five hours. Much of the early period
was idle, rather than continuous development. Idle app-process PSS was roughly
621–682 MiB, median 673 MiB, excluding the separate model server. Eight native
Projects/Integrations round trips retained the result state. This does not prove
multi-day reliability or the absence of leaks.

## JEV and the genuinely local alternative

The supplied [TypeSafe introduction](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
links early access and a public adapter. The official MIT SDK and adapter are
public; no official JEV weights or self-hosted server were found in the checked
public sources. The real hosted models request returned 403 without an API key.
Hosted inference quality was therefore not verified or substituted.

A separate Apache-2.0 model, **Laya 0.3.28 multilingual**, was installed and run on
CPU with two threads and its reviewed bundled checkpoint revision
`55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851`. Through the actual MonoField API, request
type classification matched the fixed labels in **16/16** Korean/English examples;
median provider call time was 574 ms. Risk and clarification probabilities were
not assigned gold labels, and this small set is not a general accuracy estimate.

Native UI connection testing and an actual decision succeeded with no TypeSafe
key. One captured request reported 469 ms and 181 input / 0 output tokens; these
are the local provider's actual counters. Stopping the real model server caused
a connection error. Restarting it and retrying in the UI restored a decision
(507 ms). The resident Python/model process used about 1.8 GiB PSS, separately
from MonoField. The model and PyTorch are not bundled or started automatically.

See [JEV and local decisions](../jev-decisions.md) for installation, HTTP/CLI
surfaces, typed answers, encrypted key storage and protocol limits. These source
changes do not alter the already published v0.11.6 Windows installer; a subsequent
Windows build/release is required to distribute them there.

## Repository validation

Focused daemon tests (42), web tests (20), contracts scenario tests (7), full
workspace typechecking, production web/daemon builds and repository guards
passed. Protocol fixtures verify error/schema behavior and are not counted as
live model calls. Input-automation readiness failures were corrected and excluded
from successful workflow claims.
