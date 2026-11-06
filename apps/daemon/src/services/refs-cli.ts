import { readFile } from 'node:fs/promises';
import type { ReferenceApplyResponse, ReferenceItem, ReferenceListResponse } from '@open-design/contracts';
import { referenceOutlineLines } from '@open-design/contracts';
import { repeatedFlag } from './rea-cli.js';

const USAGE = `Usage:
  monofield refs list    --project <id> [--json]
  monofield refs add     --project <id> --url <https://...> [--title <text>] [--note <text>] [--take structure,flow,fields,interaction]
                         [--screenshot <file.png|jpg>] [--json]
  monofield refs note    --project <id> --id <ref-id> [--note <text>] [--title <text>] [--take <list>] [--json]
  monofield refs remove  --project <id> --id <ref-id> [--json]
  monofield refs apply   --project <id> --id <ref-id>... [--target <file or screen>] [--request <text> | --prompt-file <path|->]
                         [--take <list>] [--no-screenshot] [--json]

The reference board keeps pages you liked while browsing, to borrow a pattern from: the URL (secret-looking query values
removed), an optional screenshot, an outline of the page's structure (regions, heading levels, form fields, table
headers, control counts) and your note. Body text, images, links, colours and fonts are not kept. The board lives in the
project's references/ folder, which has its own .gitignore.

The built-in browser keeps the screenshot and outline with "레퍼런스로 담기"; add keeps a URL and, with --screenshot, an
image you took. apply prints the block the browser's "프로젝트에 넣기" puts into the chat: your request, the target, the
rules (rebuild the pattern in this project's own code and style; copy no text, images, logos or branding; never get
around a login or bot protection), then each reference with its note, what to take, the screenshot path (with whether its
bytes still match) and the outline.`;

type Flags = Record<string, unknown>;
interface Helpers {
  baseUrl: (flags: Flags) => Promise<string>;
  parseFlags: (args: string[], options: { string: Set<string>; boolean: Set<string> }) => Flags;
  positionalArgs: (args: string[], stringFlags: Set<string>) => string[];
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

/** One reference as lines: what the board screen shows on a card. */
export function formatReference(item: ReferenceItem): string {
  const lines = [`${item.id}  ${item.title}`, `  ${item.url}`, `  take: ${item.takes.join(', ')} · kept ${item.capturedAt} (${item.source})`];
  if (item.note) lines.push(`  note: ${item.note}`);
  if (item.screenshot) lines.push(`  screenshot: ${item.screenshot.file} (${item.screenshot.bytes} B)`);
  if (item.outline) lines.push(...referenceOutlineLines(item.outline).map((line) => `  ${line}`));
  return lines.join('\n');
}

export async function runRefsCli(args: string[], helpers: Helpers): Promise<void> {
  const strings = new Set(['daemon-url', 'project', 'url', 'title', 'note', 'take', 'screenshot', 'id', 'target', 'request', 'prompt-file']);
  const flags = helpers.parseFlags(args, { string: strings, boolean: new Set(['json', 'help', 'no-screenshot']) });
  const [command, ...extra] = helpers.positionalArgs(args, strings);
  if (flags.help || !command || !['list', 'add', 'note', 'remove', 'apply'].includes(command) || extra.length) {
    console.log(USAGE);
    if (!flags.help) throw new Error('Use monofield refs <list|add|note|remove|apply> --help.');
    return;
  }
  if (typeof flags.project !== 'string' || !flags.project) throw new Error(`${command} requires --project.`);
  const base = (await helpers.baseUrl(flags)).replace(/\/$/, '');
  const root = `${base}/api/projects/${encodeURIComponent(flags.project)}/references`;
  const call = async <T>(url: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(url, init);
    const payload = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message ?? `Reference board HTTP ${response.status}`);
    return payload;
  };
  const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  const takes = typeof flags.take === 'string' ? flags.take.split(',').map((take) => take.trim()).filter(Boolean) : undefined;
  const id = () => {
    if (typeof flags.id !== 'string' || !flags.id) throw new Error(`${command} requires --id.`);
    return flags.id;
  };

  if (command === 'list') {
    const result = await call<ReferenceListResponse>(root);
    if (flags.json) { print(result); return; }
    if (!result.items.length) { console.log(`No references in ${result.folder}/ yet.`); return; }
    console.log(result.items.map(formatReference).join('\n\n'));
    return;
  }
  if (command === 'add') {
    if (typeof flags.url !== 'string') throw new Error('add requires --url.');
    const screenshotBase64 = typeof flags.screenshot === 'string' ? (await readFile(flags.screenshot)).toString('base64') : undefined;
    const { item } = await call<{ item: ReferenceItem }>(root, json('POST', {
      url: flags.url, source: 'cli',
      ...(typeof flags.title === 'string' ? { title: flags.title } : {}),
      ...(typeof flags.note === 'string' ? { note: flags.note } : {}),
      ...(takes ? { takes } : {}),
      ...(screenshotBase64 ? { screenshotBase64 } : {}),
    }));
    if (flags.json) print(item); else console.log(formatReference(item));
    return;
  }
  if (command === 'note') {
    const body = {
      ...(typeof flags.title === 'string' ? { title: flags.title } : {}),
      ...(typeof flags.note === 'string' ? { note: flags.note } : {}),
      ...(takes ? { takes } : {}),
    };
    if (!Object.keys(body).length) throw new Error('note needs --note, --title or --take.');
    const { item } = await call<{ item: ReferenceItem }>(`${root}/${encodeURIComponent(id())}`, json('PATCH', body));
    if (flags.json) print(item); else console.log(formatReference(item));
    return;
  }
  if (command === 'remove') {
    const result = await call<{ removed: string; files: string[] }>(`${root}/${encodeURIComponent(id())}`, { method: 'DELETE' });
    if (flags.json) print(result); else console.log(`Removed ${result.removed}${result.files.length ? ` and ${result.files.join(', ')}` : ''}.`);
    return;
  }
  const ids = repeatedFlag(args, 'id');
  if (!ids.length) throw new Error('apply requires at least one --id.');
  if (typeof flags.request === 'string' && typeof flags['prompt-file'] === 'string') throw new Error('Use --request or --prompt-file, not both.');
  const promptFile = flags['prompt-file'];
  const request = typeof promptFile === 'string' ? (promptFile === '-' ? await readStdin() : await readFile(promptFile, 'utf8'))
    : typeof flags.request === 'string' ? flags.request : undefined;
  const result = await call<ReferenceApplyResponse>(`${root}/apply`, json('POST', {
    referenceIds: ids,
    ...(typeof flags.target === 'string' ? { target: flags.target } : {}),
    ...(request !== undefined ? { request } : {}),
    ...(takes ? { takes } : {}),
    ...(flags['no-screenshot'] ? { includeScreenshot: false } : {}),
  }));
  if (flags.json) { print(result); return; }
  process.stdout.write(`${result.block}\n`);
  for (const shot of result.screenshots.filter((item) => item.state !== 'verified')) {
    process.stderr.write(`warning: ${shot.file} is ${shot.state === 'missing' ? 'missing' : 'changed since it was kept'}\n`);
  }
}
