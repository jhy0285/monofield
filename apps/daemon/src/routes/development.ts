import type { Express } from 'express';

import type {
  DevelopmentServerStartRequest,
  GitBranchCreateRequest,
  GitBranchSwitchRequest,
  GitDiffScope,
  GitWorkingTreeStrategy,
} from '@open-design/contracts';
import { getProject } from '../db.js';
import { resolveProjectDir } from '../projects.js';
import { detectDevelopmentRunConfigs, type DevelopmentServerService } from '../development-server.js';
import { resolveDevelopmentProjectRoot } from '../development-projects.js';
import {
  createGitWorkspaceBranch,
  gitWorkspaceBranches,
  gitWorkspaceDiff,
  gitWorkspaceDirtyState,
  gitWorkspaceStatus,
  switchGitWorkspaceBranch,
} from '../git-workspace.js';
import type { RouteDeps } from '../server-context.js';

interface DevelopmentRouteDeps extends RouteDeps<'db' | 'http' | 'paths'> {
  developmentServers: DevelopmentServerService;
}

function projectRoot(deps: DevelopmentRouteDeps, projectId: string): string {
  const project = getProject(deps.db, projectId);
  if (!project) throw Object.assign(new Error('Project not found'), { status: 404 });
  return resolveProjectDir(deps.paths.PROJECTS_DIR, projectId, project.metadata);
}

function selectedProjectPath(deps: DevelopmentRouteDeps, projectId: string, requested?: unknown): string | null {
  if (typeof requested === 'string' && requested.trim()) return requested;
  const project = getProject(deps.db, projectId);
  const stored = project?.metadata?.development?.activeProjectPath;
  return typeof stored === 'string' && stored.trim() ? stored : null;
}

async function activeProjectRoot(deps: DevelopmentRouteDeps, projectId: string, requested?: unknown): Promise<string> {
  const workspaceRoot = projectRoot(deps, projectId);
  return (await resolveDevelopmentProjectRoot(workspaceRoot, selectedProjectPath(deps, projectId, requested))).root;
}

async function activeProjectPath(deps: DevelopmentRouteDeps, projectId: string, requested?: unknown): Promise<string> {
  const workspaceRoot = projectRoot(deps, projectId);
  return (await resolveDevelopmentProjectRoot(workspaceRoot, selectedProjectPath(deps, projectId, requested))).project.path;
}

function sendError(res: any, error: unknown): void {
  const status = Number((error as { status?: number } | null)?.status) || 400;
  res.status(status).json({ error: { code: status === 404 ? 'PROJECT_NOT_FOUND' : 'DEVELOPMENT_SERVER_ERROR', message: error instanceof Error ? error.message : String(error) } });
}

function workingTreeStrategy(input: unknown): GitWorkingTreeStrategy {
  if (input == null || input === 'reject') return 'reject';
  if (input === 'keep' || input === 'stash') return input;
  throw Object.assign(new Error('strategy must be reject, keep, or stash'), { status: 400 });
}

async function requireStoppedDevelopmentServer(deps: DevelopmentRouteDeps, projectId: string, requested?: unknown): Promise<void> {
  const status = await deps.developmentServers.statusAsync(
    projectId,
    await activeProjectPath(deps, projectId, requested),
  );
  if (status.pid || status.state === 'starting' || status.state === 'ready') {
    throw Object.assign(new Error('Stop the development server before changing branches.'), { status: 409 });
  }
}

