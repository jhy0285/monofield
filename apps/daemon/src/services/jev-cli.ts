import { readFile } from 'node:fs/promises';

export async function runJevCli(args: string[], helpers: {
  baseUrl: (flags: Record<string, unknown>) => Promise<string>;
  parseFlags: (args: string[], options: { string: Set<string>; boolean: Set<string> }) => Record<string, unknown>;
  positionalArgs: (args: string[], stringFlags: Set<string>) => string[];
}): Promise<void> {
  const strings = new Set(['daemon-url', 'prompt-file', 'request-file', 'backend', 'local-url', 'model']);
  const flags = helpers.parseFlags(args, { string: strings, boolean: new Set(['json', 'help']) });
  const [command = 'status', ...words] = helpers.positionalArgs(args, strings);
  if (flags.help || !['status', 'models', 'configure', 'decide', 'triage', 'set-key', 'clear-key'].includes(command)) {
    console.log('Usage: monofield jev <status|models|configure|decide|triage|set-key|clear-key> [--backend typesafe|local --local-url URL --model NAME] [--request-file <JSON|->] [--prompt-file <path|->] [--json] [--daemon-url URL]');
    if (!flags.help) throw new Error('Unknown decision command.'); return;
  }
  const readInput = async (file: string) => {
    if (file !== '-') return readFile(file, 'utf8');
    const parts: Buffer[] = []; for await (const chunk of process.stdin) parts.push(Buffer.from(chunk)); return Buffer.concat(parts).toString('utf8');
  };
  const base = (await helpers.baseUrl(flags)).replace(/\/$/, '');
  let endpoint = command, method = 'GET', body: unknown;
  if (command === 'set-key' || command === 'clear-key') {
    if (command === 'set-key' && typeof flags['prompt-file'] !== 'string') throw new Error('set-key requires --prompt-file <path|->. Do not put credentials in arguments.');
    const key = command === 'clear-key' ? '' : (await readInput(flags['prompt-file'] as string)).trim();
    if (command === 'set-key' && !key) throw new Error('The key file is empty.');
    const response = await fetch(`${base}/api/byok/credentials`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credentials: { typesafe: key } }) });
    const result = await response.json() as { error?: { message?: string }; credentials?: Record<string, unknown> };
    if (!response.ok) throw new Error(result.error?.message ?? 'Could not update the encrypted credential.');
    process.stdout.write(`${JSON.stringify({ credential: result.credentials?.typesafe ?? { configured: false, apiKeyTail: '' } }, null, 2)}\n`);
    return;
  }
  if (command === 'configure') {
    const status = await fetch(`${base}/api/jev/status`); if (!status.ok) throw new Error('Could not read decision configuration.');
    const current = await status.json() as { config: Record<string, unknown> };
    endpoint = 'config'; method = 'PUT'; body = { ...current.config,
      ...(flags.backend ? { backend: flags.backend } : {}), ...(flags['local-url'] ? { localBaseUrl: flags['local-url'] } : {}), ...(flags.model ? { model: flags.model } : {}) };
  }
  if (command === 'decide') {
    if (typeof flags['request-file'] !== 'string') throw new Error('decide requires --request-file with a typed JSON request.');
    method = 'POST'; body = JSON.parse(await readInput(flags['request-file']));
  }
  if (command === 'triage') {
    const state = typeof flags['prompt-file'] === 'string' ? await readInput(flags['prompt-file']) : words.join(' ');
    if (!state.trim()) throw new Error('triage requires a prompt or --prompt-file.');
    method = 'POST'; body = { state };
  }
  const response = await fetch(`${base}/api/jev/${endpoint}`, { method, ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const result = await response.json() as { error?: { message?: string } };
  if (!response.ok) throw new Error(result.error?.message ?? `Decision HTTP ${response.status}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
