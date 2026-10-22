import type { McpServerConfig, McpTemplate } from '../mcp-config.js';

/** Configure the same optional REA server exposed by Settings → MCP. */
export async function runReaCli(args: string[], helpers: {
  baseUrl: (flags: Record<string, unknown>) => Promise<string>;
  parseFlags: (args: string[], options: { string: Set<string>; boolean: Set<string> }) => Record<string, unknown>;
  positionalArgs: (args: string[], stringFlags: Set<string>) => string[];
}): Promise<void> {
  const strings = new Set(['daemon-url']);
  const flags = helpers.parseFlags(args, { string: strings, boolean: new Set(['json', 'help']) });
  const [command = 'status', ...extra] = helpers.positionalArgs(args, strings);
  if (flags.help) {
    console.log('Usage: monofield rea <status|configure|disable> [--json] [--daemon-url URL]\nConfigures the optional pinned REA MCP server for new supported local-agent conversations. Does not install Node.js, start REA, or test server availability.');
    return;
  }
  if (extra.length || !['status', 'configure', 'disable'].includes(command)) throw new Error('Use monofield rea <status|configure|disable> --help.');
  const base = (await helpers.baseUrl(flags)).replace(/\/$/, '');
  const endpoint = `${base}/api/mcp/servers`;
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`Could not read MCP configuration (HTTP ${response.status}).`);
  const current = await response.json() as { servers: McpServerConfig[]; templates: McpTemplate[] };
  if (!Array.isArray(current.servers) || !Array.isArray(current.templates)) throw new Error('Invalid MCP configuration response.');
  let server = current.servers.find(entry => entry.id === 'rea');
  if (command !== 'status') {
    if (server && server.templateId !== 'rea') throw new Error('A custom server already uses the rea ID. Manage it in Settings → MCP; it was not changed.');
    if (command === 'configure' && !server) {
      const template = current.templates.find(entry => entry.id === 'rea');
      if (!template?.command || template.transport !== 'stdio' || !template.args) throw new Error('This daemon does not provide the REA template. Update MonoField first.');
      server = { id: 'rea', templateId: 'rea', label: template.label, transport: 'stdio', command: template.command, args: template.args, enabled: true };
    }
    if (server) {
      const changed = { ...server, enabled: command === 'configure' };
      const servers = current.servers.some(entry => entry.id === 'rea')
        ? current.servers.map(entry => entry.id === 'rea' ? changed : entry)
        : [...current.servers, changed];
      const saved = await fetch(endpoint, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ servers }) });
      if (!saved.ok) throw new Error(`Could not save REA configuration (HTTP ${saved.status}).`);
      const result = await saved.json() as { servers: McpServerConfig[] };
      server = result.servers?.find(entry => entry.id === 'rea');
      if (!server || server.enabled !== changed.enabled) throw new Error('The daemon did not retain the requested REA configuration.');
    }
  }
  process.stdout.write(`${JSON.stringify({ configured: Boolean(server), enabled: server?.enabled ?? false, availability: 'not-probed',
    ...(server ? { server: { id: server.id, templateId: server.templateId, transport: server.transport, command: server.command, args: server.args } } : {}),
    nextStep: 'Start a new supported local-agent conversation; use the legacy-system-handover skill. REA runtime and Laya model/server are installed separately.' }, null, 2)}\n`);
}
