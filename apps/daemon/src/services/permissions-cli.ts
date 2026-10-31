import {
  EXECUTION_PERMISSION_LEVELS,
  executionPermissionsNeedRestart,
  isExecutionPermissionLevel,
  type ExecutionPermissionsResponse,
} from '@open-design/contracts';

const USAGE = `Usage:
  monofield permissions [show]               Print the execution permission level.
  monofield permissions set <level>          Set it: ${EXECUTION_PERMISSION_LEVELS.join(' | ')}.

Levels:
  read-only   Codex reads only (no network); Claude Code, Qwen Code and CodeBuddy plan without
              editing; Gemini CLI uses plan mode; Copilot denies the shell and file writes.
              Other agents are not started at this level.
  default     Codex writes inside the working folder with network; Claude Code runs every tool.
  full        Codex runs without a sandbox; Claude Code runs every tool; on Windows
              MonoField starts with administrator rights (UAC asks at every launch).

Runs started after a change use the new level. On Windows, a change of
administrator rights applies when MonoField Desktop restarts.

Options:
  --daemon-url <url>   MonoField daemon HTTP base.
  --json               Emit JSON (adds "restartRequired").`;

export interface PermissionsCliHelpers {
  baseUrl: (flags: Record<string, unknown>) => Promise<string>;
  parseFlags: (args: string[], options: { string: Set<string>; boolean: Set<string> }) => Record<string, unknown>;
  positionalArgs: (args: string[], stringFlags: Set<string>) => string[];
  fetch?: typeof fetch;
  write?: (text: string) => void;
}

export type PermissionsCliOutput = ExecutionPermissionsResponse & { restartRequired: boolean };

function startAsAdministrator(output: PermissionsCliOutput): string {
  if (output.platform !== 'win32') return 'n/a (Windows only)';
  if (!output.effective.startElevated) return 'no';
  return output.canElevate === false
    ? 'requested, but this Windows account is not an administrator, so MonoField will not restart as administrator'
    : 'yes';
}

function describe(output: PermissionsCliOutput): string {
  const { effective } = output;
  const elevated = output.elevated == null ? 'n/a' : output.elevated ? 'yes' : 'no';
  const lines = [
    `Execution permission level: ${output.level}`,
    `  Codex sandbox:          ${effective.codexSandbox}${effective.codexNetwork ? ' (network on)' : ' (network off)'}${output.codexSandboxLockedByEnv ? ' [locked by OD_CODEX_SANDBOX]' : ''}`,
    `  Claude Code mode:       ${effective.claudePermissionMode}`,
    `  Start as administrator: ${startAsAdministrator(output)}`,
    `  Running elevated:       ${elevated}`,
  ];

  if (output.restartRequired) {
    lines.push(effective.startElevated
      ? '  Restart MonoField Desktop to start it with administrator rights.'
      : '  Close and reopen MonoField Desktop to drop administrator rights.');
  }
  return `${lines.join('\n')}\n`;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string | { message?: string } };
    if (typeof body.error === 'string') return body.error;
    if (body.error?.message) return body.error.message;
  } catch {
    // fall through to the status line
  }
  return `HTTP ${response.status}`;
}

export async function runPermissionsCli(args: string[], helpers: PermissionsCliHelpers): Promise<void> {
  const strings = new Set(['daemon-url']);
  const flags = helpers.parseFlags(args, { string: strings, boolean: new Set(['json', 'help', 'h']) });
  const [command = 'show', level] = helpers.positionalArgs(args, strings);
  const write = helpers.write ?? ((text: string) => process.stdout.write(text));
  if (flags.help || flags.h || command === 'help') {
    write(`${USAGE}\n`);
    return;
  }
  if (command !== 'show' && command !== 'set') {
    throw new Error(`unknown subcommand: monofield permissions ${command}\n${USAGE}`);
  }
  if (command === 'set' && !isExecutionPermissionLevel(level)) {
    throw new Error(`monofield permissions set needs one of: ${EXECUTION_PERMISSION_LEVELS.join(', ')}`);
  }
  const doFetch = helpers.fetch ?? fetch;
  const base = (await helpers.baseUrl(flags)).replace(/\/$/, '');
  const response = await doFetch(`${base}/api/execution-permissions`, command === 'set'
    ? { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level }) }
    : {});
  if (!response.ok) throw new Error(`execution permissions request failed: ${await readError(response)}`);
  const body = await response.json() as ExecutionPermissionsResponse;
  const output: PermissionsCliOutput = { ...body, restartRequired: executionPermissionsNeedRestart(body) };
  write(flags.json ? `${JSON.stringify(output, null, 2)}\n` : describe(output));
}
