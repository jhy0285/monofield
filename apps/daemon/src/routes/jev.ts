import type { Express, Response } from 'express';
import { buildJevTriageRequest } from '@open-design/contracts';
import { evaluateJev, JevError, jevModels, jevStatus, readJevConfig, writeJevConfig } from '../integrations/jev.js';
import type { RouteDeps } from '../server-context.js';

export interface RegisterJevRoutesDeps extends RouteDeps<'http' | 'paths'> {}
export function registerJevRoutes(app: Express, ctx: RegisterJevRoutesDeps): void {
  const dataDir = ctx.paths.RUNTIME_DATA_DIR;
  const fail = (res: Response, e: unknown) => {
    const error = e instanceof JevError ? e : new JevError('UNAVAILABLE', 'Decision settings or credentials could not be accessed.', 503);
    return ctx.http.sendApiError(res, error.status, error.code, error.message);
  };
  app.get('/api/jev/status', async (_req, res) => { try { res.json(await jevStatus(dataDir)); } catch (e) { fail(res, e); } });
  app.put('/api/jev/config', ctx.http.requireLocalDaemonRequest, async (req, res) => { try { res.json(await writeJevConfig(dataDir, req.body)); } catch (e) { fail(res, e); } });
  app.get('/api/jev/models', ctx.http.requireLocalDaemonRequest, async (_req, res) => { try { res.json(await jevModels(dataDir)); } catch (e) { fail(res, e); } });
  for (const endpoint of ['decide', 'triage'] as const) {
    app.post(`/api/jev/${endpoint}`, ctx.http.requireLocalDaemonRequest, async (req, res) => {
      const abort = new AbortController();
      const onClose = () => { if (!res.writableEnded) abort.abort(); };
      res.once('close', onClose);
      try {
        let input = req.body;
        if (endpoint === 'triage') {
          if (typeof input?.state !== 'string' || !input.state.trim()) throw new JevError('INVALID_REQUEST', 'Provide the development request to evaluate.');
          const config = await readJevConfig(dataDir);
          input = buildJevTriageRequest(input.state, config.model);
        }
        res.json(await evaluateJev(dataDir, input, { signal: abort.signal }));
      } catch (e) { if (!res.destroyed) fail(res, e); }
      finally { res.off('close', onClose); }
    });
  }
}
