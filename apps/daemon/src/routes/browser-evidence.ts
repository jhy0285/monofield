import type { Express, Response } from 'express';
import { open } from 'node:fs/promises';
import { getProject } from '../db.js';
import { listFiles, resolveProjectFilePath } from '../projects.js';
import {
  BrowserEvidenceError,
  applyBrowserEvidenceFiles,
  classifyBrowserEvidenceError,
  crossCheckBrowserEvidenceFiles,
  listBrowserEvidenceFiles,
  type BrowserEvidenceFileAccess,
} from '../services/browser-evidence.js';
import type { RouteDeps } from '../server-context.js';

export interface RegisterBrowserEvidenceRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'projectFiles'> {}

/** The project's files as the evidence services read and write them. Throws a 404 for an unknown project. */
export function projectEvidenceAccess(deps: RegisterBrowserEvidenceRoutesDeps, id: string): BrowserEvidenceFileAccess {
  const projectsDir = deps.paths.PROJECTS_DIR;
  const project = getProject(deps.db, id);
  if (!project) throw new BrowserEvidenceError('Project not found.', 404, 'PROJECT_NOT_FOUND');
  return {
    list: () => listFiles(projectsDir, id, { metadata: project.metadata }),
    read: (name) => deps.projectFiles.readProjectFile(projectsDir, id, name, project.metadata),
    head: async (name, bytes) => {
      const info = await resolveProjectFilePath(projectsDir, id, name, project.metadata);
      const handle = await open(info.filePath, 'r');
      try {
        const buffer = Buffer.alloc(Math.min(bytes, info.size));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        return buffer.subarray(0, bytesRead);
      } finally { await handle.close(); }
    },
    write: (name, body, options) => deps.projectFiles.writeProjectFile(projectsDir, id, name, Buffer.from(body, 'utf8'),
      { overwrite: options.overwrite, expectedContentSha256: options.expectedContentSha256 ?? null }, project.metadata),
  };
}

/** REA browser evidence compared with, and written into, interface specifications. */
export function registerBrowserEvidenceRoutes(app: Express, deps: RegisterBrowserEvidenceRoutesDeps): void {
  const access = (id: string) => projectEvidenceAccess(deps, id);
  const fail = (res: Response, error: unknown) => {
    const failure = classifyBrowserEvidenceError(error);
    return deps.http.sendApiError(res, failure.status, failure.code, failure.message);
  };

  app.get('/api/projects/:id/browser-evidence', deps.http.requireLocalDaemonRequest, async (req, res) => {
    try { res.set('Cache-Control', 'no-store').json({ files: await listBrowserEvidenceFiles(access(req.params.id)) }); } catch (error) { fail(res, error); }
  });
  app.post('/api/projects/:id/browser-evidence/cross-check', deps.http.requireLocalDaemonRequest, async (req, res) => {
    try { res.set('Cache-Control', 'no-store').json(await crossCheckBrowserEvidenceFiles(access(req.params.id), req.body ?? {})); } catch (error) { fail(res, error); }
  });
  app.post('/api/projects/:id/browser-evidence/apply', deps.http.requireLocalDaemonRequest, async (req, res) => {
    try { res.set('Cache-Control', 'no-store').json(await applyBrowserEvidenceFiles(access(req.params.id), req.body ?? {})); } catch (error) { fail(res, error); }
  });
}
