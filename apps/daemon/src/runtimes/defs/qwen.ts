import { DEFAULT_MODEL_OPTION, isReadOnlyRun } from './shared.js';
import type { RuntimeAgentDef } from '../types.js';

export const qwenAgentDef = {
    id: 'qwen',
    name: 'Qwen Code',
    bin: 'qwen',
    versionArgs: ['--version'],
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'qwen3-coder-plus', label: 'qwen3-coder-plus' },
      { id: 'qwen3-coder-flash', label: 'qwen3-coder-flash' },
    ],
    // Prompt delivered via stdin (gated by `promptViaStdin: true`) to avoid Windows
    // `spawn ENAMETOOLONG` for large composed prompts. Qwen Code is a
    // Gemini-CLI fork and supports the same `--yolo` non-interactive mode.
    // Qwen Code reads from piped stdin when no positional prompt is supplied.
    // Current Qwen treats/rejects a bare `-` rather than needing it as a stdin sentinel.
    buildArgs: (_prompt, _imagePaths, _extra, options = {}, runtimeContext = {}) => {
      // `--approval-mode plan` is Qwen Code's analyze-only mode ("do not modify
      // files or execute commands"); a build without the flag exits with an
      // option error, which fails closed.
      const args = isReadOnlyRun(runtimeContext) ? ['--approval-mode', 'plan'] : ['--yolo'];
      if (options.model && options.model !== 'default') {
        args.push('--model', options.model);
      }
   
      return args;
    },
    readOnlySupport: true,
    promptViaStdin: true,
    streamFormat: 'plain',
} satisfies RuntimeAgentDef;
