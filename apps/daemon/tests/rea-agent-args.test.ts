import { describe, expect, it } from 'vitest';
import { claudeAgentDef } from '../src/runtimes/defs/claude.js';
import { codexAgentDef } from '../src/runtimes/defs/codex.js';

// The built-in REA reaches CLIs that only take MCP servers on their command line.
const rea = { command: 'C:\\Program Files\\MonoField\\MonoField.exe', args: ['C:\\Program Files\\MonoField\\resources\\app\\node_modules\\rea-agents\\scripts\\rea.mjs', '--mcp'], env: { ELECTRON_RUN_AS_NODE: '1' } };

describe('the built-in REA on agent command lines', () => {
  it('reaches Codex as config overrides whose values are valid TOML (Windows paths escaped)', () => {
    const args = codexAgentDef.buildArgs('prompt', [], [], {}, { reaMcpServer: rea });
    const overrides = args.flatMap((arg, index) => (args[index - 1] === '-c' ? [arg] : []));
    expect(overrides).toContain('mcp_servers.rea.command="C:\\\\Program Files\\\\MonoField\\\\MonoField.exe"');
    expect(overrides).toContain('mcp_servers.rea.args=["C:\\\\Program Files\\\\MonoField\\\\resources\\\\app\\\\node_modules\\\\rea-agents\\\\scripts\\\\rea.mjs","--mcp"]');
    expect(overrides).toContain('mcp_servers.rea.env.ELECTRON_RUN_AS_NODE="1"');
  });

  it('leaves Codex alone without REA, and on the tool-less recovery run', () => {
    expect(codexAgentDef.buildArgs('prompt', [], [], {}, {}).some((arg) => arg.startsWith('mcp_servers.rea'))).toBe(false);
    const recovery = codexAgentDef.buildArgs('prompt', [], [], {}, { reaMcpServer: rea, disableTools: true });
    expect(recovery.some((arg) => arg.startsWith('mcp_servers.rea'))).toBe(false);
    expect(recovery).toContain('mcp_servers={}');
  });

  it('skips environment names that are not plain TOML keys', () => {
    const args = codexAgentDef.buildArgs('prompt', [], [], {}, { reaMcpServer: { ...rea, env: { 'BAD KEY': 'x', JAVA_HOME: '/opt/jdk' } } });
    expect(args).toContain('mcp_servers.rea.env.JAVA_HOME="/opt/jdk"');
    expect(args.some((arg) => arg.includes('BAD KEY'))).toBe(false);
  });

  it('reaches Claude Code as an extra --mcp-config outside managed projects', () => {
    const args = claudeAgentDef.buildArgs('prompt', [], [], {}, { reaMcpServer: rea });
    const config = JSON.parse(args[args.indexOf('--mcp-config') + 1]!);
    expect(config).toEqual({ mcpServers: { rea: { type: 'stdio', command: rea.command, args: rea.args, env: { ELECTRON_RUN_AS_NODE: '1' } } } });
    expect(args).not.toContain('--strict-mcp-config');
    expect(claudeAgentDef.buildArgs('prompt', [], [], {}, {})).not.toContain('--mcp-config');
  });
});
