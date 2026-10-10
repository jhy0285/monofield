import type { Express } from 'express';
import { createHash } from 'node:crypto';
import { applyInterfaceSpecProposal, parseInterfaceSpecDocument, validateInterfaceSpecDocument } from '@open-design/contracts';
import { getProject } from '../db.js';
import { resolveProjectDir, resolveProjectFilePath, listFiles } from '../projects.js';
import { isDocumentPath, loadProjectDocumentGraph } from '../services/project-document-graph.js';
import { buildChangePlan } from '../services/change-plan.js';
import { parseChangePolicy } from '../services/change-policy.js';
import { discoverVerificationChecks } from '../services/verification-discovery.js';
import { verificationSource } from '../services/verification-source.js';
import type { DatabaseSchemaWatchService } from '../services/database-schema-watch.js';
import { analyzeDocumentImpact } from '../services/document-impact.js';
import type { RouteDeps } from '../server-context.js';

export interface RegisterDocumentImpactRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'projectFiles' | 'verification'> { schemaWatch: DatabaseSchemaWatchService }

export function registerDocumentImpactRoutes(app: Express, deps: RegisterDocumentImpactRoutesDeps): void {
  async function selected(id: string) {
    const project = getProject(deps.db, id);
    if (!project) throw Object.assign(new Error('Project not found.'), { status: 404 });
    const root = resolveProjectDir(deps.paths.PROJECTS_DIR, id, project.metadata);
    const read = async (name: string) => {
      const info = await resolveProjectFilePath(deps.paths.PROJECTS_DIR, id, name, project.metadata);
      if (info.size > 2 * 1024 * 1024) throw new Error('Document exceeds the 2 MB analysis limit.');
      return deps.projectFiles.readProjectFile(deps.paths.PROJECTS_DIR, id, name, project.metadata);
    };
    const load = (inputFiles: unknown) => loadProjectDocumentGraph({
      projectRoot: root, inputFiles, read,
      list: async () => (await listFiles(deps.paths.PROJECTS_DIR, id, { metadata: project.metadata })).map(file => file.name),
      schemaWatch: deps.schemaWatch.get(id),
    });
    return { root, read, load };
  }
  const fail = (res: import('express').Response, error: unknown, code: string) => {
    const status = Number((error as { status?: number })?.status) || 400;
    deps.http.sendApiError(res, status, status === 404 ? 'PROJECT_NOT_FOUND' : code, error instanceof Error ? error.message : String(error));
  };
  app.post('/api/projects/:id/documents/graph', deps.http.requireLocalDaemonRequest, async (req, res) => {
    try {
      const target = await selected(req.params.id);
      res.set('Cache-Control', 'no-store').json((await target.load(req.body?.inputFiles)).graph);
    } catch (error) { fail(res, error, 'DOCUMENT_GRAPH_FAILED'); }
  });
  app.post('/api/projects/:id/documents/plan', deps.http.requireLocalDaemonRequest, async (req, res) => {
    const started = performance.now();
    try {
      const body = req.body ?? {};
      if (body.request !== undefined && (typeof body.request !== 'string' || body.request.length > 2000)) throw new Error('request must be text of at most 2000 characters');
      if (body.simulateNodeIds !== undefined && (!Array.isArray(body.simulateNodeIds) || body.simulateNodeIds.length > 32
        || body.simulateNodeIds.some((id: unknown) => typeof id !== 'string' || id.length > 4096))) throw new Error('Select at most 32 graph node IDs');
      if (body.rulesFile !== undefined && !isDocumentPath(body.rulesFile)) throw new Error('rulesFile must be a project-relative JSON file');
      const target = await selected(req.params.id);
      const before = await verificationSource(target.root);
      const { graph, changedFiles } = await target.load(body.inputFiles);
      const policy = body.rulesFile === undefined ? undefined : parseChangePolicy(JSON.parse((await target.read(body.rulesFile)).buffer.toString('utf8')));
      const checks = await discoverVerificationChecks(target.root);
      const status = await deps.verification.status(req.params.id, '.', target.root, undefined, true);
      const source = await verificationSource(target.root);
      if (before.digest && source.digest && before.digest !== source.digest) throw Object.assign(new Error('Project source changed during planning. Analyze again.'), { status: 409 });
      if (!before.digest) { source.digest = null; source.reason = before.reason; }
      const report = buildChangePlan({ graph, changedFiles, checks, source, receipt: status.run,
        ...(policy ? { policy } : {}), ...(body.simulateNodeIds ? { simulateNodeIds: body.simulateNodeIds } : {}),
        ...(body.request === undefined ? {} : { request: body.request }),
      });
      report.elapsedMs = Math.round(performance.now() - started);
      res.set('Cache-Control', 'no-store').json(report);
    } catch (error) { fail(res, error, 'CHANGE_PLAN_FAILED'); }
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
