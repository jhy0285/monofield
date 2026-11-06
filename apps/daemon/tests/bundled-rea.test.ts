import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REA_PACKAGE } from '@open-design/contracts';
import { MCP_TEMPLATES, buildAcpMcpServers, buildClaudeMcpJson, type McpServerConfig } from '../src/mcp-config.js';
import {
  defaultBundledReaProbe,
  isPinnedNpxRea,
  locateBundledRea,
  withBundledRea,
  type BundledReaProbe,
} from '../src/services/bundled-rea.js';

const probe = (over: Partial<BundledReaProbe> = {}): BundledReaProbe => ({
  packageJson: () => '/app/node_modules/rea-agents/package.json',
  readJson: () => ({ version: REA_PACKAGE.version }),
  exists: (file) => file === path.join('/app/node_modules/rea-agents', 'scripts', 'rea.mjs'),
  execPath: '/usr/local/bin/node',
  nodeVersion: '24.11.1',
  electron: false,
  ...over,
});
const pinned: McpServerConfig = { id: 'rea', templateId: 'rea', transport: 'stdio', enabled: true, command: 'npx', args: ['-y', 'rea-agents@6.7.0', '--mcp'] };

describe('the REA copy that ships with MonoField', () => {
  it('is the pinned dependency the daemon installs, the release the template and contracts name', () => {
    const daemonPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> };
    expect(daemonPackage.dependencies['rea-agents']).toBe(REA_PACKAGE.version);
    expect(MCP_TEMPLATES.find((template) => template.id === 'rea')?.args).toEqual(['-y', `rea-agents@${REA_PACKAGE.version}`, '--mcp']);
    const lookup = locateBundledRea(defaultBundledReaProbe());
    expect(lookup).toMatchObject({ available: true, runtime: { version: REA_PACKAGE.version, command: process.execPath } });
    if (lookup.available) expect(lookup.runtime.entry.replace(/\\/g, '/')).toMatch(/\/rea-agents\/scripts\/rea\.mjs$/);
  });

  it('runs on MonoField\'s own runtime, telling Electron to act as Node.js in the packaged app', () => {
    expect(locateBundledRea(probe())).toEqual({ available: true, runtime: {
      entry: path.join('/app/node_modules/rea-agents', 'scripts', 'rea.mjs'), version: '6.7.0', command: '/usr/local/bin/node', env: {}, nodeVersion: '24.11.1' } });
    expect(locateBundledRea(probe({ electron: true, execPath: '/Applications/MonoField.app/Contents/MacOS/MonoField' })))
      .toMatchObject({ available: true, runtime: { command: '/Applications/MonoField.app/Contents/MacOS/MonoField', env: { ELECTRON_RUN_AS_NODE: '1' } } });
  });

  it('is not used when missing, another release, or on a Node.js REA does not support', () => {
    expect(locateBundledRea(probe({ packageJson: () => null }))).toEqual({ available: false, reason: 'not-installed', found: null });
    expect(locateBundledRea(probe({ exists: () => false }))).toEqual({ available: false, reason: 'not-installed', found: null });
    expect(locateBundledRea(probe({ readJson: () => ({ version: '6.8.0' }) }))).toEqual({ available: false, reason: 'other-version', found: '6.8.0' });
    expect(locateBundledRea(probe({ nodeVersion: '22.12.0' }))).toEqual({ available: false, reason: 'outside-range', found: '22.12.0' });
  });

  it('replaces only the pinned npx command', () => {
    expect(isPinnedNpxRea(pinned)).toBe(true);
    expect(isPinnedNpxRea({ ...pinned, command: 'C:\\Program Files\\nodejs\\npx.cmd' })).toBe(true);
    expect(isPinnedNpxRea({ ...pinned, args: ['rea-agents@6.7.0', '--mcp'] })).toBe(true);
    expect(isPinnedNpxRea({ ...pinned, args: ['-y', 'rea-agents@6.4.0', '--mcp'] })).toBe(false);
    expect(isPinnedNpxRea({ ...pinned, args: ['-y', 'rea-agents@6.7.0', '--mcp', '--verbose'] })).toBe(false);
    expect(isPinnedNpxRea({ ...pinned, command: 'node', args: ['C:\\rea-yj\\scripts\\rea.mjs', '--mcp'] })).toBe(false);
    expect(isPinnedNpxRea({ ...pinned, transport: 'http', command: undefined })).toBe(false);
  });

  it('points a conversation\'s pinned REA entry at the copy, keeps its environment, and leaves everything else alone', () => {
    const lookup = locateBundledRea(probe({ electron: true, execPath: 'C:\\MonoField\\MonoField.exe' }));
    const other: McpServerConfig = { id: 'github', transport: 'stdio', enabled: true, command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] };
    const withFolders = { ...pinned, env: { GHIDRA_INSTALL_DIR: 'C:\\ghidra', ELECTRON_RUN_AS_NODE: '0' } };
    const [rea, github] = withBundledRea([withFolders, other], lookup);
    expect(rea).toEqual({ ...pinned, command: 'C:\\MonoField\\MonoField.exe',
      args: [path.join('/app/node_modules/rea-agents', 'scripts', 'rea.mjs'), '--mcp'],
      env: { GHIDRA_INSTALL_DIR: 'C:\\ghidra', ELECTRON_RUN_AS_NODE: '1' } });
    expect(github).toBe(other);
    const unavailable = withBundledRea([pinned, other], { available: false, reason: 'not-installed', found: null });
    expect(unavailable[0]).toBe(pinned);
  });

  it('reaches the agent configs: Claude Code and ACP agents start the copy, not npx', () => {
    const servers = withBundledRea([pinned], locateBundledRea(probe()));
    const entry = path.join('/app/node_modules/rea-agents', 'scripts', 'rea.mjs');
    expect(buildClaudeMcpJson(servers)).toMatchObject({ mcpServers: { rea: { command: '/usr/local/bin/node', args: [entry, '--mcp'] } } });
    expect(buildAcpMcpServers(servers)).toContainEqual(expect.objectContaining({ name: 'rea', command: '/usr/local/bin/node', args: [entry, '--mcp'] }));
  });
});
