import type {
  BrowserEvidenceApplyResponse,
  BrowserEvidenceCrossCheckResponse,
  BrowserEvidenceFinding,
  BrowserEvidenceListResponse,
} from '@open-design/contracts';
import type { McpServerConfig, McpTemplate } from '../mcp-config.js';

const USAGE = `Usage:
  monofield rea <status|configure|disable> [--json] [--daemon-url URL]
  monofield rea evidence    --project <id> [--json]
  monofield rea cross-check --project <id> --evidence <file>... [--input <spec.interface-spec.json>] [--json]
  monofield rea apply       --project <id> --evidence <file>... [--input <spec>] [--finding <id>...]
                            [--include-examples] [--no-attach-evidence] [--note-lang ko|en]
                            [--write [--out <file>] [--base-sha256 <hash>]] [--json]

status, configure and disable manage the optional pinned REA MCP server for new
supported local-agent conversations. They do not install Node.js, start REA, or
test server availability.

evidence lists the project's REA browser capture files (rea.browser-scenario-capture).
cross-check compares what a recorded browser scenario sent and received with an
interface specification: undocumented endpoints and fields, renamed or retyped
fields, observed error codes. Without --input it compares against an empty
document, which lists every observed endpoint. A field missing from the captured
samples is "not observed", never "absent". apply writes the applicable findings
into a copy of the document: added rows are unreviewed with empty Korean labels
(run "monofield judge check" on the result), nothing is removed. Without --write
it only prints the result. --write saves it to --out, or back to --input; saving
over --input is refused when the file changed since the comparison (--base-sha256
pins the hash printed by "cross-check --json"). Response examples are real
application data and are copied only with --include-examples.`;

type Flags = Record<string, unknown>;
interface Helpers {
  baseUrl: (flags: Flags) => Promise<string>;
  parseFlags: (args: string[], options: { string: Set<string>; boolean: Set<string> }) => Flags;
  positionalArgs: (args: string[], stringFlags: Set<string>) => string[];
}

const EVIDENCE_COMMANDS = ['evidence', 'cross-check', 'apply'];
const MCP_COMMANDS = ['status', 'configure', 'disable'];

/** `parseFlags` keeps the last value of a flag; these two may be given several times. */
export function repeatedFlag(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--') break;
    if (arg === `--${name}`) {
      const next = args[i + 1];
      if (next === undefined) throw new Error(`flag --${name} requires a value`);
      values.push(next);
      i += 1;
    } else if (arg.startsWith(`--${name}=`)) values.push(arg.slice(name.length + 3));
  }
  return values;
}

const formatFinding = (finding: BrowserEvidenceFinding): string => {
  const { method, path, interfaceId } = finding.endpoint;
  const renamed = finding.documentedField && finding.documentedField !== finding.field;
  const what = [finding.side, finding.field && (renamed ? `${finding.field} ≠ ${finding.documentedField}` : finding.field)].filter(Boolean).join(' ');
  const detail = finding.details?.length ? `  [${finding.details.join('; ')}]` : '';
  return `  ${finding.severity.padEnd(7)} ${finding.kind.padEnd(22)} ${method} ${path}${interfaceId ? ` (${interfaceId})` : ''}${what ? `  ${what}` : ''}${detail}${finding.applicable ? '' : '  (not written by apply)'}`;
};

