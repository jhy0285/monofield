import { DEFAULT_MODEL_OPTION, clampCodexReasoning } from './shared.js';
import type { RuntimeModelOption } from '../types.js';
import type { RuntimeAgentDef } from '../types.js';

export function parseCodexDebugModels(stdout: string): RuntimeModelOption[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(stdout || ''));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const models = (parsed as { models?: unknown }).models;
  if (!Array.isArray(models)) return null;

  const out = [DEFAULT_MODEL_OPTION];
  const seen = new Set<string>([DEFAULT_MODEL_OPTION.id]);
  for (const raw of models) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as {
      slug?: unknown;
      id?: unknown;
      display_name?: unknown;
      name?: unknown;
      visibility?: unknown;
    };
    if (entry.visibility === 'hidden') continue;
    const id =
      typeof entry.slug === 'string'
        ? entry.slug.trim()
        : typeof entry.id === 'string'
          ? entry.id.trim()
          : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label =
      typeof entry.display_name === 'string' && entry.display_name.trim()
        ? entry.display_name.trim()
        : typeof entry.name === 'string' && entry.name.trim()
          ? entry.name.trim()
          : id;
    out.push({ id, label });
  }
  return out.length > 1 ? out : null;
}

export function codexNeedsDangerFullAccessSandbox(
  _platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  // Fail closed on every platform. A working folder is a task root, not a
  // license to write anywhere on the machine. Older native Windows Codex
  // builds may reject shell commands in workspace-write mode; administrators
  // can explicitly opt into the compatibility mode below, but MonoField must
  // never silently broaden access merely because it runs on Windows or WSL.
  return env.OD_CODEX_SANDBOX?.trim() === 'danger-full-access';
}

export function codexShouldDisableExternalPlugins(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  // MonoField already supplies the selected skills/plugins in its compact
  // run prompt. Loading Codex's separate global plugin catalog duplicates
  // tens of thousands of prompt characters on every model call. Keep it off
  // by default; advanced users can explicitly opt back in.
  if (env.MONOFIELD_CODEX_ENABLE_EXTERNAL_PLUGINS?.trim() === '1') return false;
  if (env.OD_CODEX_DISABLE_PLUGINS?.trim() === '0') return false;
  return true;
}

