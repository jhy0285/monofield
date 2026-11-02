import type { Express, Response } from 'express';
import { open } from 'node:fs/promises';
import { getProject } from '../db.js';
import { listFiles, resolveProjectFilePath } from '../projects.js';
import {
  BrowserEvidenceError,
  applyBrowserEvidenceFiles,
  crossCheckBrowserEvidenceFiles,
  listBrowserEvidenceFiles,
  type BrowserEvidenceFileAccess,
} from '../services/browser-evidence.js';
import type { RouteDeps } from '../server-context.js';

export interface RegisterBrowserEvidenceRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'projectFiles'> {}

/** REA browser evidence compared with, and written into, interface specifications. */
export function registerBrowserEvidenceRoutes(app: Express, deps: RegisterBrowserEvidenceRoutesDeps): void {
  const projectsDir = deps.paths.PROJECTS_DIR;
  const access = (id: string): BrowserEvidenceFileAccess => {
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
  };
  const fail = (res: Response, error: unknown) => {
    if (error instanceof BrowserEvidenceError) return deps.http.sendApiError(res, error.status, error.code, error.message);
    const status = Number((error as { status?: number })?.status) || 400;
    const code = (error as { code?: string })?.code;
    if (code === 'ENOENT') return deps.http.sendApiError(res, 404, 'FILE_NOT_FOUND', 'A selected file does not exist in the project.');
    if (code === 'EEXIST' || status === 409) return deps.http.sendApiError(res, 409, 'BROWSER_EVIDENCE_CONFLICT', error instanceof Error ? error.message : String(error));
    return deps.http.sendApiError(res, status, 'BROWSER_EVIDENCE_FAILED', error instanceof Error ? error.message : String(error));
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
