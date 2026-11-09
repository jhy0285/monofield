import type { Express, Response } from 'express';
import { readAppConfig } from '../app-config.js';
import { readMcpConfig } from '../mcp-config.js';
import { reaForAgentsEnabled } from '../services/bundled-rea.js';
import { classifyBrowserEvidenceError } from '../services/browser-evidence.js';
import { citeReaEvidence } from '../services/rea-cite.js';
import { compareReaFiles } from '../services/rea-compare.js';
import { defaultReaDoctorDeps, runReaDoctor, type ReaDoctorDeps } from '../services/rea-doctor.js';
import { listReaCaseFiles, listReaEvidenceFiles, probeReaEvidenceFile, viewReaEvidenceFile } from '../services/rea-evidence.js';
import { projectEvidenceAccess, type RegisterBrowserEvidenceRoutesDeps } from './browser-evidence.js';

/**
 * REA Studio: every REA evidence file of a project, any one of them as a checked, display-ready view, one item of it as
 * a citation for a prompt, an original compared with its remake, and the setup check.
 */
export function registerReaEvidenceRoutes(app: Express, deps: RegisterBrowserEvidenceRoutesDeps & { reaDoctor?: ReaDoctorDeps }): void {
  const fail = (res: Response, error: unknown) => {
    const failure = classifyBrowserEvidenceError(error);
    return deps.http.sendApiError(res, failure.status, failure.code, failure.message);
  };

  app.get('/api/projects/:id/rea-evidence', deps.http.requireLocalDaemonRequest, async (req, res) => {
    try {
      const access = projectEvidenceAccess(deps, req.params.id);
      res.set('Cache-Control', 'no-store').json({ files: await listReaEvidenceFiles(access), cases: await listReaCaseFiles(access) });
    } catch (error) { fail(res, error); }
  });
  app.post('/api/projects/:id/rea-evidence/probe', deps.http.requireLocalDaemonRequest, async (req, res) => {
    try { res.set('Cache-Control', 'no-store').json(await probeReaEvidenceFile(projectEvidenceAccess(deps, req.params.id), req.body ?? {})); } catch (error) { fail(res, error); }
  });
  app.post('/api/projects/:id/rea-evidence/view', deps.http.requireLocalDaemonRequest, async (req, res) => {
    try { res.set('Cache-Control', 'no-store').json(await viewReaEvidenceFile(projectEvidenceAccess(deps, req.params.id), req.body ?? {})); } catch (error) { fail(res, error); }
  });
  app.post('/api/projects/:id/rea-evidence/cite', deps.http.requireLocalDaemonRequest, async (req, res) => {
    try { res.set('Cache-Control', 'no-store').json(await citeReaEvidence(projectEvidenceAccess(deps, req.params.id), req.body ?? {})); } catch (error) { fail(res, error); }
  });
  app.post('/api/projects/:id/rea-evidence/compare', deps.http.requireLocalDaemonRequest, async (req, res) => {
    try { res.set('Cache-Control', 'no-store').json(await compareReaFiles(projectEvidenceAccess(deps, req.params.id), req.body ?? {})); } catch (error) { fail(res, error); }
  });
  app.get('/api/rea/doctor', deps.http.requireLocalDaemonRequest, async (_req, res) => {
    try {
      // The full configuration, because GHIDRA_INSTALL_DIR and JAVA_HOME may be set on the REA entry; the response carries
      // those two paths only, never another server's values.
      const doctorDeps = deps.reaDoctor ?? defaultReaDoctorDeps(async () => (await readMcpConfig(deps.paths.RUNTIME_DATA_DIR)).servers,
        async () => reaForAgentsEnabled((await readAppConfig(deps.paths.RUNTIME_DATA_DIR)).reaForAgents));
      res.set('Cache-Control', 'no-store').json(await runReaDoctor(doctorDeps));
    } catch (error) { fail(res, error); }
  });
}
