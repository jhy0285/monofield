import type { Express } from 'express';

import type { DevelopmentServerStartRequest, GitDiffScope } from '@open-design/contracts';
import { getProject } from '../db.js';
import { resolveProjectDir } from '../projects.js';
import { detectDevelopmentRunConfigs, type DevelopmentServerService } from '../development-server.js';
import { gitWorkspaceDiff, gitWorkspaceStatus } from '../git-workspace.js';
import type { RouteDeps } from '../server-context.js';

interface DevelopmentRouteDeps extends RouteDeps<'db' | 'http' | 'paths'> {
  developmentServers: DevelopmentServerService;
}

function projectRoot(deps: DevelopmentRouteDeps, projectId: string): string {
  const project = getProject(deps.db, projectId);
  if (!project) throw Object.assign(new Error('Project not found'), { status: 404 });
  return resolveProjectDir(deps.paths.PROJECTS_DIR, projectId, project.metadata);
}

function sendError(res: any, error: unknown): void {
  const status = Number((error as { status?: number } | null)?.status) || 400;
  res.status(status).json({ error: { code: status === 404 ? 'PROJECT_NOT_FOUND' : 'DEVELOPMENT_SERVER_ERROR', message: error instanceof Error ? error.message : String(error) } });
}

export function registerDevelopmentRoutes(app: Express, deps: DevelopmentRouteDeps): void {
  const gate = deps.http.requireLocalDaemonRequest;
  app.get('/api/projects/:id/development/configs', gate, async (req, res) => {
    try { res.json(await detectDevelopmentRunConfigs(projectRoot(deps, req.params.id))); }
    catch (error) { sendError(res, error); }
  });
  app.get('/api/projects/:id/development/server', gate, async (req, res) => {
    try { projectRoot(deps, req.params.id); res.json(await deps.developmentServers.statusAsync(req.params.id)); }
    catch (error) { sendError(res, error); }
  });
  app.post('/api/projects/:id/development/server/start', gate, async (req, res) => {
    try {
      const body = req.body as Partial<DevelopmentServerStartRequest> | null;
      if (!body?.configId || typeof body.configId !== 'string') throw new Error('configId is required');
      res.json(await deps.developmentServers.start(req.params.id, projectRoot(deps, req.params.id), body.configId));
    } catch (error) { sendError(res, error); }
  });
  app.post('/api/projects/:id/development/server/stop', gate, async (req, res) => {
    try { projectRoot(deps, req.params.id); res.json(await deps.developmentServers.stop(req.params.id)); }
    catch (error) { sendError(res, error); }
  });
  app.get('/api/projects/:id/development/git/status', gate, async (req, res) => {
    try { res.json(await gitWorkspaceStatus(projectRoot(deps, req.params.id))); }
    catch (error) { sendError(res, error); }
  });
  app.get('/api/projects/:id/development/git/diff', gate, async (req, res) => {
    try {
      const path = typeof req.query.path === 'string' ? req.query.path : '';
      const scope: GitDiffScope = req.query.scope === 'staged' ? 'staged' : 'working';
      if (!path) throw new Error('path is required');
      res.json(await gitWorkspaceDiff(projectRoot(deps, req.params.id), path, scope));
    } catch (error) { sendError(res, error); }
  });
}
