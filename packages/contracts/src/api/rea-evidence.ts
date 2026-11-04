import type { ObservedBodyState } from './browser-evidence.js';

/**
 * REA Studio: the view model a project's REA evidence file is shown through.
 *
 * REA (Reverse Engineer Anything) writes one JSON envelope per operation
 * (`capture_browser_scenario`, `inspect_sqlite_database`,
 * `analyze_javascript_application`, `trace_application_feature`,
 * `inspect_analysis_view`). The daemon reads such a file, checks its integrity
 * (SHA-256 of captured bodies and artifacts) and turns it into one of these
 * views; the web app and the CLI show the same view. Nothing here adds a claim
 * REA did not make: completeness, limitations and unknowns are carried over,
 * and an absent value is never presented as a negative.
 */
export type ReaEvidenceKind = 'browser' | 'sqlite' | 'static' | 'trace' | 'view' | 'other';

export interface ReaEvidenceListEntry {
  file: string;
  size: number;
  mtime: number;
  kind: ReaEvidenceKind;
  operation: string;
  evidenceId: string;
}

/** A case-result file (`{ "cases": [...] }`, "cases" first or right after "format"): one side of a comparison. */
export interface ReaCaseFileEntry {
  file: string;
  size: number;
  mtime: number;
}

export interface ReaEvidenceListResponse {
  files: ReaEvidenceListEntry[];
  /** Case-result files, which can be compared with each other (not REA evidence themselves). */
  cases: ReaCaseFileEntry[];
}

export interface ReaEnvelope {
  evidenceId: string;
  predicate: string;
  operation: string;
  provider: { id: string; name: string; version: string };
  /** REA's confidence class (`observed`, `inferred`, ...) and authority (`controlled-replay`, ...), when it states them. */
  confidence: string | null;
  authority: string | null;
  limitations: string[];
}

/** A captured payload (body, screenshot, DOM text) after the daemon checked it against its recorded hash. */
export interface ReaPayload {
  state: ObservedBodyState | 'captured-binary' | 'omitted';
  mediaType: string | null;
  bytes: number | null;
  sha256: string | null;
  redacted: boolean;
  /** Why the payload has no content: REA's reason, or the size limit the daemon applied. */
  reason?: string;
  /** Text for display: pretty JSON, DOM or accessibility text. Cut at {@link REA_TEXT_LIMIT} characters. */
  text?: string;
  truncated?: boolean;
  /** `data:` URL for a captured image. */
  dataUrl?: string;
}

export const REA_TEXT_LIMIT = 32 * 1024;

export interface ReaBrowserStep {
  index: number;
  id: string;
  action: string;
  status: string;
  elapsedMs: number | null;
  url: string | null;
  /** First and last transaction sequence this step produced (REA's `event_sequence_*`); both 0 when it produced none. */
  eventStart: number;
  eventEnd: number;
  error: string | null;
  screenshot?: ReaPayload;
  dom?: ReaPayload;
  accessibility?: ReaPayload;
}

export interface ReaBrowserRequest {
  /** REA's transaction ID. */
  id: string;
  stepIndex: number;
  method: string;
  origin: string | null;
  path: string;
  queryNames: string[];
  resourceType: string;
  status: number | null;
  failure?: string;
  isApi: boolean;
  request: ReaPayload;
  response: ReaPayload;
}

export interface ReaCompleteness {
  status: string;
  missingSections: string[];
  truncatedSections: string[];
}

export interface ReaBrowserView {
  kind: 'browser';
  origin: string | null;
  durationMs: number | null;
  steps: ReaBrowserStep[];
  requests: ReaBrowserRequest[];
  completeness: ReaCompleteness;
  /** What the scenario asked REA to retain. */
  captured: { requestBodies: boolean; responseBodies: boolean };
  droppedEvents: number;
}

export interface ReaSqliteColumn {
  name: string;
  type: string;
  notNull: boolean;
  /** 1-based position in the primary key, 0 when the column is not part of it. */
  primaryKey: number;
  defaultSql: string | null;
}

export interface ReaSqliteForeignKey {
  column: string;
  refTable: string;
  refColumn: string;
}

export interface ReaSqliteRows {
  columns: string[];
  values: string[][];
  returned: number;
  truncated: boolean;
}

export interface ReaSqliteTable {
  name: string;
  columns: ReaSqliteColumn[];
  foreignKeys: ReaSqliteForeignKey[];
  /** Column names, or `a, b` for a composite constraint. */
  unique: string[];
  checks: string[];
  indexes: string[];
  rows?: ReaSqliteRows;
}

