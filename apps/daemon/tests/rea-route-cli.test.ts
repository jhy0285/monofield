import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type StartServerResult } from '../src/server.js';
import { MCP_MASKED_SECRET as CONTRACT_MASK } from '@open-design/contracts';
import { buildAcpMcpServers, buildClaudeMcpJson, MCP_MASKED_SECRET, MCP_TEMPLATES, type McpServerConfig } from '../src/mcp-config.js';
import { applyReaFolderEdits, reaFolderEdits } from '../src/services/rea-cli.js';
import { installTestCredentialVault, type TestCredentialVault } from './helpers/credential-vault.js';

const execute = promisify(execFile);
describe('REA configuration through the public MCP API and CLI', () => {
  let server: StartServerResult;
  let vault: TestCredentialVault;
  const cli = (command: string, ...extra: string[]) => execute(process.execPath, [resolve('dist/cli.js'), 'rea', command, '--json', '--daemon-url', server.url, ...extra]);
  beforeAll(async () => {
    server = await startServer({ port: 0, returnServer: true }) as StartServerResult;
    vault = installTestCredentialVault();
  }, 30_000);
  afterAll(async () => {
    try { await server?.shutdown(); server?.server.closeAllConnections?.(); }
    finally { vault?.restore(); }
  });
  const put = (servers: unknown[]) => fetch(`${server.url}/api/mcp/servers`, {method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({servers})});
  it('preserves unrelated encrypted server credentials, enables once, exports to agent transports and disables without claiming a live connection', async () => {
    expect((await put([{id:'other',transport:'stdio',command:'other-mcp',enabled:false,env:{API_KEY:'preserve-this-test-key'}}])).ok).toBe(true);
    const before = JSON.parse((await cli('status')).stdout);
    expect(before).toMatchObject({configured:false,enabled:false,availability:'not-probed'});
    const configured = JSON.parse((await cli('configure')).stdout);
    expect(configured).toMatchObject({configured:true,enabled:true,availability:'not-probed',server:{command:'npx',args:['-y','rea-agents@6.7.0','--mcp']}});
    await cli('configure');
    const settings = await (await fetch(`${server.url}/api/mcp/servers`)).json() as {servers: McpServerConfig[]};
    expect(settings.servers.filter(s=>s.id==='rea')).toHaveLength(1);
    expect(settings.servers.find(s=>s.id==='other')).toMatchObject({enabled:false});
    expect([...vault.values.values()].some(value=>value.includes('preserve-this-test-key'))).toBe(true);
    expect(buildClaudeMcpJson(settings.servers)).toMatchObject({mcpServers:{rea:{command:'npx',args:['-y','rea-agents@6.7.0','--mcp']}}});
    expect(buildAcpMcpServers(settings.servers)).toContainEqual(expect.objectContaining({name:'rea',command:'npx',args:['-y','rea-agents@6.7.0','--mcp']}));
    expect(JSON.parse((await cli('disable')).stdout)).toMatchObject({configured:true,enabled:false});
    const disabled = await (await fetch(`${server.url}/api/mcp/servers`)).json() as {servers:McpServerConfig[]};
    expect(buildAcpMcpServers(disabled.servers)).toEqual([]);
  });
  it('saves the Ghidra and Java folders from the command line, keeps them encrypted, and removes them again', async () => {
    expect((await put([{id:'other',transport:'stdio',command:'other-mcp',enabled:true,env:{API_KEY:'keep-this-too'}}])).ok).toBe(true);
    const ghidra = process.platform === 'win32' ? 'C:\\Tools\\ghidra' : '/opt/ghidra-test';
    const first = JSON.parse((await cli('configure', '--ghidra-dir', ghidra)).stdout);
    expect(first).toMatchObject({configured:true,enabled:true,folders:{GHIDRA_INSTALL_DIR:true,JAVA_HOME:false}});
    expect(JSON.stringify(first)).not.toContain(ghidra);
    const second = JSON.parse((await cli('configure', '--java-home', '/opt/jdk-test')).stdout);
    expect(second.folders).toEqual({GHIDRA_INSTALL_DIR:true,JAVA_HOME:true});
    expect([...vault.values.values()].some(value=>value.includes(ghidra) && value.includes('/opt/jdk-test'))).toBe(true);
    const listed = await (await fetch(`${server.url}/api/mcp/servers`)).json() as {servers: McpServerConfig[]};
    expect(listed.servers.find(s=>s.id==='rea')?.env).toEqual({GHIDRA_INSTALL_DIR:MCP_MASKED_SECRET,JAVA_HOME:MCP_MASKED_SECRET});
    expect([...vault.values.values()].some(value=>value.includes('keep-this-too'))).toBe(true);
    const status = JSON.parse((await cli('status')).stdout);
    expect(status.folders).toEqual({GHIDRA_INSTALL_DIR:true,JAVA_HOME:true});
    const cleared = JSON.parse((await cli('configure', '--clear-ghidra-dir')).stdout);
    expect(cleared.folders).toEqual({GHIDRA_INSTALL_DIR:false,JAVA_HOME:true});
    const last = JSON.parse((await cli('configure', '--clear-java-home')).stdout);
    expect(last.folders).toEqual({GHIDRA_INSTALL_DIR:false,JAVA_HOME:false});
    expect(last.configured).toBe(true);
  });
  it('rejects folder flags that REA would refuse, and keeps them out of status and disable', async () => {
    await put([]);
    await expect(cli('configure', '--ghidra-dir', 'tools/ghidra')).rejects.toThrow(/full path/);
    await expect(cli('configure', '--java-home', '')).rejects.toThrow();
    await expect(cli('configure', '--ghidra-dir', '/opt/g', '--clear-ghidra-dir')).rejects.toThrow(/either/);
    await expect(cli('disable', '--ghidra-dir', '/opt/g')).rejects.toThrow(/configure/);
    const current = await (await fetch(`${server.url}/api/mcp/servers`)).json() as {servers: McpServerConfig[]};
    expect(current.servers.find(s=>s.id==='rea')).toBeUndefined();
  });
  it('offers the two folders on the REA template, and the daemon and contracts agree on the mask', () => {
    const template = MCP_TEMPLATES.find(t=>t.id==='rea');
    expect(template?.envFields?.map(f=>[f.key,f.folder])).toEqual([['GHIDRA_INSTALL_DIR',true],['JAVA_HOME',true]]);
    expect(MCP_MASKED_SECRET).toBe(CONTRACT_MASK);
  });
  it('turns folder flags into env edits: set, clear, and leave other entries alone', () => {
    expect(reaFolderEdits({})).toEqual([]);
    expect(reaFolderEdits({'ghidra-dir':' /opt/g ','clear-java-home':true})).toEqual([{key:'GHIDRA_INSTALL_DIR',value:'/opt/g'},{key:'JAVA_HOME',value:null}]);
    expect(() => reaFolderEdits({'java-home':'jdk'})).toThrow(/full path/);
    expect(applyReaFolderEdits({API_KEY:'x'}, [])).toEqual({API_KEY:'x'});
    expect(applyReaFolderEdits(undefined, [])).toBeUndefined();
    expect(applyReaFolderEdits({API_KEY:'x'}, [{key:'JAVA_HOME',value:'/jdk'}])).toEqual({API_KEY:'x',JAVA_HOME:'/jdk'});
    expect(applyReaFolderEdits({JAVA_HOME:MCP_MASKED_SECRET}, [{key:'JAVA_HOME',value:null}])).toBeUndefined();
  });
  it('refuses to overwrite a custom server with the same ID', async () => {
    await put([{id:'rea',transport:'stdio',command:'my-reviewed-rea',enabled:true}]);
    await expect(cli('configure')).rejects.toThrow();
    const current = await (await fetch(`${server.url}/api/mcp/servers`)).json() as {servers:Array<{command:string}>};
    expect(current.servers[0]?.command).toBe('my-reviewed-rea');
  });
});
