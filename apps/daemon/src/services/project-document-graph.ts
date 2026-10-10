import path from 'node:path';
import { parseInterfaceSpecDocument, parseScreenSpecDocument, type DatabaseSchemaWatchState } from '@open-design/contracts';
import { buildDocumentGraph, type GraphDocument } from './document-graph.js';
import { analyzeDocumentImpact, workingProjectChanges } from './document-impact.js';
import { projectRelativePath } from './change-policy.js';

export function isDocumentPath(value: unknown): value is string {
  return typeof value === 'string' && /\.json$/i.test(value) && value.length <= 1024
    && projectRelativePath(value.replace(/\\/g, '/').replace(/^(?:\.\/)+/, ''));
}
export async function loadProjectDocumentGraph(options: {
  projectRoot: string; inputFiles: unknown;
  list: () => Promise<string[]>;
  read: (name: string) => Promise<{ name: string; buffer: Buffer }>;
  schemaWatch: DatabaseSchemaWatchState | null;
}) {
  const explicit = options.inputFiles !== undefined;
  const inputs: unknown = explicit ? options.inputFiles : (await options.list()).filter(name => /\.json$/i.test(name) && !/\.proposed\.json$/i.test(name));
  if (!Array.isArray(inputs) || inputs.length > 200 || !inputs.every(isDocumentPath)) throw new Error('Select at most 200 project-relative JSON files for graph analysis.');
  const documents: GraphDocument[] = [], warnings: string[] = [];
  const current = await workingProjectChanges(options.projectRoot);
  const changedFiles = new Set(current.changedFiles);
  if (!current.repository) warnings.push('Git change coverage unavailable for this project.');
  let totalBytes = 0;
  for (const name of [...new Set((inputs as string[]).map(name => path.posix.normalize(name.replace(/\\/g, '/'))))]) {
    const file = await options.read(name);
    totalBytes += file.buffer.length;
    if (file.buffer.length > 2 * 1024 * 1024 || totalBytes > 20 * 1024 * 1024) throw new Error('Graph analysis is limited to 2 MB per document and 20 MB total.');
    let value: unknown;
    try { value = JSON.parse(file.buffer.toString('utf8')); } catch { if (explicit) warnings.push(`Invalid JSON: ${name}`); continue; }
    const kind = (value as { kind?: string } | null)?.kind;
    if (kind !== 'interface-spec' && kind !== 'screen-spec') { if (explicit) warnings.push(`Not a specification document: ${name}`); continue; }
    const parsed = kind === 'interface-spec' ? parseInterfaceSpecDocument(value) : parseScreenSpecDocument(value);
    if (!parsed.ok) { warnings.push(`Invalid specification: ${name}`); continue; }
    documents.push({ file: file.name, doc: parsed.doc });
    if (parsed.doc.kind === 'interface-spec') {
      const impact = await analyzeDocumentImpact({ projectRoot: options.projectRoot, inputFile: file.name, content: file.buffer, doc: parsed.doc });
      for (const changed of impact.changedFiles) changedFiles.add(path.posix.normalize(path.posix.join(parsed.doc.source.codebasePath?.replace(/\\/g, '/') || '.', changed)));
      if (!impact.repository) warnings.push(`Git change coverage unavailable: ${name}`);
    }
  }
  return { graph: buildDocumentGraph({ documents, changedFiles: [...changedFiles], schemaWatch: options.schemaWatch, warnings }), changedFiles: [...changedFiles] };
}
