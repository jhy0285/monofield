import type { Express } from 'express';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { applyInterfaceSpecProposal, parseInterfaceSpecDocument, parseScreenSpecDocument, validateInterfaceSpecDocument } from '@open-design/contracts';
import { getProject } from '../db.js';
import { resolveProjectDir, resolveProjectFilePath, listFiles } from '../projects.js';
import { buildDocumentGraph, type GraphDocument } from '../services/document-graph.js';
import type { DatabaseSchemaWatchService } from '../services/database-schema-watch.js';
import { analyzeDocumentImpact } from '../services/document-impact.js';
import type { RouteDeps } from '../server-context.js';

export interface RegisterDocumentImpactRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'projectFiles'> { schemaWatch: DatabaseSchemaWatchService }

function isDocumentPath(value: unknown): value is string {
  return typeof value === 'string' && /\.json$/i.test(value) && value.length <= 1024
    && !path.isAbsolute(value) && !/^[a-z]:/i.test(value)
    && !value.replace(/\\/g, '/').split('/').includes('..');
}

export function registerDocumentImpactRoutes(app: Express, deps: RegisterDocumentImpactRoutesDeps): void {
  app.post('/api/projects/:id/documents/graph', deps.http.requireLocalDaemonRequest, async (req, res) => {
    try {
      const project = getProject(deps.db, req.params.id);
      if (!project) { res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } }); return; }
      let inputs: unknown = req.body?.inputFiles;
      const explicit = inputs !== undefined;
      if (!explicit) inputs = (await listFiles(deps.paths.PROJECTS_DIR, project.id, { metadata: project.metadata })).filter((file) => /\.json$/i.test(file.name) && !/\.proposed\.json$/i.test(file.name)).map((file) => file.name);
      if (!Array.isArray(inputs) || inputs.length > 200 || !inputs.every(isDocumentPath)) throw new Error('Select at most 200 project-relative JSON files for graph analysis.');
      const documents: GraphDocument[] = [], changedFiles = new Set<string>(), warnings: string[] = [];
      let totalBytes = 0;
      for (const name of [...new Set(inputs as string[])]) {
        const info = await resolveProjectFilePath(deps.paths.PROJECTS_DIR, project.id, name, project.metadata);
        if (info.size > 2 * 1024 * 1024 || totalBytes + info.size > 20 * 1024 * 1024) throw new Error('Graph analysis is limited to 2 MB per document and 20 MB total.');
        const file = await deps.projectFiles.readProjectFile(deps.paths.PROJECTS_DIR, project.id, name, project.metadata);
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
          const impact = await analyzeDocumentImpact({ projectRoot: resolveProjectDir(deps.paths.PROJECTS_DIR, project.id, project.metadata),
            inputFile: file.name, content: file.buffer, doc: parsed.doc });
          for (const changed of impact.changedFiles) changedFiles.add(path.posix.normalize(path.posix.join(parsed.doc.source.codebasePath?.replace(/\\/g, '/') || '.', changed)));
          if (!impact.repository) warnings.push(`Git change coverage unavailable: ${name}`);
        }
      }
      res.set('Cache-Control', 'no-store');
      res.json(buildDocumentGraph({ documents, changedFiles: [...changedFiles], schemaWatch: deps.schemaWatch.get(project.id), warnings }));
    } catch (error) { res.status(400).json({ error: { code: 'DOCUMENT_GRAPH_FAILED', message: error instanceof Error ? error.message : 'Graph analysis failed.' } }); }
  });
  app.post('/api/projects/:id/documents/impact', deps.http.requireLocalDaemonRequest, async (req, res) => {
    try {
      const inputFile: unknown = req.body?.inputFile;
      if (!isDocumentPath(inputFile)) {
        res.status(400).json({ error: { code: 'INVALID_DOCUMENT', message: 'inputFile must be a project-relative JSON document path.' } });
        return;
      }
      const project = getProject(deps.db, req.params.id);
      if (!project) { res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } }); return; }
      const file = await deps.projectFiles.readProjectFile(deps.paths.PROJECTS_DIR, project.id, inputFile, project.metadata);
      if (file.buffer.length > 2 * 1024 * 1024) throw new Error('The document exceeds the 2 MB analysis limit.');
      const parsed = parseInterfaceSpecDocument(JSON.parse(file.buffer.toString('utf8')));
      if (!parsed.ok) throw new Error(parsed.error);
      res.set('Cache-Control', 'no-store');
      res.json(await analyzeDocumentImpact({
        projectRoot: resolveProjectDir(deps.paths.PROJECTS_DIR, project.id, project.metadata),
        projectId: project.id, inputFile: file.name, content: file.buffer, doc: parsed.doc,
      }));
    } catch (error) {
      res.status(400).json({ error: { code: 'DOCUMENT_IMPACT_FAILED', message: error instanceof Error ? error.message : String(error) } });
    }
  });

  app.post('/api/projects/:id/documents/proposal', deps.http.requireLocalDaemonRequest, async (req, res) => {
    try {
      const { inputFile, proposalFile, expectedContentSha256, includeDocument = true } = req.body ?? {};
      if (!isDocumentPath(inputFile) || !isDocumentPath(proposalFile)
        || typeof expectedContentSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedContentSha256)
        || typeof includeDocument !== 'boolean' || inputFile === proposalFile) {
        res.status(400).json({ error: { code: 'INVALID_DOCUMENT', message: 'Valid original, proposal and source hash are required.' } });
        return;
      }
      const project = getProject(deps.db, req.params.id);
      if (!project) { res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } }); return; }
      const original = await deps.projectFiles.readProjectFile(deps.paths.PROJECTS_DIR, project.id, inputFile, project.metadata);
      const contentSha256 = createHash('sha256').update(original.buffer).digest('hex');
      if (contentSha256 !== expectedContentSha256.toLowerCase()) {
        res.status(409).json({ error: { code: 'FILE_CHANGED', message: 'The original document changed after analysis.' } });
        return;
      }
      const proposal = await deps.projectFiles.readProjectFile(deps.paths.PROJECTS_DIR, project.id, proposalFile, project.metadata);
      if (original.buffer.length > 2 * 1024 * 1024 || proposal.buffer.length > 2 * 1024 * 1024) throw new Error('Document review is limited to 2 MB per file.');
      const parsedOriginal = parseInterfaceSpecDocument(JSON.parse(original.buffer.toString('utf8')));
      if (!parsedOriginal.ok) throw new Error(parsedOriginal.error);
      const candidate = JSON.parse(proposal.buffer.toString('utf8'));
      const incremental = candidate?.kind === 'interface-spec-proposal';
      const result = incremental
        ? applyInterfaceSpecProposal(parsedOriginal.doc, contentSha256, candidate)
        : parseInterfaceSpecDocument(candidate);
      if (!result.ok) throw new Error(result.error);
      const fatal = validateInterfaceSpecDocument(result.doc).filter((issue) => issue.severity === 'fatal');
      if (fatal.length) throw new Error(fatal.map((issue) => issue.message).join('\n'));
      res.set('Cache-Control', 'no-store');
      res.json({ ok: true, inputFile: original.name, proposalFile: proposal.name, contentSha256,
        format: incremental ? 'changes' : 'complete', changesApplied: 'changesApplied' in result ? result.changesApplied : null,
        ...(includeDocument ? { document: result.doc } : {}),
      });
    } catch (error) {
      res.status(400).json({ error: { code: 'DOCUMENT_PROPOSAL_INVALID', message: error instanceof Error ? error.message : String(error) } });
    }
  });
}
