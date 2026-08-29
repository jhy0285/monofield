import { DEFAULT_MODEL_OPTION } from './shared.js';
import type { RuntimeAgentDef } from '../types.js';

const COPILOT_MODEL_ID = /\b(?:claude|gemini|gpt|kimi|mai|raptor)-[a-z0-9][a-z0-9._:-]*\b/gi;

/**
 * Copilot CLI does not expose a non-interactive `models` command, but its
 * current `copilot help` output documents the values accepted by `--model`.
 * Extract only provider-shaped ids so flags, prose, and examples never leak
 * into the picker. An empty result lets detection fall back to the reviewed
 * list below on older CLI builds.
 */
export function parseCopilotHelpModels(stdout: string) {
  const text = String(stdout || '');
  const ids = Array.from(text.matchAll(COPILOT_MODEL_ID), (match) => match[0].toLowerCase());
  if (ids.length === 0) return null;

  const seen = new Set<string>();
  const models = [DEFAULT_MODEL_OPTION, { id: 'auto', label: 'Auto' }];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    models.push({ id, label: id });
  }
  return models;
}

export const copilotAgentDef = {
    id: 'copilot',
    name: 'GitHub Copilot CLI',
    bin: 'copilot',
    versionArgs: ['--version'],
    // Prompt is delivered via stdin (gated by `promptViaStdin: true`
    // below) to avoid Windows `spawn ENAMETOOLONG` (issue #705):
    // `copilot -p <body>` ships the full composed prompt as a single
    // argv entry, and CreateProcess caps `lpCommandLine` at ~32 KB
    // direct or ~8 KB through a `.cmd` shim. Any non-trivial Open
    // Design prompt blows past that — even a "Hi" expands to several
    // thousand chars after skills + design-system context are composed
    // in.
    //
    // The transport is "omit `-p` entirely, pipe the prompt to stdin"
    // per upstream copilot-cli issue #1046 (closed as already supported,
    // confirmed working on Copilot CLI for `echo "..." | copilot
    // --model <id>` and `cat prompt.txt | copilot --model <id>`). The
    // earlier `-p -` attempt (PR #351) and the argv-bound revert
    // (PR #466) both pre-dated that confirmation: `-p -` made Copilot
    // interpret `-` as a literal one-character prompt, but omitting
    // `-p` entirely is a separate code path that does delegate to
    // stdin under a non-TTY pipe — which is exactly how the daemon
    // spawns the child (`stdio: ['pipe', 'pipe', 'pipe']`).
    //
    // `--allow-all-tools` is still required for non-interactive runs:
    // without it the CLI blocks waiting for human approval on every
    // tool call. Unlike Codex (where `exec` is a dedicated headless
    // subcommand with auto-approve baked in) or Claude Code (which
    // inherits its permission policy from the user's settings.json),
    // Copilot always prompts unless this flag is passed explicitly.
    //
    // `--output-format json` produces JSONL that copilot-stream.js
    // parses into the same typed events as claude-stream.js.
    //
    // `--add-dir` (repeatable, same flag as Claude Code's) widens
    // Copilot's path-level sandbox to skill seeds + design-system
    // specs outside the project cwd.
    //
    // `copilot help` includes the models accepted by --model. Read that live
    // catalog so a CLI update can surface newer ids without a MonoField
    // release, while retaining reviewed fallbacks for older installations.
    listModels: {
      args: ['help'],
      parse: parseCopilotHelpModels,
      timeoutMs: 15_000,
    },
    augmentLiveModelsWithFallbacks: true,
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'auto', label: 'Auto' },
      { id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
      { id: 'gpt-5.4', label: 'GPT-5.4' },
      { id: 'claude-haiku-4.5', label: 'Claude Haiku 4.5' },
      { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
      { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
      { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
      { id: 'mai-code-1-flash', label: 'MAI Code 1 Flash' },
    ],
    buildArgs: (
      _prompt,
      _imagePaths,
      extraAllowedDirs = [],
      options = {},
      runtimeContext = {},
    ) => {
      const args = [
        '--allow-all-tools',
        // Programmatic runs have no interactive field for Copilot's native
        // ask_user tool. Disable it so a headless child cannot wait forever;
        // MonoField clarifications use the rendered <question-form> contract.
        '--no-ask-user',
        '--output-format',
        'json',
      ];
      if (options.model && options.model !== 'default') {
        args.push('--model', options.model);
      }
      const dirs = (extraAllowedDirs || []).filter(
        (d) => typeof d === 'string' && d.length > 0,
      );
      for (const d of dirs) args.push('--add-dir', d);
      const resumeSessionId = runtimeContext.resumeSessionId?.trim();
      const newSessionId = runtimeContext.newSessionId?.trim();
      if (resumeSessionId) {
        // `--resume=<id>` fails clearly for a missing previous session. Do
        // not use `--session-id` here: current Copilot creates a new session
        // for a missing valid UUID, which would silently lose prior context.
        args.push(`--resume=${resumeSessionId}`);
      } else if (newSessionId) {
        // A valid UUID that does not exist creates a deterministic new
        // session, allowing the daemon to persist it without scraping prose.
        args.push('--session-id', newSessionId);
      }
      return args;
    },
    promptViaStdin: true,
    streamFormat: 'copilot-stream-json',
    resumesSessionViaCli: true,
    // GitHub Copilot's deck-generation and large-prompt turns go silent
    // (no stdout, no streamed events) for stretches that exceed the
    // 10-minute global default — the model is still working but the
    // CLI does not emit keepalive frames. The default watchdog used to
    // kill those runs as `stalled` even though the agent was healthy
    // (issue #2467: "GitHub Copilot agent getting stuck after 10 mins
    // and few seconds"). 30 minutes gives the heavy turns room to land
    // while still bounding genuine hangs; operators can override via
    // `OD_CHAT_RUN_INACTIVITY_TIMEOUT_MS` if they want it tighter.
    inactivityTimeoutMs: 30 * 60 * 1000,
} satisfies RuntimeAgentDef;
