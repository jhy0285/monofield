import { DEFAULT_MODEL_OPTION } from './shared.js';
import type { RuntimeAgentDef } from '../types.js';
import { agentCapabilities } from '../capabilities.js';

export const geminiAgentDef = {
    id: 'gemini',
    name: 'Gemini CLI',
    bin: 'gemini',
    versionArgs: ['--version'],
    versionProbeTimeoutMs: 20_000,
    helpArgs: ['--help'],
    capabilityFlags: {
      '--approval-mode': 'approvalMode',
    },
    // Session listing initializes Gemini's auth provider but does not make a
    // model request. It is therefore a cheap headless auth probe and returns
    // structured exit code 41 when no sign-in/API/Vertex method is configured.
    authProbe: {
      args: ['--list-sessions', '--output-format', 'json'],
      timeoutMs: 15_000,
    },
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      // `auto` is Google's recommended Gemini CLI selection mode. BYOK mode
      // discovers the account's current catalog through /v1beta/models; these
      // fallbacks keep local CLI setup useful before authentication succeeds.
      { id: 'auto', label: 'Auto' },
      { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
      { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
      { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
      { id: 'gemini-3-flash-preview', label: 'gemini-3-flash-preview' },
      { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro' },
      { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
      { id: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite' },
    ],
    // Gemini reads from stdin when `-p` is omitted and stdin is a pipe.
    // Passing the full composed prompt as a CLI arg causes ENAMETOOLONG on
    // Windows (CreateProcess limit ~32 KB) for any non-trivial prompt.
    // `--approval-mode=yolo` skips interactive prompts in the no-TTY UI.
    // Older Gemini CLI builds only accept the deprecated `--yolo`; the help
    // capability probe records that absence and selects the legacy flag.
    // Workspace trust is provided via `GEMINI_CLI_TRUST_WORKSPACE` below
    // instead of `--skip-trust`; several Gemini CLI builds hide or reject the
    // flag even though they accept the documented environment variable.
    env: { GEMINI_CLI_TRUST_WORKSPACE: 'true' },
    buildArgs: (_prompt, _imagePaths, extraAllowedDirs = [], options = {}, runtimeContext = {}) => {
      const caps = agentCapabilities.get('gemini') ?? {};
      const args = ['--output-format', 'stream-json'];
      if (caps.approvalMode === false) {
        args.push('--yolo');
      } else {
        args.push('--approval-mode=yolo');
      }
      if (options.model && options.model !== 'default') {
        args.push('--model', options.model);
      }
      for (const directory of extraAllowedDirs) {
        const trimmed = directory.trim();
        if (trimmed) args.push('--include-directories', trimmed);
      }
      const resumeSessionId = runtimeContext.resumeSessionId?.trim();
      const newSessionId = runtimeContext.newSessionId?.trim();
      if (resumeSessionId) {
        args.push('--resume', resumeSessionId);
      } else if (newSessionId) {
        args.push('--session-id', newSessionId);
      }
      return args;
    },
    promptViaStdin: true,
    streamFormat: 'json-event-stream',
    eventParser: 'gemini',
    // Gemini CLI 0.56+ persists project-scoped sessions and accepts both a
    // daemon-owned create id and UUID resume target. Let Gemini retain prior
    // turns so MonoField can send only the latest user turn on follow-ups.
    resumesSessionViaCli: true,
} satisfies RuntimeAgentDef;