export interface ReaSqliteView {
  kind: 'sqlite';
  engine: string;
  encoding: string | null;
  bytes: number | null;
  sha256: string | null;
  completeness: string;
  tables: ReaSqliteTable[];
  views: string[];
  triggers: string[];
}

export interface ReaStaticNode {
  id: string;
  kind: string;
  label: string;
}

export interface ReaStaticEdge {
  from: string;
  to: string;
  relation: string;
}

export interface ReaStaticView {
  kind: 'static';
  format: string | null;
  /** REA's own counters (`relevant_files`, `parsed_javascript_files`, ...), in REA's order. */
  statistics: Array<{ key: string; value: number }>;
  applicationCoverage: string | null;
  semanticCoverage: string | null;
  semanticUnknowns: number;
  /** The most frequent reasons the semantic graph could not resolve something. */
  unknownReasons: Array<{ reason: string; count: number }>;
  nodes: ReaStaticNode[];
  edges: ReaStaticEdge[];
  nodeTotal: number;
  edgeTotal: number;
}

export interface ReaTraceView {
  kind: 'trace';
  seed: string;
  direction: string;
  status: string;
  matches: number;
  tracedNodes: number;
  terminalPaths: number;
  /** Every path as the labels of its steps. */
  paths: string[][];
}

export interface ReaOtherView {
  kind: 'view' | 'other';
  /** Short facts REA put in the result: `parent_operation`, a summary's own counters... */
  facts: Array<{ key: string; value: string }>;
}

export type ReaEvidenceBody = ReaBrowserView | ReaSqliteView | ReaStaticView | ReaTraceView | ReaOtherView;

export type ReaEvidenceView = ReaEvidenceBody & {
  ok: true;
  file: string;
  envelope: ReaEnvelope;
  /** Unknowns and open points REA listed, carried over unchanged. */
  unknowns: string[];
};

export interface ReaEvidenceViewRequest {
  file: string;
}

/** Evidence kind from the envelope's predicate and operation. */
export function classifyReaEvidence(predicate: string, operation: string): ReaEvidenceKind {
  if (predicate === 'rea.browser-scenario-capture' || operation === 'capture_browser_scenario') return 'browser';
  if (operation === 'inspect_sqlite_database') return 'sqlite';
  if (operation === 'analyze_javascript_application') return 'static';
  if (predicate === 'rea.application-feature-trace' || operation === 'trace_application_feature') return 'trace';
  if (predicate === 'rea.analysis-view' || operation === 'inspect_analysis_view') return 'view';
  return 'other';
}

export interface SqliteConstraints {
  foreignKeys: ReaSqliteForeignKey[];
  unique: string[];
  checks: string[];
}

/** Split on commas that are not inside parentheses or quotes. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (const char of text) {
    if (quote) {
      current += char;
      if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; current += char; continue; }
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) { parts.push(current.trim()); current = ''; continue; }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** The text inside the parentheses that start at `from` (which must point at `(`). */
function balanced(text: string, from: number): string {
  let depth = 0;
  let quote = '';
  for (let i = from; i < text.length; i += 1) {
    const char = text[i]!;
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === '(') depth += 1;
    if (char === ')') { depth -= 1; if (depth === 0) return text.slice(from + 1, i); }
  }
  return text.slice(from + 1);
}

