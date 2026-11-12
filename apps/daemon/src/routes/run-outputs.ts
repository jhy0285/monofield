import type { Express, Request, Response } from 'express';
import { RUN_OUTPUT_FORMATS, type RunLogListQuery, type RunLogStatus, type RunOutputFormat, type RunOutputListQuery } from '@open-design/contracts';
import type { RouteDeps } from '../server-context.js';
import { RunOutputError, type RunOutputStore } from '../services/run-outputs.js';

export interface RegisterRunOutputRoutesDeps extends RouteDeps<'http'> {
  runOutputs: RunOutputStore;
}

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
};
const TEXT_EXTENSIONS = new Set(['md', 'txt', 'csv', 'tsv', 'json', 'yaml', 'yml', 'xml', 'html', 'htm']);
const STATUSES: readonly RunLogStatus[] = ['running', 'succeeded', 'failed', 'canceled'];

const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const whole = (value: unknown): number | undefined => {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
};
/** Drops the keys a request did not send, so an absent filter is absent rather than `undefined`. */
function given<T extends object>(value: { [K in keyof T]: T[K] | undefined }): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

export function runOutputListQuery(query: Request['query']): RunOutputListQuery {
  const format = text(query.format);
  return given<RunOutputListQuery>({
    projectId: text(query.projectId), runId: text(query.runId), agentId: text(query.agentId), q: text(query.q),
    format: format && (RUN_OUTPUT_FORMATS as readonly string[]).includes(format) ? format as RunOutputFormat : undefined,
    allVersions: query.allVersions === '1' || query.allVersions === 'true' ? true : undefined,
    limit: whole(query.limit), offset: whole(query.offset),
  });
}

export function runLogListQuery(query: Request['query']): RunLogListQuery {
  const status = text(query.status);
  return given<RunLogListQuery>({
    projectId: text(query.projectId), agentId: text(query.agentId), q: text(query.q),
    status: status && (STATUSES as readonly string[]).includes(status) ? status as RunLogStatus : undefined,
    from: whole(query.from), to: whole(query.to), limit: whole(query.limit), offset: whole(query.offset),
  });
}

/**
 * The work log (`/api/run-log`) and the files runs left (`/api/run-outputs`). A kept file is served as an image or
 * as plain text, never as a page: it was written by an AI tool and must not run in the app's origin.
 */
export function registerRunOutputRoutes(app: Express, deps: RegisterRunOutputRoutesDeps): void {
  const { runOutputs } = deps;
  const local = deps.http.requireLocalDaemonRequest;
  const fail = (res: Response, error: unknown) => error instanceof RunOutputError
    ? deps.http.sendApiError(res, error.status, error.code, error.message)
    : deps.http.sendApiError(res, 500, 'RUN_OUTPUT_FAILED', (error as Error).message);
  const missing = (res: Response) => deps.http.sendApiError(res, 404, 'RUN_OUTPUT_NOT_FOUND', 'Result not found.');

  app.get('/api/run-outputs', local, (req, res) => {
    try { res.set('Cache-Control', 'no-store').json(runOutputs.list(runOutputListQuery(req.query))); } catch (error) { fail(res, error); }
  });
  app.get('/api/run-outputs/:id', local, async (req, res) => {
    try {
      const detail = await runOutputs.detail(String(req.params.id));
      if (!detail) return missing(res);
      res.set('Cache-Control', 'no-store').json(detail);
    } catch (error) { fail(res, error); }
  });
  app.get('/api/run-outputs/:id/content', local, async (req, res) => {
    try {
      const output = runOutputs.output(String(req.params.id));
      const bytes = output ? await runOutputs.content(output.id) : null;
      if (!output || !bytes) return missing(res);
      const extension = output.name.split('.').pop()?.toLowerCase() ?? '';
      const download = req.query.download === '1';
      const type = download ? 'application/octet-stream'
        : IMAGE_TYPES[extension] ?? (TEXT_EXTENSIONS.has(extension) ? 'text/plain; charset=utf-8' : 'application/octet-stream');
      res.set({
        'Content-Type': type,
        'Content-Disposition': `${download || type === 'application/octet-stream' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(output.name)}`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'",
        // A version's bytes never change.
        'Cache-Control': 'private, max-age=31536000, immutable',
      }).send(bytes);
    } catch (error) { fail(res, error); }
  });
  app.post('/api/run-outputs/:id/restore', local, async (req, res) => {
    try { res.json(await runOutputs.restore(String(req.params.id))); } catch (error) { fail(res, error); }
  });

  app.get('/api/run-log', local, (req, res) => {
    try { res.set('Cache-Control', 'no-store').json(runOutputs.runs(runLogListQuery(req.query))); } catch (error) { fail(res, error); }
  });
  app.get('/api/run-log/usage', local, (req, res) => {
    try { res.set('Cache-Control', 'no-store').json(runOutputs.usage(runLogListQuery(req.query))); } catch (error) { fail(res, error); }
  });
}
