import type { Express } from 'express';
import { getProject } from '../db.js';
import { resolveProjectDir } from '../projects.js';
import { resolveDevelopmentProjectRoot } from '../development-projects.js';
import type { RouteDeps } from '../server-context.js';
import { buildCodeOntology } from '../services/code-ontology.js';
import { projectRelativePath } from '../services/change-policy.js';

export interface RegisterCodeOntologyRoutesDeps extends RouteDeps<'db' | 'http' | 'paths'> {}
export function registerCodeOntologyRoutes(app: Express, deps: RegisterCodeOntologyRoutesDeps): void {
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
}
