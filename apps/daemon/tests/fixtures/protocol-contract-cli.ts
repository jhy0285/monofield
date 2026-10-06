// Synthetic protocol fixture, never an authenticated vendor response.
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const config = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as {
  id: string; parser: string; format: string; transport: string;
  failure: boolean | 'structured-auth' | 'final-frame'; marker: string;
  workflow?: boolean;
};
const args = process.argv.slice(3);
const emit = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n');
if (args.includes('--version')) {
  console.log('protocol-fixture 1.0.0');
  process.exit(0);
}
if (args.includes('--help')) process.exit(0);
if (args.includes('status') || args.includes('--list-sessions')) {
  emit({ loggedIn: true });
  process.exit(0);
}
if (config.failure === 'structured-auth') {
  emit({ type: 'result', is_error: true, error: 'Not logged in. Please login.' });
  process.exit(0);
}
if (config.failure === true) {
  console.error('No API key configured. Please log in.');
  process.exit(0);
}

function received(prompt: string) {
  if (config.workflow) {
    if (!prompt.includes(`[[MF_CONTRACT:${config.id}]]`)) {
      console.error('Fixture did not receive its workflow marker');
      process.exit(2);
    }
    writeFileSync('audit-result.txt', `Synthetic workflow: ${config.id}\n`);
  } else if (prompt !== 'Reply with only: ok') {
    console.error('Fixture received a different prompt: ' + JSON.stringify(prompt));
    process.exit(2);
  }
  writeFileSync(config.marker, JSON.stringify({ args, prompt, cwd: process.cwd() }));
}

function reply(prompt: string) {
  received(prompt);
  if (config.format === 'plain') console.log('ok');
  else if (config.format === 'copilot-stream-json') emit({ type: 'assistant.message_delta', data: { deltaContent: 'ok' } });
  else if (config.format === 'claude-stream-json' || config.format === 'qoder-stream-json') {
    const message = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } };
    if (config.failure === 'final-frame') process.stdout.write(JSON.stringify(message));
    else emit(message);
  }
  else if (config.parser === 'codex') emit({ type: 'item.completed', item: { type: 'agent_message', text: 'ok' } });
  else if (config.parser === 'opencode') emit({ type: 'text', part: { text: 'ok' } });
  else if (config.parser === 'gemini') emit({ type: 'message', role: 'assistant', content: 'ok', delta: true });
  else if (config.parser === 'cursor-agent') emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } });
  else if (config.parser === 'kimi') emit({ role: 'assistant', content: 'ok' });
  else throw new Error('Uncovered fixture parser: ' + config.parser);
  setTimeout(() => process.exit(0), 100);
}

if (config.format === 'acp-json-rpc') {
  createInterface({ input: process.stdin }).on('line', (line) => {
    const request = JSON.parse(line);
    if (request.id == null) return;
    let result: unknown = {};
    if (request.method === 'initialize') result = { protocolVersion: 1, agentCapabilities: {} };
    if (request.method === 'session/new') result = { sessionId: 'fixture-session' };
    if (request.method === 'session/prompt') {
      received(request.params.prompt.map((part: { text?: string }) => part.text ?? '').join(''));
      emit({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'fixture-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ok' } } } });
      result = { stopReason: 'end_turn' };
    }
    emit({ jsonrpc: '2.0', id: request.id, result });
  });
} else if (config.format === 'pi-rpc') {
  createInterface({ input: process.stdin }).on('line', (line) => {
    const request = JSON.parse(line);
    emit({ type: 'response', id: request.id, command: request.type, success: true });
    if (request.type !== 'prompt') return;
    received(request.message);
    emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'ok' } });
    emit({ type: 'agent_end' });
  });
} else if (config.transport === 'file') {
  reply(readFileSync(args[args.indexOf('--prompt-file') + 1]!, 'utf8'));
} else if (config.transport === 'argv') {
  const flag = config.id === 'aider' ? '--message' : config.id === 'deepseek' ? '--auto' : '-p';
  reply(args[args.indexOf(flag) + 1]!);
} else if (config.transport === 'stream-json') {
  createInterface({ input: process.stdin }).once('line', (line) => {
    const request = JSON.parse(line);
    const content = request.message.content;
    reply(typeof content === 'string' ? content : content.map((part: { text?: string }) => part.text ?? '').join(''));
  });
} else {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => { input += chunk; });
  process.stdin.on('end', () => reply(input));
}
