import type { Express, Response } from 'express';
import { classifyBrowserEvidenceError } from '../services/browser-evidence.js';
import { listReaEvidenceFiles, probeReaEvidenceFile, viewReaEvidenceFile } from '../services/rea-evidence.js';
import { projectEvidenceAccess, type RegisterBrowserEvidenceRoutesDeps } from './browser-evidence.js';

/** REA Studio: every REA evidence file of a project, and any one of them as a checked, display-ready view. */
export function registerReaEvidenceRoutes(app: Express, deps: RegisterBrowserEvidenceRoutesDeps): void {
  const fail = (res: Response, error: unknown) => {
    const failure = classifyBrowserEvidenceError(error);
    return deps.http.sendApiError(res, failure.status, failure.code, failure.message);
  };

  app.get('/api/projects/:id/rea-evidence', deps.http.requireLocalDaemonRequest, async (req, res) => {
    try { res.set('Cache-Control', 'no-store').json({ files: await listReaEvidenceFiles(projectEvidenceAccess(deps, req.params.id)) }); } catch (error) { fail(res, error); }
  });
  app.post('/api/projects/:id/rea-evidence/probe', deps.http.requireLocalDaemonRequest, async (req, res) => {
    try { res.set('Cache-Control', 'no-store').json(await probeReaEvidenceFile(projectEvidenceAccess(deps, req.params.id), req.body ?? {})); } catch (error) { fail(res, error); }
  });
  app.post('/api/projects/:id/rea-evidence/view', deps.http.requireLocalDaemonRequest, async (req, res) => {
    try { res.set('Cache-Control', 'no-store').json(await viewReaEvidenceFile(projectEvidenceAccess(deps, req.params.id), req.body ?? {})); } catch (error) { fail(res, error); }
  });
}