export function registerDevelopmentRoutes(app: Express, deps: DevelopmentRouteDeps): void {
  const gate = deps.http.requireLocalDaemonRequest;
  app.get('/api/projects/:id/development/configs', gate, async (req, res) => {
    try {
      const refresh = ['1', 'true', 'yes'].includes(String(req.query.refresh ?? '').toLowerCase());
      res.set('Cache-Control', 'no-store');
      res.json(await detectDevelopmentRunConfigs(
        projectRoot(deps, req.params.id),
        selectedProjectPath(deps, req.params.id, req.query.projectPath),
        refresh,
      ));
    }
    catch (error) { sendError(res, error); }
  });
  app.get('/api/projects/:id/development/server', gate, async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await deps.developmentServers.statusAsync(
        req.params.id,
        await activeProjectPath(deps, req.params.id, req.query.projectPath),
      ));
    }
    catch (error) { sendError(res, error); }
  });
  app.get('/api/projects/:id/development/servers', gate, async (req, res) => {
    try {
      projectRoot(deps, req.params.id);
      res.set('Cache-Control', 'no-store');
      res.json({ servers: deps.developmentServers.statuses(req.params.id) });
    }
    catch (error) { sendError(res, error); }
  });
  app.post('/api/projects/:id/development/server/start', gate, async (req, res) => {
    try {
      const body = req.body as Partial<DevelopmentServerStartRequest> | null;
      if (!body?.configId || typeof body.configId !== 'string') throw new Error('configId is required');
      res.json(await deps.developmentServers.start(
        req.params.id,
        projectRoot(deps, req.params.id),
        body.configId,
        selectedProjectPath(deps, req.params.id, body.projectPath),
        body.overrides,
      ));
    } catch (error) { sendError(res, error); }
  });
  app.post('/api/projects/:id/development/server/stop', gate, async (req, res) => {
    try {
      const body = req.body as { projectPath?: unknown } | null;
      res.json(await deps.developmentServers.stop(
        req.params.id,
        await activeProjectPath(deps, req.params.id, body?.projectPath),
      ));
    }
    catch (error) { sendError(res, error); }
  });
  app.post('/api/projects/:id/development/server/stop-all', gate, async (req, res) => {
    try { projectRoot(deps, req.params.id); res.json({ servers: await deps.developmentServers.stopAll(req.params.id) }); }
    catch (error) { sendError(res, error); }
  });
  app.get('/api/projects/:id/development/git/status', gate, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const branch = typeof req.query.branch === 'string' ? req.query.branch : null;
      res.json(await gitWorkspaceStatus(await activeProjectRoot(deps, req.params.id, req.query.projectPath), branch));
    }
    catch (error) { sendError(res, error); }
  });
  app.get('/api/projects/:id/development/git/branches', gate, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json(await gitWorkspaceBranches(await activeProjectRoot(deps, req.params.id, req.query.projectPath))); }
    catch (error) { sendError(res, error); }
  });
  app.get('/api/projects/:id/development/git/dirty', gate, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json(await gitWorkspaceDirtyState(await activeProjectRoot(deps, req.params.id, req.query.projectPath))); }
    catch (error) { sendError(res, error); }
  });
  app.post('/api/projects/:id/development/git/switch', gate, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const body = req.body as Partial<GitBranchSwitchRequest> | null;
      if (!body?.branch || typeof body.branch !== 'string') throw Object.assign(new Error('branch is required'), { status: 400 });
      await requireStoppedDevelopmentServer(deps, req.params.id, req.query.projectPath);
      res.json(await switchGitWorkspaceBranch(
        await activeProjectRoot(deps, req.params.id, req.query.projectPath),
        body.branch,
        workingTreeStrategy(body.strategy),
      ));
    } catch (error) { sendError(res, error); }
  });
  app.post('/api/projects/:id/development/git/branches', gate, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const body = req.body as Partial<GitBranchCreateRequest> | null;
      if (!body?.name || typeof body.name !== 'string') throw Object.assign(new Error('name is required'), { status: 400 });
      await requireStoppedDevelopmentServer(deps, req.params.id, req.query.projectPath);
      res.json(await createGitWorkspaceBranch(
        await activeProjectRoot(deps, req.params.id, req.query.projectPath),
        body.name,
        workingTreeStrategy(body.strategy),
      ));
    } catch (error) { sendError(res, error); }
  });
  app.get('/api/projects/:id/development/git/diff', gate, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const path = typeof req.query.path === 'string' ? req.query.path : '';
      const scope: GitDiffScope = req.query.scope === 'staged'
        ? 'staged'
        : req.query.scope === 'branch' ? 'branch' : 'working';
      const branch = typeof req.query.branch === 'string' ? req.query.branch : null;
      if (!path) throw new Error('path is required');
      res.json(await gitWorkspaceDiff(
        await activeProjectRoot(deps, req.params.id, req.query.projectPath),
        path,
        scope,
        branch,
      ));
    } catch (error) { sendError(res, error); }
  });
}
