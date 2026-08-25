import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export type DatabaseCandidateEvidence = {
  path: string;
  line: number;
  reason: string;
};

export type DatabaseCandidate = {
  schema: string | null;
  table: string;
  evidence: DatabaseCandidateEvidence[];
};

const TEXT_EXTENSIONS = new Set([
  '.cs', '.go', '.java', '.js', '.jsx', '.kt', '.php', '.py', '.rb',
  '.sql', '.ts', '.tsx', '.xml', '.yaml', '.yml',
]);
const SKIP_PARTS = new Set(['.git', '.next', 'build', 'coverage', 'dist', 'node_modules', 'target', 'vendor']);
const RESERVED_IDENTIFIERS = new Set(['DELETE', 'FROM', 'GET', 'INTO', 'PATCH', 'POST', 'PUT', 'SELECT', 'UPDATE']);
const PATTERNS: Array<{ reason: string; pattern: RegExp }> = [
  { reason: 'JPA @Table', pattern: /@Table\s*\((?:(?:[^)]*?\bname\s*=\s*)?["'](?<table>[A-Za-z_][\w$-]*)["']|[^)]*?\bname\s*=\s*["'](?<tableNamed>[A-Za-z_][\w$-]*)["'])[^)]*\)/gi },
  { reason: 'JPA @JoinTable', pattern: /@JoinTable\s*\([^)]*?\bname\s*=\s*["'](?<table>[A-Za-z_][\w$-]*)["']/gi },
  { reason: 'TypeORM @Entity', pattern: /@Entity\s*\(\s*(?:\{[^}]*?\bname\s*:\s*)?["'](?<table>[A-Za-z_][\w$-]*)["']/gi },
  { reason: 'Django db_table', pattern: /\bdb_table\s*=\s*["'](?<table>[A-Za-z_][\w$-]*)["']/gi },
  { reason: 'Sequelize tableName', pattern: /\btableName\s*:\s*["'](?<table>[A-Za-z_][\w$-]*)["']/gi },
  { reason: 'GORM TableName', pattern: /\bTableName\s*\(\s*\)\s*[^\{]*\{[^}]*?return\s+["'](?<table>[A-Za-z_][\w$-]*)["']/gis },
  { reason: 'SQL reference', pattern: /\b(?:FROM|JOIN|INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO)\s+(?:(?<schema>[A-Za-z_][\w$-]*)\s*\.)?(?<table>[A-Za-z_][\w$-]*)/gi },
];

function addMatch(
  candidates: Map<string, DatabaseCandidate>,
  table: string,
  schema: string | null,
  root: string,
  filePath: string,
  line: number,
  reason: string,
): void {
  if (!/^[A-Za-z_][\w$-]*$/.test(table) || RESERVED_IDENTIFIERS.has(table.toUpperCase()) || table.startsWith('__')) return;
  const relativePath = path.relative(root, filePath).split(path.sep).join('/');
  const key = `${schema?.toLowerCase() ?? ''}.${table.toLowerCase()}`;
  const candidate = candidates.get(key) ?? { schema, table, evidence: [] };
  if (!candidate.evidence.some((item) => item.path === relativePath && item.line === line && item.reason === reason)) {
    candidate.evidence.push({ path: relativePath, line, reason });
  }
  candidates.set(key, candidate);
}

async function walk(root: string, current: string, out: Array<{ root: string; file: string }>): Promise<void> {
  let entries;
  try { entries = await readdir(current, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP_PARTS.has(entry.name)) continue;
    const file = path.join(current, entry.name);
    if (entry.isDirectory()) await walk(root, file, out);
    else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) out.push({ root, file });
  }
}

export async function scanDatabaseCandidates(roots: string[], schemas: string[] = []): Promise<DatabaseCandidate[]> {
  const files: Array<{ root: string; file: string }> = [];
  for (const root of [...new Set(roots.map((item) => path.resolve(item)))]) {
    try { if ((await stat(root)).isDirectory()) await walk(root, root, files); } catch { /* inaccessible linked dirs are skipped */ }
  }
  const candidates = new Map<string, DatabaseCandidate>();
  const defaultSchema = schemas.length === 1 ? schemas[0] : null;
  for (const { root, file } of files) {
    let text: string;
    try { text = await readFile(file, 'utf8'); } catch { continue; }
    const lines = text.split(/\r?\n/);
    for (const { reason, pattern } of PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        const groups = match.groups ?? {};
        const table = groups.table ?? groups.tableNamed;
        if (!table) continue;
        const line = text.slice(0, match.index ?? 0).split('\n').length;
        const lineText = lines[line - 1] ?? '';
        const isSqlReference = reason === 'SQL reference';
        if (isSqlReference && path.extname(file).toLowerCase() !== '.sql'
          && !/\b(?:select|insert|update|delete|join|query|sql|execute|raw\s*\()/i.test(lineText)) continue;
        addMatch(candidates, table, groups.schema ?? defaultSchema ?? null, root, file, line, reason);
      }
    }
  }
  return [...candidates.values()].sort((a, b) => `${a.schema ?? ''}.${a.table}`.localeCompare(`${b.schema ?? ''}.${b.table}`));
}
