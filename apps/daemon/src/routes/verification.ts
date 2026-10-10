import type { Express, Response } from 'express';
import { getProject } from '../db.js';
import { resolveProjectDir } from '../projects.js';
import { resolveDevelopmentProjectRoot } from '../development-projects.js';
import { discoverVerificationChecks } from '../services/verification-discovery.js';
import type { RouteDeps } from '../server-context.js';

export interface RegisterVerificationRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'verification'> {}
export function registerVerificationRoutes(app: Express, deps: RegisterVerificationRoutesDeps): void {
  const gate = deps.http.requireLocalDaemonRequest;
  const base = '/api/projects/:id/development/verification';
  const selected = async (id: string, value: unknown) => {
    const project = getProject(deps.db, id);
    if (!project) throw Object.assign(new Error('Project not found'), { status: 404 });
    if (value != null && typeof value !== 'string') throw new Error('projectPath must be a string');
    return resolveDevelopmentProjectRoot(resolveProjectDir(deps.paths.PROJECTS_DIR, id, project.metadata),
      typeof value === 'string' ? value : project.metadata?.development?.activeProjectPath ?? null);
  };
  const fail = (res: Response, e: unknown) => deps.http.sendApiError(res,
    Number((e as { status?: number })?.status) || 400, 'VERIFICATION_ERROR', e instanceof Error ? e.message : String(e));
  app.get(`${base}/plan`, gate, async (req, res) => {
    try {
      const target = await selected(req.params.id, req.query.projectPath);
      res.set('Cache-Control', 'no-store').json({ projectPath: target.project.path, checks: await discoverVerificationChecks(target.root) });
    } catch (e) { fail(res, e); }
  });
  app.post(`${base}/advice`, gate, async (req, res) => {
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    req.once('aborted', abort); res.once('close', abort);
    try {
      const target = await selected(req.params.id, req.body?.projectPath);
      const advice = await deps.verification.suggest(target.root, target.project.path, req.body, controller.signal);
      if (!controller.signal.aborted) res.set('Cache-Control', 'no-store').json(advice);
    } catch (e) { if (!controller.signal.aborted) fail(res, e); }
    finally { req.removeListener('aborted', abort); res.removeListener('close', abort); }
  });
  app.get(base, gate, async (req, res) => {
    try {
      const target = await selected(req.params.id, req.query.projectPath);
      res.set('Cache-Control', 'no-store').json(await deps.verification.status(req.params.id, target.project.path, target.root,
        typeof req.query.runId === 'string' ? req.query.runId : undefined, req.query.live === '1'));
    } catch (e) { fail(res, e); }
  });
  app.post(base, gate, async (req, res) => {
    try {
      const target = await selected(req.params.id, req.body?.projectPath);
      res.status(202).json(await deps.verification.start(req.params.id, target.project.path, target.root, req.body?.checkIds, req.body?.timeoutMs, req.body?.expectedAdviceSnapshotSha256));
    } catch (e) { fail(res, e); }
  });
  app.post(`${base}/:runId/cancel`, gate, async (req, res) => {
    try {
      const target = await selected(req.params.id, req.body?.projectPath);
      await deps.verification.cancel(req.params.id, target.project.path, req.params.runId);
      res.json(await deps.verification.status(req.params.id, target.project.path, target.root));
    } catch (e) { fail(res, e); }
  });
  app.post(`${base}/:runId/repair`, gate, async (req, res) => {
    try {
      const target = await selected(req.params.id, req.body?.projectPath);
      res.json(await deps.verification.repair(req.params.id, target.project.path, target.root, req.params.runId, req.body?.request ?? ''));
    } catch (e) { fail(res, e); }
  });
}
