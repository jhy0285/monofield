import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type StartServerResult } from '../src/server.js';
import { buildAcpMcpServers, buildClaudeMcpJson, type McpServerConfig } from '../src/mcp-config.js';
import { installTestCredentialVault, type TestCredentialVault } from './helpers/credential-vault.js';

const execute = promisify(execFile);
describe('REA configuration through the public MCP API and CLI', () => {
  let server: StartServerResult;
  let vault: TestCredentialVault;
  const cli = (command: string) => execute(process.execPath, [resolve('dist/cli.js'), 'rea', command, '--json', '--daemon-url', server.url]);
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
  it('refuses to overwrite a custom server with the same ID', async () => {
    await put([{id:'rea',transport:'stdio',command:'my-reviewed-rea',enabled:true}]);
    await expect(cli('configure')).rejects.toThrow();
    const current = await (await fetch(`${server.url}/api/mcp/servers`)).json() as {servers:Array<{command:string}>};
    expect(current.servers[0]?.command).toBe('my-reviewed-rea');
  });
});