export const codexAgentDef = {
    id: 'codex',
    name: 'Codex CLI',
    bin: 'codex',
    versionArgs: ['--version'],
    // The native Windows binary can take several seconds to cold-start while
    // security software inspects a newly installed release. Keep the version
    // visible instead of reporting an empty value after the generic 3s budget.
    versionProbeTimeoutMs: 10_000,
    // Codex exposes its installed model catalog through `debug models` on
    // recent CLIs. Older builds fall back to these static hints.
    listModels: {
      args: ['debug', 'models'],
      parse: parseCodexDebugModels,
      // Recent catalogs include full per-model instruction templates and can
      // be several hundred KB. A cold refresh can exceed 10s when all agents
      // are scanned concurrently, so give this background/manual metadata
      // probe enough time to return future models rather than falling back.
      timeoutMs: 30_000,
    },
    // Older installed Codex builds can return only the previous generation.
    // Keep the reviewed official recommendations below while also surfacing
    // future models discovered by `debug models` automatically.
    augmentLiveModelsWithFallbacks: true,
    authProbe: {
      args: ['login', 'status'],
      timeoutMs: 15_000,
    },
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
      { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
      { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
      { id: 'gpt-5.5', label: 'gpt-5.5' },
      { id: 'gpt-5.4', label: 'gpt-5.4' },
      { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
      { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
      { id: 'gpt-5.1', label: 'gpt-5.1' },
      { id: 'gpt-5.1-codex-mini', label: 'gpt-5.1-codex-mini' },
      { id: 'gpt-5-codex', label: 'gpt-5-codex' },
      { id: 'gpt-5', label: 'gpt-5' },
      { id: 'o3', label: 'o3' },
      { id: 'o4-mini', label: 'o4-mini' },
    ],
    reasoningOptions: [
      { id: 'default', label: 'Default' },
      { id: 'none', label: 'None' },
      { id: 'minimal', label: 'Minimal' },
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
      { id: 'xhigh', label: 'XHigh' },
      { id: 'max', label: 'Max' },
      { id: 'ultra', label: 'Ultra' },
    ],
    // Prompt is delivered via stdin pipe (gated by `promptViaStdin: true`
    // below) to avoid Windows `spawn ENAMETOOLONG` while keeping Codex on
    // its structured JSON stream. Recent Codex CLI versions reject a bare
    // `-` argv sentinel — passing both the pipe and `-` produces
    // `error: unexpected argument '-' found` and the agent exits with
    // code 2 before any prompt is read (see issue #237). The pipe alone
    // is sufficient for stdin delivery.
    buildArgs: (
      _prompt,
      _imagePaths,
      extraAllowedDirs = [],
      options = {},
      runtimeContext = {},
    ) => {
      const resumeSessionId = runtimeContext.resumeSessionId?.trim() || null;
      // Workspace-write is the secure default on every platform. The only
      // escape hatch is the explicit administrator-controlled
      // OD_CODEX_SANDBOX=danger-full-access compatibility setting above.
      const needsDangerFullAccess = codexNeedsDangerFullAccessSandbox();
      const args = resumeSessionId
        ? [
            'exec',
            'resume',
            '--json',
            '--skip-git-repo-check',
            ...(needsDangerFullAccess
              ? ['--dangerously-bypass-approvals-and-sandbox']
              : [
                  '-c',
                  'sandbox_mode="workspace-write"',
                  '-c',
                  'sandbox_workspace_write.network_access=true',
                ]),
          ]
        : needsDangerFullAccess
          ? ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'danger-full-access']
          : [
            'exec',
            '--json',
            '--skip-git-repo-check',
            '--sandbox',
            'workspace-write',
            '-c',
            'sandbox_workspace_write.network_access=true',
          ];
      const dirs = (extraAllowedDirs || []).filter(
        (d) => typeof d === 'string' && d.length > 0,
      );
      if (
        process.platform === 'win32' &&
        !needsDangerFullAccess &&
        runtimeContext.cwd?.trim()
      ) {
        // Windows workspace-write tools run as CodexSandboxOnline, while the
        // selected repository is normally owned by the desktop user. Git
        // rejects that ownership mismatch before even read-only commands.
        // Codex filters raw GIT_CONFIG_* variables from its tool environment,
        // so pass the exact selected cwd through its supported shell policy.
        // This affects only this Codex child; no global Git config is changed.
        const safeDirectories = Array.from(
          new Set(
            [runtimeContext.cwd, ...dirs]
              .map((directory) => directory.trim().replace(/\\/g, '/'))
              .filter(Boolean),
          ),
        );
        args.push(
          '-c',
          `shell_environment_policy.set.GIT_CONFIG_COUNT="${safeDirectories.length}"`,
        );
        safeDirectories.forEach((safeDirectory, index) => {
          args.push(
            '-c',
            `shell_environment_policy.set.GIT_CONFIG_KEY_${index}="safe.directory"`,
            '-c',
            `shell_environment_policy.set.GIT_CONFIG_VALUE_${index}=${JSON.stringify(safeDirectory)}`,
          );
        });
      }
      if (codexShouldDisableExternalPlugins()) {
        args.push('--disable', 'plugins');
      }
      if (runtimeContext.disableTools === true) {
        // `text_artifact` recovery is a host-owned transport, not a second
        // filesystem attempt. Disable both Codex shell implementations so a
        // model-emitted tool call cannot reach CreateProcessWithLogonW again.
        args.push(
          '--disable',
          'shell_tool',
          '--disable',
          'unified_exec',
          '-c',
          'mcp_servers={}',
        );
      }
      if (runtimeContext.ignoreProjectInstructions === true) {
        args.push('-c', 'project_doc_max_bytes=0');
      }
      if (!resumeSessionId && runtimeContext.cwd) {
        args.push('-C', runtimeContext.cwd);
      }
      for (const d of resumeSessionId ? [] : dirs) {
        args.push('--add-dir', d);
      }
      if (options.model && options.model !== 'default') {
        args.push('--model', options.model);
      }
      if (options.reasoning && options.reasoning !== 'default') {
        const effort = clampCodexReasoning(options.model, options.reasoning);
        // Codex accepts `-c key=value` config overrides; reasoning effort
        // is exposed as `model_reasoning_effort`.
        args.push('-c', `model_reasoning_effort="${effort}"`);
      }
      if (resumeSessionId) args.push(resumeSessionId);
      return args;
    },
    promptViaStdin: true,
    streamFormat: 'json-event-stream',
    eventParser: 'codex',
    resumesSessionViaCli: true,
    sessionIdFromStream: true,
} satisfies RuntimeAgentDef;
