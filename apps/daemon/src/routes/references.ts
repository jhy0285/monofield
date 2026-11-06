import type { Express, Response } from 'express';
import { getProject } from '../db.js';
import {
  addReference,
  applyReferences,
  classifyReferenceError,
  listReferences,
  ReferenceBoardError,
  removeReference,
  updateReference,
  type ReferenceFileAccess,
} from '../services/references.js';
import type { RouteDeps } from '../server-context.js';

export interface RegisterReferenceRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'projectFiles'> {}

/** The reference board: pages kept while browsing, and the block that applies them to the project. */
export function registerReferenceRoutes(app: Express, deps: RegisterReferenceRoutesDeps): void {
  const projectsDir = deps.paths.PROJECTS_DIR;
  const access = (id: string): ReferenceFileAccess => {
    const project = getProject(deps.db, id);
    if (!project) throw new ReferenceBoardError('Project not found.', 404, 'PROJECT_NOT_FOUND');
    return {
      // Creates a managed project's folder on first use, as any project file write does.
      root: async () => deps.projectFiles.ensureProject(projectsDir, id, project.metadata) as Promise<string>,
      read: async (name) => {
        try { return (await deps.projectFiles.readProjectFile(projectsDir, id, name, project.metadata)).buffer as Buffer; } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw error;
        }
      },
      write: async (name, body) => {
        await deps.projectFiles.writeProjectFile(projectsDir, id, name, typeof body === 'string' ? Buffer.from(body, 'utf8') : body, { overwrite: true }, project.metadata);
      },
      remove: (name) => deps.projectFiles.deleteProjectFile(projectsDir, id, name, project.metadata),
    };
  };
  const fail = (res: Response, error: unknown) => {
    const failure = classifyReferenceError(error);
    return deps.http.sendApiError(res, failure.status, failure.code, failure.message);
  };

  app.get('/api/projects/:id/references', deps.http.requireLocalDaemonRequest, async (req, res) => {
    try { res.set('Cache-Control', 'no-store').json(await listReferences(access(req.params.id))); } catch (error) { fail(res, error); }
  });
  app.post('/api/projects/:id/references', deps.http.requireLocalDaemonRequest, async (req, res) => {
    try { res.status(201).json({ item: await addReference(access(req.params.id), req.params.id, req.body ?? {}) }); } catch (error) { fail(res, error); }
  });
  app.post('/api/projects/:id/references/apply', deps.http.requireLocalDaemonRequest, async (req, res) => {
    try { res.set('Cache-Control', 'no-store').json(await applyReferences(access(req.params.id), req.body ?? {})); } catch (error) { fail(res, error); }
  });
  app.patch('/api/projects/:id/references/:refId', deps.http.requireLocalDaemonRequest, async (req, res) => {
    try { res.json({ item: await updateReference(access(req.params.id), req.params.id, req.params.refId, req.body ?? {}) }); } catch (error) { fail(res, error); }
  });
  app.delete('/api/projects/:id/references/:refId', deps.http.requireLocalDaemonRequest, async (req, res) => {
    try { res.json(await removeReference(access(req.params.id), req.params.id, req.params.refId)); } catch (error) { fail(res, error); }
  });
}
