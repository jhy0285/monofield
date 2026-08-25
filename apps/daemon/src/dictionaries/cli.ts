import { readFile } from 'node:fs/promises';
import path from 'node:path';

type CliHelpers = {
  baseUrl: (flags: Record<string, unknown>) => Promise<string>;
  parseFlags: (args: string[], options: { string: Set<string>; boolean: Set<string> }) => Record<string, unknown>;
  positionalArgs: (args: string[], stringFlags: Set<string>) => string[];
};

const STRING_FLAGS = new Set(['daemon-url', 'name', 'project', 'version']);
const BOOLEAN_FLAGS = new Set(['json', 'help', 'h']);

function printHelp(): void {
  console.log(`Usage:
  od dictionary list [--json] [--daemon-url <url>]
  od dictionary show <dictionary-id> [--json] [--daemon-url <url>]
  od dictionary add <file> --name <name> [--json] [--daemon-url <url>]
  od dictionary version <dictionary-id> <file> [--json] [--daemon-url <url>]
  od dictionary rename <dictionary-id> --name <name> [--json] [--daemon-url <url>]
  od dictionary delete <dictionary-id> [--json] [--daemon-url <url>]
  od dictionary attach <dictionary-id> --project <project-id> [--version <version-id>] [--json] [--daemon-url <url>]

Global dictionaries are stored by MonoField. Attaching a version copies an
immutable snapshot into the selected project, so later library changes do not
change a generated specification's inputs.`);
}

async function uploadDictionary(url: string, filePath: string, name?: string): Promise<Response> {
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.append('file', new Blob([bytes]), path.basename(filePath));
  if (name) form.append('name', name);
  return await fetch(url, { method: 'POST', body: form });
}

export async function runDictionaryCli(args: string[], helpers: CliHelpers): Promise<void> {
  const subcommand = args[0];
  if (!subcommand || subcommand === 'help' || args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }
  const flags = helpers.parseFlags(args.slice(1), { string: STRING_FLAGS, boolean: BOOLEAN_FLAGS });
  const values = helpers.positionalArgs(args.slice(1), STRING_FLAGS);
  const base = (await helpers.baseUrl(flags)).replace(/\/$/, '');
  const dictionaryId = values[0] ?? '';
  let response: Response;

  if (subcommand === 'list') {
    response = await fetch(`${base}/api/dictionaries`);
  } else if (subcommand === 'show' && dictionaryId) {
    response = await fetch(`${base}/api/dictionaries/${encodeURIComponent(dictionaryId)}`);
  } else if (subcommand === 'add' && values[0]) {
    const name = typeof flags.name === 'string' ? flags.name.trim() : '';
    if (!name) throw new Error('dictionary add requires --name <name>');
    response = await uploadDictionary(`${base}/api/dictionaries`, values[0], name);
  } else if (subcommand === 'version' && dictionaryId && values[1]) {
    response = await uploadDictionary(`${base}/api/dictionaries/${encodeURIComponent(dictionaryId)}/versions`, values[1]);
  } else if (subcommand === 'rename' && dictionaryId) {
    const name = typeof flags.name === 'string' ? flags.name.trim() : '';
    if (!name) throw new Error('dictionary rename requires --name <name>');
    response = await fetch(`${base}/api/dictionaries/${encodeURIComponent(dictionaryId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  } else if (subcommand === 'delete' && dictionaryId) {
    response = await fetch(`${base}/api/dictionaries/${encodeURIComponent(dictionaryId)}`, { method: 'DELETE' });
  } else if (subcommand === 'attach' && dictionaryId) {
    const projectId = typeof flags.project === 'string' ? flags.project : '';
    if (!projectId) throw new Error('dictionary attach requires --project <project-id>');
    let versionId = typeof flags.version === 'string' ? flags.version : '';
    if (!versionId) {
      const detail = await fetch(`${base}/api/dictionaries/${encodeURIComponent(dictionaryId)}`);
      const payload = await detail.json().catch(() => null) as { dictionary?: { latestVersion?: { id?: string } }; error?: { message?: string } } | null;
      if (!detail.ok) throw new Error(payload?.error?.message ?? `dictionary request failed: HTTP ${detail.status}`);
      versionId = payload?.dictionary?.latestVersion?.id ?? '';
    }
    if (!versionId) throw new Error('dictionary has no version to attach');
    response = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/dictionaries/attach`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ versionId }),
    });
  } else {
    throw new Error('invalid dictionary command; run `od dictionary help`');
  }

  const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(payload?.error?.message ?? `dictionary request failed: HTTP ${response.status}`);
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}