const unquote = (name: string) => name.trim().replace(/^["`[]|["`\]]$/g, '');

/**
 * REA lists a table's columns but not its constraints; they are in the `CREATE TABLE` text. This reads foreign keys,
 * UNIQUE and CHECK constraints from it, both inline (`order_id INTEGER UNIQUE REFERENCES orders(id)`) and as table
 * constraints. It is a reading of declarations, which says nothing about whether the connection enforced them.
 */
export function parseSqliteConstraints(sql: string | null | undefined): SqliteConstraints {
  const out: SqliteConstraints = { foreignKeys: [], unique: [], checks: [] };
  const open = sql ? sql.indexOf('(') : -1;
  if (!sql || open < 0) return out;
  for (const definition of splitTopLevel(balanced(sql, open))) {
    const column = definition.match(/^(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|(\w+))/);
    const name = column ? (column[1] ?? column[2] ?? column[3] ?? column[4] ?? '') : '';
    const tableConstraint = /^(?:CONSTRAINT\s+\S+\s+)?(?:PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY)\b/i.test(definition);
    for (const check of definition.matchAll(/\bCHECK\s*\(/gi)) {
      out.checks.push(balanced(definition, check.index! + check[0].length - 1).replace(/\s+/g, ' ').trim());
    }
    if (tableConstraint) {
      const foreign = definition.match(/FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+("[^"]+"|`[^`]+`|\[[^\]]+\]|\w+)\s*(?:\(([^)]*)\))?/i);
      if (foreign) {
        const from = foreign[1]!.split(',').map(unquote);
        const to = (foreign[3] ?? '').split(',').map(unquote);
        from.forEach((column, index) => out.foreignKeys.push({ column, refTable: unquote(foreign[2]!), refColumn: to[index] || 'id' }));
      }
      const unique = definition.match(/^(?:CONSTRAINT\s+\S+\s+)?UNIQUE\s*\(([^)]*)\)/i);
      if (unique) out.unique.push(unique[1]!.split(',').map(unquote).join(', '));
      continue;
    }
    const reference = definition.match(/\bREFERENCES\s+("[^"]+"|`[^`]+`|\[[^\]]+\]|\w+)\s*(?:\(([^)]*)\))?/i);
    if (reference && name) out.foreignKeys.push({ column: name, refTable: unquote(reference[1]!), refColumn: unquote((reference[2] ?? '').split(',')[0] ?? '') || 'id' });
    if (name && /\bUNIQUE\b/i.test(definition.replace(/\bCHECK\s*\([\s\S]*\)/gi, ''))) out.unique.push(name);
  }
  return out;
}

// ── Citing evidence in a conversation ──────────────────────────────────────

/** The part of an evidence file a citation points at. */
export type ReaCiteTarget =
  | { kind: 'file' }
  | { kind: 'step'; index: number }
  | { kind: 'request'; id: string }
  | { kind: 'table'; name: string }
  | { kind: 'node'; id: string }
  | { kind: 'path'; index: number };

export interface ReaCiteRequest {
  file: string;
  target: ReaCiteTarget;
  /**
   * Quote captured values (body excerpts, DOM text, SQLite rows). They are real application data, so by default a
   * citation carries their structure only: JSON keys and types, column names.
   */
  includeValues?: boolean;
}

/**
 * One evidence item, ready to quote in a prompt. `block` is the same text in the chat composer and in
 * `monofield rea cite`, so a person and an external agent cite evidence the same way.
 */
export interface ReaCitation {
  ok: true;
  file: string;
  evidenceId: string;
  /** Where the item is in the evidence file, e.g. `steps[2]` or `schema.tables[name=orders]`. */
  pointer: string;
  /** One line that names the item. */
  label: string;
  block: string;
  /** Project files written for the citation (a step's verified screenshot), so an agent can open them. */
  files: string[];
  valuesIncluded: boolean;
}

// ── Comparing an original with a remake ────────────────────────────────────

export type ReaCompareVerdict = 'pass' | 'fail' | 'missing' | 'extra';
/** Why a step pair failed. */
export type ReaStepDifference = 'action' | 'status' | 'url' | 'calls' | 'text';

export interface ReaCompareStepSide {
  index: number;
  id: string;
  action: string;
  status: string;
  /** Path of the page after the step, without the origin (the remake usually runs elsewhere). */
  path: string | null;
}

/** One API route in a step: the statuses each side received, in order. */
export interface ReaCompareCall {
  method: string;
  /** The path with numeric and ID-like segments replaced by `{n}` / `{id}`, so `/orders/1001` and `/orders/7` match. */
  route: string;
  original: number[];
  remake: number[];
  same: boolean;
}

export interface ReaCompareStepRow {
  position: number;
  original: ReaCompareStepSide | null;
  remake: ReaCompareStepSide | null;
  verdict: ReaCompareVerdict;
  differences: ReaStepDifference[];
  calls: ReaCompareCall[];
  /**
   * Screen lines only one side has. They come from the accessibility snapshot when both sides captured one (roles and
   * names, no styling), else from the text of the captured HTML. `compared` is false when a side captured neither.
   */
  text: { compared: boolean; source: 'accessibility' | 'dom' | null; onlyOriginal: string[]; onlyRemake: string[] };
  /** Whether each side has a verified screenshot for the step, for the side-by-side view. */
  screenshots: { original: boolean; remake: boolean };
}

