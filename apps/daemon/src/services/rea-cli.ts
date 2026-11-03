import type {
  ReaBrowserView,
  ReaCitation,
  ReaComparison,
  ReaDoctorResponse,
  ReaEvidenceListResponse,
  ReaEvidenceView,
  ReaSqliteView,
  ReaStaticView,
  ReaTraceView,
  BrowserEvidenceApplyResponse,
  BrowserEvidenceCrossCheckResponse,
  BrowserEvidenceFinding,
  BrowserEvidenceListResponse,
} from '@open-design/contracts';
import type { McpServerConfig, McpTemplate } from '../mcp-config.js';

const USAGE = `Usage:
  monofield rea <status|configure|disable> [--json] [--daemon-url URL]
  monofield rea doctor      [--json]
  monofield rea files       --project <id> [--json]
  monofield rea show        --project <id> --file <evidence.json> [--json]
  monofield rea cite        --project <id> --file <evidence.json> [--step <n> | --request <id> | --table <name> | --node <id> | --path <n>]
                            [--include-values] [--json]
  monofield rea compare     --project <id> --original <a.json> --remake <b.json> [--tolerance <n>] [--no-text] [--json]
  monofield rea evidence    --project <id> [--json]
  monofield rea cross-check --project <id> --evidence <file>... [--input <spec.interface-spec.json>] [--json]
  monofield rea apply       --project <id> --evidence <file>... [--input <spec>] [--finding <id>...]
                            [--include-examples] [--no-attach-evidence] [--note-lang ko|en]
                            [--write [--out <file>] [--base-sha256 <hash>]] [--json]

files lists every REA evidence file in a project (browser captures, SQLite inspections, static analyses, traces); show
prints one of them the way the REA Studio screen does: its envelope (operation, provider, confidence, limitations), then
what it holds. A payload is shown only when its SHA-256 matches the recorded one; REA's limitations and unknowns are
printed unchanged, and "not observed" is never turned into "absent".

doctor checks what REA needs on this machine: Node.js in the range rea-agents declares, npx, the REA MCP server in
MonoField's settings (required), a Chromium-family browser for browser capture and the engines some targets use
(optional). It looks on PATH and in the usual install locations only and installs nothing.

cite prints one evidence item (a step, request, table, graph node or trace path; the whole file without a selector) as
a <rea-evidence> block to quote in a prompt, the same block the REA Studio screen puts into the chat. A step's verified
screenshot is written next to the evidence (rea-cite/) and named in the block. Bodies, DOM text and SQLite rows are
real application data: without --include-values only their structure (JSON keys and types) is quoted.

compare puts an original next to its remake: two REA browser captures step by step (action, result, page path, API
calls with IDs normalized, visible text unless --no-text), or two case-result files ({"cases": [{"id", "input",
"output"}]}) case by case, numbers equal within --tolerance. It exits with status 1 when anything differs, so an agent
can loop until the remake matches. A pass means the recorded runs matched, not that the remake is equivalent.

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

const EVIDENCE_COMMANDS = ['files', 'show', 'cite', 'compare', 'evidence', 'cross-check', 'apply'];
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

const clip = (value: string, width: number) => (value.length > width ? `${value.slice(0, width - 1)}…` : value);

/** One REA evidence view as plain text: the same facts the REA Studio screen shows, in the same order. */
export function formatReaView(view: ReaEvidenceView): string {
  const lines: string[] = [];
  const { envelope } = view;
  lines.push(`${view.file}: ${envelope.operation} (${view.kind}) · ${envelope.provider.name || envelope.provider.id} ${envelope.provider.version}`.trimEnd());
  lines.push(`evidence ${envelope.evidenceId}${envelope.confidence ? ` · confidence ${envelope.confidence}` : ''}${envelope.authority ? ` · authority ${envelope.authority}` : ''}`);
  if (view.kind === 'browser') {
    const browser = view as ReaEvidenceView & ReaBrowserView;
    const api = browser.requests.filter((request) => request.isApi).length;
    lines.push(`${browser.steps.length} steps · ${browser.requests.length} requests (${api} API) · ${browser.durationMs ?? '?'} ms · completeness ${browser.completeness.status}${browser.completeness.missingSections.length ? ` (missing: ${browser.completeness.missingSections.join(', ')})` : ''}`);
    for (const step of browser.steps) {
      const shots = [step.screenshot && 'screenshot', step.dom && 'dom', step.accessibility && 'a11y'].filter(Boolean).join(' ');
      lines.push(`  step ${String(step.index).padStart(2)} ${clip(step.id, 28).padEnd(28)} ${step.action.padEnd(10)} ${String(step.elapsedMs ?? '-').padStart(5)} ms  ${step.status}${shots ? `  [${shots}]` : ''}${step.error ? `  error: ${step.error}` : ''}`);
    }
    for (const request of browser.requests) {
      const bodies = [request.request.state === 'integrity-failed' || request.response.state === 'integrity-failed' ? 'INTEGRITY FAILED' : '', request.response.state === 'captured' ? `${request.response.bytes} B` : request.response.state].filter(Boolean).join(' ');
      lines.push(`  ${request.isApi ? 'api ' : '    '}${request.method.padEnd(6)} ${clip(request.path, 44).padEnd(44)} ${String(request.status ?? request.failure ?? '-').padEnd(5)} ${request.resourceType.padEnd(9)} ${bodies}`);
    }
  } else if (view.kind === 'sqlite') {
    const sqlite = view as ReaEvidenceView & ReaSqliteView;
    lines.push(`${sqlite.engine} · ${sqlite.tables.length} tables · schema ${sqlite.completeness}${sqlite.bytes ? ` · ${sqlite.bytes} bytes` : ''}`);
    for (const table of sqlite.tables) {
      lines.push(`  ${table.name}(${table.columns.map((column) => `${column.name}${column.primaryKey ? ' PK' : ''}${column.notNull ? ' NN' : ''}`).join(', ')})`);
      for (const key of table.foreignKeys) lines.push(`      ${key.column} → ${key.refTable}.${key.refColumn}`);
      for (const unique of table.unique) lines.push(`      UNIQUE(${unique})`);
      for (const check of table.checks) lines.push(`      CHECK(${clip(check, 70)})`);
      if (table.rows) lines.push(`      rows: ${table.rows.returned}${table.rows.truncated ? '+ (truncated)' : ''} — ${table.rows.columns.join(', ')}`);
    }
  } else if (view.kind === 'static') {
    const analysis = view as ReaEvidenceView & ReaStaticView;
    lines.push(`${analysis.format ?? 'application'} · application coverage ${analysis.applicationCoverage ?? 'unknown'} · semantic coverage ${analysis.semanticCoverage ?? 'unknown'} · ${analysis.semanticUnknowns} semantic unknowns`);
    lines.push(`  ${analysis.statistics.filter((item) => item.value > 0).map((item) => `${item.key} ${item.value}`).join(' · ')}`);
    lines.push(`  graph: ${analysis.nodeTotal} nodes, ${analysis.edgeTotal} edges (showing ${analysis.nodes.length})`);
    for (const node of analysis.nodes) lines.push(`    ${node.kind.padEnd(18)} ${node.label}`);
    for (const reason of analysis.unknownReasons) lines.push(`  unknown: ${reason.reason} × ${reason.count}`);
  } else if (view.kind === 'trace') {
    const trace = view as ReaEvidenceView & ReaTraceView;
    lines.push(`seed "${trace.seed}" (${trace.direction}) · ${trace.status} · ${trace.matches} matches · ${trace.terminalPaths} terminal paths`);
    if (trace.status === 'no-match') lines.push('  no literal match: that does not show the feature is absent.');
    trace.paths.forEach((path, index) => lines.push(`  path ${index + 1}: ${path.join(' → ')}`));
  } else {
    for (const fact of (view as unknown as { facts: Array<{ key: string; value: string }> }).facts) lines.push(`  ${fact.key}: ${fact.value}`);
  }
  for (const unknown of view.unknowns) lines.push(`unknown: ${unknown}`);
  if (envelope.limitations.length) {
    lines.push(`limitations (${envelope.limitations.length}):`);
    for (const limitation of envelope.limitations) lines.push(`  - ${limitation}`);
  }
  return lines.join('\n');
}

const STRING_FLAGS = ['daemon-url', 'project', 'input', 'evidence', 'finding', 'out', 'note-lang', 'base-sha256', 'file',
  'step', 'request', 'table', 'node', 'path', 'original', 'remake', 'tolerance'];

/** The setup check as text, required items first. */
export function formatReaDoctor(result: ReaDoctorResponse): string {
  const lines = [`REA ${result.package.version} (${result.package.name}, Node ${result.package.node}) on ${result.platform}: ${result.ready ? 'ready' : 'not ready'}`];
  for (const check of [...result.checks].sort((a, b) => Number(b.required) - Number(a.required))) {
    lines.push(`  ${check.status.padEnd(7)} ${check.id.padEnd(8)} ${check.required ? 'required' : 'optional'}  ${check.found ?? 'not found'}${check.note ? `  (${check.note})` : ''}`);
  }
  lines.push('Looked on PATH and in the usual install locations only. A ready setup still has to be seen working: start a new agent conversation and check that it lists REA tools.');
  return lines.join('\n');
}

async function runEvidenceCommand(command: string, args: string[], helpers: Helpers): Promise<void> {
  const strings = new Set(STRING_FLAGS);
  const flags = helpers.parseFlags(args, {
    string: strings,
    boolean: new Set(['json', 'help', 'include-examples', 'no-attach-evidence', 'write', 'include-values', 'no-text']),
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

  if (command === 'files') {
    const { files, cases = [] } = await call<ReaEvidenceListResponse>(`/api/projects/${project}/rea-evidence`);
    if (flags.json) { print({ files, cases }); return; }
    if (files.length === 0) console.log('No REA evidence files in this project.');
    for (const file of files) console.log(`${file.kind.padEnd(8)} ${file.file}  ${(file.size / 1024).toFixed(1)} KB  ${file.operation}`);
    for (const file of cases) console.log(`${'cases'.padEnd(8)} ${file.file}  ${(file.size / 1024).toFixed(1)} KB  case results (compare with monofield rea compare)`);
    return;
  }
  if (command === 'show') {
    if (typeof flags.file !== 'string' || !flags.file) throw new Error('show requires --file <evidence.json>.');
    const view = await call<ReaEvidenceView>(`/api/projects/${project}/rea-evidence/view`, { file: flags.file });
    if (flags.json) { print(view); return; }
    console.log(formatReaView(view));
    return;
  }
  if (command === 'cite') {
    if (typeof flags.file !== 'string' || !flags.file) throw new Error('cite requires --file <evidence.json>.');
    const selectors = (['step', 'request', 'table', 'node', 'path'] as const).filter((name) => typeof flags[name] === 'string');
    if (selectors.length > 1) throw new Error('cite takes one of --step, --request, --table, --node, --path.');
    const name = selectors[0];
    const value = name ? String(flags[name]) : '';
    const index = Number(value);
    if ((name === 'step' || name === 'path') && (!Number.isInteger(index) || index < 0)) throw new Error(`--${name} must be a whole number.`);
    // Trace paths are numbered from 1 in the printed output, and from 0 in the file.
    const target = !name ? { kind: 'file' } : name === 'step' ? { kind: 'step', index } : name === 'path' ? { kind: 'path', index: Math.max(0, index - 1) }
      : name === 'table' ? { kind: 'table', name: value } : { kind: name, id: value };
    const citation = await call<ReaCitation>(`/api/projects/${project}/rea-evidence/cite`, { file: flags.file, target, includeValues: flags['include-values'] === true });
    if (flags.json) { print(citation); return; }
    console.log(citation.block);
    for (const file of citation.files) process.stderr.write(`written: ${file}\n`);
    return;
  }
  if (command === 'compare') {
    if (typeof flags.original !== 'string' || typeof flags.remake !== 'string') throw new Error('compare requires --original <file> and --remake <file>.');
    const tolerance = flags.tolerance === undefined ? undefined : Number(flags.tolerance);
    if (tolerance !== undefined && (!Number.isFinite(tolerance) || tolerance < 0)) throw new Error('--tolerance must be a number of at least 0.');
    const result = await call<ReaComparison>(`/api/projects/${project}/rea-evidence/compare`, {
      original: flags.original, remake: flags.remake, ...(tolerance !== undefined ? { tolerance } : {}), compareText: flags['no-text'] !== true,
    });
    if (flags.json) print(result); else console.log(result.report);
    if (result.summary.pass !== result.summary.total) process.exitCode = 1;
    return;
  }

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
  const strings = new Set(['daemon-url', 'project', 'input', 'evidence', 'finding', 'out', 'note-lang', 'base-sha256', 'file']);
  const [command = 'status', ...extra] = helpers.positionalArgs(args, new Set([...strings, ...STRING_FLAGS]));
  if (EVIDENCE_COMMANDS.includes(command)) return runEvidenceCommand(command, args, helpers);
  if (command === 'doctor') {
    const flags = helpers.parseFlags(args, { string: new Set(['daemon-url']), boolean: new Set(['json', 'help']) });
    if (flags.help) { console.log(USAGE); return; }
    if (extra.length) throw new Error('Unexpected argument. Use monofield rea doctor --help.');
    const base = (await helpers.baseUrl(flags)).replace(/\/$/, '');
    const response = await fetch(`${base}/api/rea/doctor`);
    if (!response.ok) throw new Error(`Could not run the REA setup check (HTTP ${response.status}).`);
    const result = await response.json() as ReaDoctorResponse;
    if (flags.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); else console.log(formatReaDoctor(result));
    return;
  }

  const flags = helpers.parseFlags(args, { string: new Set(['daemon-url']), boolean: new Set(['json', 'help']) });
  if (flags.help) { console.log(USAGE); return; }
  if (extra.length || !MCP_COMMANDS.includes(command)) throw new Error('Use monofield rea <status|configure|disable|doctor|files|show|cite|compare|evidence|cross-check|apply> --help.');
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
