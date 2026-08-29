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
  gitWorkspaceRootPath,
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

function explicitProjectPath(requested?: unknown): string | null {
  return typeof requested === 'string' && requested.trim() ? requested : null;
}

function storedProjectPath(deps: DevelopmentRouteDeps, projectId: string): string | null {
  const project = getProject(deps.db, projectId);
  const stored = project?.metadata?.development?.activeProjectPath;
  return typeof stored === 'string' && stored.trim() ? stored : null;
}

function selectedProjectPath(deps: DevelopmentRouteDeps, projectId: string, requested?: unknown): string | null {
  return explicitProjectPath(requested) ?? storedProjectPath(deps, projectId);
}

async function selectedProject(
  deps: DevelopmentRouteDeps,
  projectId: string,
  requested?: unknown,
): Promise<Awaited<ReturnType<typeof resolveDevelopmentProjectRoot>>> {
  const workspaceRoot = projectRoot(deps, projectId);
  const explicit = explicitProjectPath(requested);
  const stored = explicit == null ? storedProjectPath(deps, projectId) : null;
  try {
    return await resolveDevelopmentProjectRoot(workspaceRoot, explicit ?? stored);
  } catch (error) {
    if (explicit != null || stored == null || Number((error as { status?: number } | null)?.status) !== 404) throw error;
    return await resolveDevelopmentProjectRoot(workspaceRoot, null);
  }
}

async function activeProjectRoot(deps: DevelopmentRouteDeps, projectId: string, requested?: unknown): Promise<string> {
  return (await selectedProject(deps, projectId, requested)).root;
}

async function activeProjectPath(deps: DevelopmentRouteDeps, projectId: string, requested?: unknown): Promise<string> {
  return (await selectedProject(deps, projectId, requested)).project.path;
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
  const workspaceRoot = projectRoot(deps, projectId);
  const targetRoot = gitWorkspaceRootPath(await activeProjectRoot(deps, projectId, requested));
  const key = (value: string) => {
    const normalized = value.replace(/\\/g, '/');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  const statuses = await deps.developmentServers.statusesAsync(projectId, true);
  for (const status of statuses) {
    if (!status.pid && status.state !== 'starting' && status.state !== 'ready') continue;
    const runningProject = await resolveDevelopmentProjectRoot(workspaceRoot, status.projectPath ?? null);
    if (key(gitWorkspaceRootPath(runningProject.root)) === key(targetRoot)) {
      throw Object.assign(
        new Error(`Stop the running development server (${status.projectPath ?? '.'}) before changing branches in this Git worktree.`),
        { status: 409 },
      );
    }
  }
}

export function registerDevelopmentRoutes(app: Express, deps: DevelopmentRouteDeps): void {
  const gate = deps.http.requireLocalDaemonRequest;
  app.get('/api/projects/:id/development/configs', gate, async (req, res) => {
    try {
      const refresh = ['1', 'true', 'yes'].includes(String(req.query.refresh ?? '').toLowerCase());
      res.set('Cache-Control', 'no-store');
      const configs = await detectDevelopmentRunConfigs(
        projectRoot(deps, req.params.id),
        selectedProjectPath(deps, req.params.id, req.query.projectPath),
        refresh,
        explicitProjectPath(req.query.projectPath) == null && storedProjectPath(deps, req.params.id) != null,
      );
      res.json(configs);
      // Git is intentionally lazy. Starting two Git processes after every
      // server selection competes with config/status loading on large Windows
      // workspaces even when the Changes view is closed. The Changes panel
      // owns its own loading state and warms these caches only when requested.
    }
    catch (error) { sendError(res, error); }
  });
  app.get('/api/projects/:id/development/server', gate, async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await deps.developmentServers.statusAsync(
        req.params.id,
        await activeProjectPath(deps, req.params.id, req.query.projectPath),
        false,
        projectRoot(deps, req.params.id),
      ));
    }
    catch (error) { sendError(res, error); }
  });
  app.get('/api/projects/:id/development/servers', gate, async (req, res) => {
    try {
      projectRoot(deps, req.params.id);
      res.set('Cache-Control', 'no-store');
      const refresh = ['1', 'true', 'yes'].includes(String(req.query.refresh ?? '').toLowerCase());
      const includeLogs = !['0', 'false', 'no'].includes(String(req.query.logs ?? '').toLowerCase());
      const servers = await deps.developmentServers.statusesAsync(
        req.params.id,
        refresh,
        projectRoot(deps, req.params.id),
      );
      res.json({
        servers: includeLogs ? servers : servers.map((server) => ({ ...server, logs: [] })),
      });
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
    try { projectRoot(deps, req.params.id); res.json(await deps.developmentServers.stopAll(req.params.id)); }
    catch (error) { sendError(res, error); }
  });
  app.get('/api/projects/:id/development/git/status', gate, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const branch = typeof req.query.branch === 'string' ? req.query.branch : null;
      const refresh = ['1', 'true', 'yes'].includes(String(req.query.refresh ?? '').toLowerCase());
      res.json(await gitWorkspaceStatus(await activeProjectRoot(deps, req.params.id, req.query.projectPath), branch, { refresh }));
    }
    catch (error) { sendError(res, error); }
  });
  app.get('/api/projects/:id/development/git/branches', gate, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const refresh = ['1', 'true', 'yes'].includes(String(req.query.refresh ?? '').toLowerCase());
      res.json(await gitWorkspaceBranches(
        await activeProjectRoot(deps, req.params.id, req.query.projectPath),
        { refresh },
      ));
    }
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