export interface ReaCompareSummary {
  total: number;
  pass: number;
  fail: number;
  missing: number;
  extra: number;
}

export interface ReaBrowserComparison {
  kind: 'browser';
  steps: ReaCompareStepRow[];
  textCompared: boolean;
}

/**
 * Case results: `{ "cases": [{ "id"?, "input"?, "output" }] }`, one file run on the original and one on the remake
 * (a harness the agent writes prints them). Cases are matched by `id`, else by `input`, else by position.
 */
export interface ReaCaseRow {
  key: string;
  input: string | null;
  original: string | null;
  remake: string | null;
  verdict: ReaCompareVerdict;
  /** JSON path of the first difference, e.g. `$.pan` or `$[2]`. */
  at?: string;
}

export interface ReaCaseComparison {
  kind: 'cases';
  /** Largest absolute difference two numbers may have and still count as equal. */
  tolerance: number;
  /** Rows that did not pass come first (fail, missing, extra), then the passing ones, each in file order. */
  rows: ReaCaseRow[];
  /** More rows than {@link REA_COMPARE_ROW_LIMIT}: the summary counts all of them, `rows` holds the first ones. */
  truncated: boolean;
}

export const REA_COMPARE_ROW_LIMIT = 2000;

export type ReaComparison = (ReaBrowserComparison | ReaCaseComparison) & {
  ok: true;
  original: string;
  remake: string;
  summary: ReaCompareSummary;
  /** The comparison as plain text: what `monofield rea compare` prints, and what the screen puts into the chat. */
  report: string;
};

export interface ReaCompareRequest {
  original: string;
  remake: string;
  /** Cases only. Default 0: outputs must be equal. */
  tolerance?: number;
  /** Browser only. Default true; false compares action, status, page path and API calls but not visible text. */
  compareText?: boolean;
}

// ── Setup check ────────────────────────────────────────────────────────────

/** The REA release MonoField's MCP template pins, and the Node.js range its package declares (`engines.node`). */
export const REA_PACKAGE = { name: 'rea-agents', version: '6.7.0', node: '^22.19.0 || ^24.11.0 || >=26.0.0' } as const;

export type ReaDoctorCheckId = 'node' | 'npx' | 'browser' | 'mcp' | 'ghidra' | 'native' | 'java' | 'jadx' | 'apktool' | 'tshark' | 'adb';
export type ReaDoctorStatus = 'ok' | 'warn' | 'missing';

export interface ReaDoctorCheck {
  id: ReaDoctorCheckId;
  status: ReaDoctorStatus;
  /** Needed for REA to start at all; the others are needed only for some targets. */
  required: boolean;
  /** What was found: a version, an executable path, an MCP command line. */
  found: string | null;
  /**
   * A short machine-readable note: `outside-range`, `disabled`, `other-version`, `custom-command`; for GHIDRA_INSTALL_DIR
   * and JAVA_HOME `not-set`, `empty-value` or `not-absolute` (REA refuses to start with either, so the check is then
   * required), `no-analyze-headless`, `no-java`.
   */
  note?: string;
}

export interface ReaDoctorResponse {
  ok: true;
  /** Every required check passed. It does not start REA: whether the agent lists REA's tools is seen in a conversation. */
  ready: boolean;
  platform: string;
  package: typeof REA_PACKAGE;
  checks: ReaDoctorCheck[];
}

/**
 * Whether a Node.js version (`v24.11.1` or `24.11.1`) satisfies a range made of `^x.y.z` and `>=x.y.z` parts joined
 * by `||`, the only forms {@link REA_PACKAGE} uses. Pre-release tags are ignored.
 */
export function satisfiesNodeRange(version: string, range: string): boolean {
  const parse = (text: string) => {
    const match = text.trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] as const : null;
  };
  const have = parse(version);
  if (!have) return false;
  const atLeast = (want: readonly [number, number, number]) => have[0] !== want[0] ? have[0] > want[0] : have[1] !== want[1] ? have[1] > want[1] : have[2] >= want[2];
  return range.split('||').some((part) => {
    const term = part.trim();
    const want = parse(term.replace(/^(\^|>=)/, ''));
    if (!want) return false;
    if (term.startsWith('^')) return have[0] === want[0] && atLeast(want);
    if (term.startsWith('>=')) return atLeast(want);
    return have[0] === want[0] && have[1] === want[1] && have[2] === want[2];
  });
}
