export async function runSchemaWatchCli(args: string[], helpers: {
  baseUrl: (flags: Record<string, unknown>) => Promise<string>;
  parseFlags: (args: string[], options: { string: Set<string>; boolean: Set<string> }) => Record<string, unknown>;
  positionalArgs: (args: string[], stringFlags: Set<string>) => string[];
}) {
  const strings = new Set(['daemon-url', 'interval', 'expected-sha']);
  const flags = helpers.parseFlags(args, { string: strings, boolean: new Set(['json', 'help']) });
  const [projectId, command = 'status'] = helpers.positionalArgs(args, strings);
  if (!projectId || flags.help || !['status', 'enable', 'disable', 'check', 'acknowledge'].includes(command)) {
    console.log('Usage: monofield database watch <project-id> <status|enable|disable|check|acknowledge> [--interval <10-86400>] [--expected-sha <sha256>] [--json] [--daemon-url <url>]');
    if (!flags.help) throw new Error('A project and a valid watch command are required.');
    return;
  }
  const base = (await helpers.baseUrl(flags)).replace(/\/$/, '');
  let url = `${base}/api/projects/${encodeURIComponent(projectId)}/database/schema-watch`;
  let init: RequestInit | undefined;
  if (command === 'enable' || command === 'disable') init = {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: command === 'enable', intervalSeconds: flags.interval == null ? 60 : Number(flags.interval) }),
  };
  if (command === 'check') { url += '/check'; init = { method: 'POST' }; }
  if (command === 'acknowledge') {
    if (typeof flags['expected-sha'] !== 'string') throw new Error('acknowledge requires --expected-sha from the last captured schema.');
    url += '/acknowledge'; init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedSha256: flags['expected-sha'] }) };
  }
  const response = await fetch(url, init);
  const result = await response.json() as { error?: { message?: string } };
  if (!response.ok) throw new Error(result?.error?.message ?? `Schema watch HTTP ${response.status}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
