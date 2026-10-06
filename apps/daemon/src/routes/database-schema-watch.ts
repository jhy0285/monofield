import type { Express, Request, Response } from 'express';
import { getProject } from '../db.js';
import type { RouteDeps } from '../server-context.js';
import { DatabaseSchemaWatchService, SchemaWatchConflict } from '../services/database-schema-watch.js';

export interface RegisterSchemaWatchRoutesDeps extends RouteDeps<'db'> {
  http: Pick<import('../server-context.js').HttpDeps, 'requireLocalDaemonRequest'>;
  schemaWatch: DatabaseSchemaWatchService;
}
export function registerSchemaWatchRoutes(app: Express, deps: RegisterSchemaWatchRoutesDeps) {
  const base = '/api/projects/:id/database/schema-watch';
  const handle = (operation: 'get' | 'configure' | 'check' | 'acknowledge') => async (req: Request, res: Response) => {
    const projectId = req.params.id;
    if (typeof projectId !== 'string' || !getProject(deps.db, projectId)) return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
    try {
      const state = operation === 'get' ? deps.schemaWatch.get(projectId)
        : operation === 'configure' ? await deps.schemaWatch.configure(projectId, req.body)
        : operation === 'check' ? await deps.schemaWatch.check(projectId)
        : await deps.schemaWatch.acknowledge(projectId, req.body?.expectedSha256);
      res.set('Cache-Control', 'no-store');
      res.json({ state });
    } catch (error) {
      res.status(error instanceof SchemaWatchConflict ? 409 : 400).json({ error: {
        code: error instanceof SchemaWatchConflict ? 'SCHEMA_CHANGED' : 'SCHEMA_WATCH_REJECTED',
        message: error instanceof Error ? error.message : 'Schema monitoring request failed.',
      } });
    }
  };
  app.get(base, deps.http.requireLocalDaemonRequest, handle('get'));
  app.put(base, deps.http.requireLocalDaemonRequest, handle('configure'));
  app.post(`${base}/check`, deps.http.requireLocalDaemonRequest, handle('check'));
  app.post(`${base}/acknowledge`, deps.http.requireLocalDaemonRequest, handle('acknowledge'));
}