async function runEvidenceCommand(command: string, args: string[], helpers: Helpers): Promise<void> {
  const strings = new Set(['daemon-url', 'project', 'input', 'evidence', 'finding', 'out', 'note-lang', 'base-sha256']);
  const flags = helpers.parseFlags(args, {
    string: strings,
    boolean: new Set(['json', 'help', 'include-examples', 'no-attach-evidence', 'write']),
  });
  if (flags.help) { console.log(USAGE); return; }
  if (helpers.positionalArgs(args, strings).length > 1) throw new Error(`Unexpected argument. Use monofield rea ${command} --help.`);
  if (typeof flags.project !== 'string' || !flags.project) throw new Error(`${command} requires --project.`);
  const project = encodeURIComponent(flags.project);
  const base = (await helpers.baseUrl(flags)).replace(/\/$/, '');
  const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  const call = async <T,>(path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${base}${path}`, body === undefined ? undefined
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(payload.error?.message ?? `Browser evidence HTTP ${response.status}`);
    }
    return await response.json() as T;
  };

  if (command === 'evidence') {
    const { files } = await call<BrowserEvidenceListResponse>(`/api/projects/${project}/browser-evidence`);
    if (flags.json) { print({ files }); return; }
    if (files.length === 0) console.log('No REA browser capture files in this project.');
    for (const file of files) console.log(`${file.file}  ${(file.size / 1024).toFixed(1)} KB  ${file.mtime ? new Date(file.mtime).toISOString() : ''}`.trimEnd());
    return;
  }

  const evidenceFiles = repeatedFlag(args, 'evidence');
  if (evidenceFiles.length === 0) throw new Error(`${command} requires at least one --evidence <file>.`);
  const input = typeof flags.input === 'string' && flags.input ? flags.input : undefined;
  const common = { evidenceFiles, ...(input ? { inputFile: input } : {}) };

  if (command === 'cross-check') {
    const result = await call<BrowserEvidenceCrossCheckResponse>(`/api/projects/${project}/browser-evidence/cross-check`, common);
    if (flags.json) { print(result); return; }
    const { summary } = result;
    console.log(`${input ?? '(empty document)'}: ${summary.observedApiCalls} API calls · ${summary.exercisedEndpoints}/${summary.documentedEndpoints} endpoints exercised · `
      + `${summary.undocumentedEndpoints} undocumented · ${summary.confirmedFields}/${summary.documentedFields} fields confirmed`);
    console.log(`${summary.errors} error · ${summary.warnings} warning · ${summary.info} info`);
    for (const source of result.sources) {
      const note = source.completeness.status === 'complete' ? '' : `  (${source.completeness.status}${source.completeness.missingSections.length ? `: ${source.completeness.missingSections.join(', ')}` : ''})`;
      console.log(`  ${source.file}: ${source.apiTransactions} API of ${source.transactions} requests${note}`);
    }
    for (const finding of result.findings) {
      console.log(formatFinding(finding));
      if (finding.applicable) console.log(`            id: ${finding.id}`);
    }
    if (result.contentSha256) console.log(`content sha256: ${result.contentSha256}`);
    return;
  }

  // apply
  const write = flags.write === true;
  const out = typeof flags.out === 'string' && flags.out ? flags.out : undefined;
  if (out && !write) throw new Error('--out names the project file to write; add --write (without it apply only prints the result).');
  if (write && !input && !out) throw new Error('Drafting without --input needs --out <file> with --write.');
  if (flags['base-sha256'] !== undefined && !write) throw new Error('--base-sha256 only applies with --write.');
  const noteLanguage = flags['note-lang'];
  if (noteLanguage !== undefined && noteLanguage !== 'ko' && noteLanguage !== 'en') throw new Error('--note-lang must be ko or en.');
  const findingIds = repeatedFlag(args, 'finding');
  const body: Record<string, unknown> = {
    ...common,
    ...(findingIds.length ? { findingIds } : {}),
    ...(flags['include-examples'] ? { includeExamples: true } : {}),
    ...(flags['no-attach-evidence'] ? { attachEvidence: false } : {}),
    ...(noteLanguage ? { noteLanguage } : {}),
  };
  if (write) {
    body.write = true;
    if (out) body.outputFile = out;
    // Overwriting the input needs the hash of the version that was reviewed. Unless
    // the caller pins one, that is the document as it is when this command runs.
    if (input && (!out || out === input)) {
      body.baseContentSha256 = typeof flags['base-sha256'] === 'string' ? flags['base-sha256']
        : (await call<BrowserEvidenceCrossCheckResponse>(`/api/projects/${project}/browser-evidence/cross-check`, common)).contentSha256;
    }
  }
  const result = await call<BrowserEvidenceApplyResponse>(`/api/projects/${project}/browser-evidence/apply`, body);
  if (flags.json) { print(result); return; }
  const c = result.changes;
  console.log(`${c.endpointsAdded} endpoints added · ${c.fieldsAdded} fields added · ${c.fieldsRenamed} renamed · ${c.typesChanged} retyped · `
    + `${c.notesAdded} notes · ${c.evidenceAttached} evidence references · ${c.examplesAdded} examples`);
  if (result.written) {
    console.log(`written: ${result.written.file} (sha256 ${result.written.contentSha256})`);
    if (c.endpointsAdded || c.fieldsAdded) {
      console.log(`Added rows have empty Korean labels. Next: monofield judge check --project ${flags.project} --input ${result.written.file}`);
    }
  } else console.log('Nothing was written (add --write to save the result).');
}

/** Configure the optional REA MCP server (Settings → MCP) and compare REA browser evidence with interface specifications. */
export async function runReaCli(args: string[], helpers: Helpers): Promise<void> {
  const strings = new Set(['daemon-url', 'project', 'input', 'evidence', 'finding', 'out', 'note-lang', 'base-sha256']);
  const [command = 'status', ...extra] = helpers.positionalArgs(args, strings);
  if (EVIDENCE_COMMANDS.includes(command)) return runEvidenceCommand(command, args, helpers);

  const flags = helpers.parseFlags(args, { string: new Set(['daemon-url']), boolean: new Set(['json', 'help']) });
  if (flags.help) { console.log(USAGE); return; }
  if (extra.length || !MCP_COMMANDS.includes(command)) throw new Error('Use monofield rea <status|configure|disable|evidence|cross-check|apply> --help.');
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
