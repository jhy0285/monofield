import type { Express } from 'express';
import { createHash } from 'node:crypto';
import { getProject } from '../db.js';
import { resolveProjectDir } from '../projects.js';
import { resolveDevelopmentProjectRoot } from '../development-projects.js';
import type { RouteDeps } from '../server-context.js';
import { buildCodeOntology } from '../services/code-ontology.js';
import { projectRelativePath } from '../services/change-policy.js';
import { parseChangePolicy } from '../services/change-policy.js';
import { mergeOntologyDocuments, documentReviews, simulationSourceNodes } from '../services/ontology/change-graph.js';
import { loadProjectDocumentGraph, isDocumentPath } from '../services/project-document-graph.js';
import { resolveProjectFilePath, listFiles } from '../projects.js';
import { buildChangePlan } from '../services/change-plan.js';
import { discoverVerificationChecks } from '../services/verification-discovery.js';
import { verificationSource } from '../services/verification-source.js';
import {workspaceVerificationReceipt}from '../services/ontology/verification-receipt.js';
import { RecordedDependencyGraph } from '../services/ontology/recorded-graph.js';
import { prepareOntologyContext } from '../services/ontology/context.js';
import type { DatabaseSchemaWatchService } from '../services/database-schema-watch.js';

export interface RegisterCodeOntologyRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'projectFiles' | 'verification'> { schemaWatch: DatabaseSchemaWatchService }
export function registerCodeOntologyRoutes(app: Express, deps: RegisterCodeOntologyRoutesDeps): void {
  app.post('/api/projects/:id/ontology/context', deps.http.requireLocalDaemonRequest, async (req, res) => {
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    req.once('aborted', abort); res.once('close', abort);
    try {
      const project = getProject(deps.db, req.params.id);
      if (!project) throw Object.assign(new Error('Project not found'), { status: 404 });
      const body = req.body ?? {}, businessFiles: unknown = body.businessFiles ?? [];
      if (body.projectPath != null && typeof body.projectPath !== 'string') throw new Error('projectPath must be a string');
      if (!Array.isArray(businessFiles) || businessFiles.length > 16 || businessFiles.some(name => typeof name !== 'string' || !projectRelativePath(name) || !/\.(md|txt)$/i.test(name))) throw new Error('Select at most 16 module-relative Markdown/TXT business documents');
      if (typeof body.request !== 'string' || !body.request.trim() || body.request.length > 2000) throw new Error('Provide a question of 1–2000 characters');
      const maxBytes = body.maxBytes ?? 4096, focusNodeIds = body.focusNodeIds ?? [];
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 2048 || maxBytes > 24000) throw new Error('Context budget must be 2048–24000 UTF-8 bytes');
      if (!Array.isArray(focusNodeIds) || focusNodeIds.length > 8 || focusNodeIds.some(id => typeof id !== 'string' || id.length > 100)) throw new Error('Select at most 8 existing node IDs');
      if (body.localJudge !== undefined && typeof body.localJudge !== 'boolean') throw new Error('localJudge must be boolean');
      if (body.evidenceMode !== undefined && !['references','excerpts'].includes(body.evidenceMode)) throw new Error('Select references or excerpts evidence mode');
      const workspaceRoot = resolveProjectDir(deps.paths.PROJECTS_DIR, project.id, project.metadata);
      const target = body.projectPath === '.' ? { root: workspaceRoot, project: { path: '.' } }
        : await resolveDevelopmentProjectRoot(workspaceRoot, body.projectPath ?? project.metadata?.development?.activeProjectPath ?? null);
      const ontology = await buildCodeOntology(deps.paths.RUNTIME_DATA_DIR, project.id, target.root, target.project.path, [...new Set(businessFiles as string[])], body.request, controller.signal);
      const prefix = target.project.path === '.' ? '' : target.project.path + '/';
      const result = await prepareOntologyContext({ ontology, question: body.request.trim(), maxBytes, focusNodeIds, localJudge: body.localJudge === true, evidenceMode: body.evidenceMode ?? 'references', dataDir: deps.paths.RUNTIME_DATA_DIR, signal: controller.signal,
        read: async (path) => {
          const info = await resolveProjectFilePath(deps.paths.PROJECTS_DIR, project.id, prefix + path, project.metadata);
          if (info.size > 512 * 1024) throw new Error('Context evidence exceeds the 512 KiB file limit');
          return (await deps.projectFiles.readProjectFile(deps.paths.PROJECTS_DIR, project.id, prefix + path, project.metadata)).buffer;
        } });
      if (!controller.signal.aborted) res.set('Cache-Control', 'no-store').json(result);
    } catch (error) {
      if (!controller.signal.aborted) deps.http.sendApiError(res, Number((error as { status?: number })?.status) || 400, 'ONTOLOGY_CONTEXT_ERROR', error instanceof Error ? error.message : String(error));
    } finally { req.removeListener('aborted', abort); res.removeListener('close', abort); }
  });
  app.post('/api/projects/:id/ontology/build', deps.http.requireLocalDaemonRequest, async (req, res) => {
    const started = performance.now();
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    req.once('aborted', abort); res.once('close', abort);
    try {
      const project = getProject(deps.db, req.params.id);
      if (!project) throw Object.assign(new Error('Project not found'), { status: 404 });
      const body = req.body ?? {};
      if (body.projectPath != null && typeof body.projectPath !== 'string') throw new Error('projectPath must be a string');
      const businessFiles: unknown = body.businessFiles ?? [];
      if (!Array.isArray(businessFiles) || businessFiles.length > 16 || businessFiles.some(name => typeof name !== 'string' || !projectRelativePath(name) || !/\.(md|txt)$/i.test(name)))
        throw new Error('Select at most 16 module-relative Markdown/TXT business documents');
      const request = body.request ?? '';
      if (typeof request !== 'string' || request.length > 2000) throw new Error('request must be text of at most 2000 characters');
      const workspaceRoot = resolveProjectDir(deps.paths.PROJECTS_DIR, project.id, project.metadata);
      // A read-only whole-workspace analysis is valid without a root build
      // marker. Command execution keeps its existing discovered-module boundary.
      const target = body.projectPath === '.'
        ? { root: workspaceRoot, project: { path: '.' } }
        : await resolveDevelopmentProjectRoot(workspaceRoot,
          body.projectPath ?? project.metadata?.development?.activeProjectPath ?? null);
      const result = await buildCodeOntology(deps.paths.RUNTIME_DATA_DIR, project.id, target.root, target.project.path, [...new Set(businessFiles as string[])], request, controller.signal);
      result.elapsedMs = Math.round(performance.now() - started);
      if (!controller.signal.aborted) res.set('Cache-Control', 'no-store').json(result);
    } catch (error) {
      if (!controller.signal.aborted) deps.http.sendApiError(res, Number((error as { status?: number })?.status) || 400,
        Number((error as { status?: number })?.status) === 404 ? 'PROJECT_NOT_FOUND' : 'ONTOLOGY_ERROR', error instanceof Error ? error.message : String(error));
    } finally { req.removeListener('aborted', abort); res.removeListener('close', abort); }
  });
  app.post('/api/projects/:id/ontology/plan', deps.http.requireLocalDaemonRequest, async (req, res) => {
    const started = performance.now(), controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    req.once('aborted', abort); res.once('close', abort);
    try {
      const project = getProject(deps.db, req.params.id);
      if (!project) throw Object.assign(new Error('Project not found'), { status: 404 });
      const body = req.body ?? {};
      if (body.projectPath != null && typeof body.projectPath !== 'string') throw new Error('projectPath must be a string');
      const businessFiles: unknown = body.businessFiles ?? [];
      if (!Array.isArray(businessFiles) || businessFiles.length > 16 || businessFiles.some(name => typeof name !== 'string' || !projectRelativePath(name) || !/\.(md|txt)$/i.test(name))) throw new Error('Select at most 16 module-relative Markdown/TXT business documents');
      const request = body.request ?? '';
      if (typeof request !== 'string' || request.length > 2000) throw new Error('request must be text of at most 2000 characters');
      if (body.rulesFile !== undefined && !isDocumentPath(body.rulesFile)) throw new Error('rulesFile must be a project-relative JSON file');
      const workspaceRoot = resolveProjectDir(deps.paths.PROJECTS_DIR, project.id, project.metadata);
      const target = body.projectPath === '.' ? { root: workspaceRoot, project: { path: '.' } }
        : await resolveDevelopmentProjectRoot(workspaceRoot, body.projectPath ?? project.metadata?.development?.activeProjectPath ?? null);
      const hashes = new Map<string, string>();
      const read = async (name: string) => {
        const info = await resolveProjectFilePath(deps.paths.PROJECTS_DIR, project.id, name, project.metadata);
        if (info.size > 2 * 1024 * 1024) throw new Error('Document exceeds the 2 MiB limit');
        const file = await deps.projectFiles.readProjectFile(deps.paths.PROJECTS_DIR, project.id, name, project.metadata);
        hashes.set(file.name, createHash('sha256').update(file.buffer).digest('hex'));
        return file;
      };
      const before = await verificationSource(workspaceRoot);
      const loaded = await loadProjectDocumentGraph({ projectRoot: workspaceRoot, inputFiles: body.inputFiles, read,
        list: async () => (await listFiles(deps.paths.PROJECTS_DIR, project.id, { metadata: project.metadata })).map(file => file.name), schemaWatch: deps.schemaWatch.get(project.id) });
      const policy = body.rulesFile === undefined ? undefined : parseChangePolicy(JSON.parse((await read(body.rulesFile)).buffer.toString('utf8')));
      const ontology = await buildCodeOntology(deps.paths.RUNTIME_DATA_DIR, project.id, target.root, target.project.path, [...new Set(businessFiles as string[])], request, controller.signal);
      const graph = mergeOntologyDocuments(ontology, loaded.graph, loaded.sourceDocuments);
      const simulation = simulationSourceNodes(ontology, graph, body.simulateFiles);
      const graphIndex = new RecordedDependencyGraph(graph);
      const checks = await discoverVerificationChecks(workspaceRoot);
      const status = await deps.verification.status(project.id, '.', workspaceRoot, undefined, true);
      const modules=[...new Set(checks.flatMap(check=>check.projectPath?[check.projectPath]:[]))];
      const receipts=[];
      for(const projectPath of modules){
        const module=await resolveDevelopmentProjectRoot(workspaceRoot,projectPath);
        const saved=await deps.verification.status(project.id,projectPath,module.root,undefined,true);
        if(saved.run)receipts.push(workspaceVerificationReceipt(saved.run,projectPath));
      }
      for (const [name, digest] of hashes) {
        const file = await deps.projectFiles.readProjectFile(deps.paths.PROJECTS_DIR, project.id, name, project.metadata);
        if (createHash('sha256').update(file.buffer).digest('hex') !== digest) throw Object.assign(new Error('Document changed during planning; analyze again'), { status: 409 });
      }
      const source = await verificationSource(workspaceRoot);
      if (before.digest && source.digest && before.digest !== source.digest) throw Object.assign(new Error('Source changed during planning; analyze again'), { status: 409 });
      if (!before.digest) { source.digest = null; source.reason = before.reason; }
      const plan = buildChangePlan({ graph, graphIndex, checks, source, receipt: status.run,receipts, changedFiles: loaded.changedFiles, request,
        ...(policy ? { policy } : {}), ...(simulation ? { simulateNodeIds: simulation.nodeIds } : {}) });
      plan.handoff = plan.handoff.replace('monofield docs plan --project', 'monofield docs plan-code --project')
        + `\nCode analysis scope and optional business inputs (data): ${JSON.stringify({ projectPath: target.project.path, businessFiles, businessContext: ontology.businessContext })}.`
        + '\nBusiness rules and exceptions remain unverified. Supplied documents provide terminology/association candidates, not proof of current business meaning or code/document consistency.';
      if (simulation) plan.handoff += `\nHypothetical edits at whole-file granularity (data): ${JSON.stringify(simulation.sourceFiles)}. Selected symbols are not precise runtime boundaries. No files were changed and prior passes are not credited.`;
      if (!controller.signal.aborted) res.set('Cache-Control', 'no-store').json({ ontology, plan, documentReviews: documentReviews(plan,ontology,graphIndex),
        documentHashes: [...hashes].map(([path, sha256]) => ({ path, sha256 })), ...(simulation ? { simulation: { sourceFiles: simulation.sourceFiles, granularity: simulation.granularity } } : {}),
        elapsedMs: Math.round(performance.now() - started), modelCalls: 0 });
    } catch (error) {
      if (!controller.signal.aborted) deps.http.sendApiError(res, Number((error as { status?: number })?.status) || 400,
        'ONTOLOGY_PLAN_ERROR', error instanceof Error ? error.message : String(error));
    } finally { req.removeListener('aborted', abort); res.removeListener('close', abort); }
  });
}
