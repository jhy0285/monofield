import type { Express, Response } from 'express';
import { createHash } from 'node:crypto';
import { parseInterfaceSpecDocument } from '@open-design/contracts';
import { getProject } from '../db.js';
import { JevError } from '../integrations/jev.js';
import { isDocumentPath } from '../services/project-document-graph.js';
import { exportJudgmentDataset, judgmentScorecard, recordJudgmentFeedback, runJudgmentCheck, setJudgmentPolicy } from '../services/judgments.js';
import { seedJudgmentDataset } from '../services/judgment-seed.js';
import type { RouteDeps } from '../server-context.js';

export interface RegisterJudgmentRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'projectFiles'> {}

/** Judgment checks over interface specifications, the reviewer's labels, the scorecard and the policy. */
export function registerJudgmentRoutes(app: Express, deps: RegisterJudgmentRoutesDeps): void {
  const dataDir = deps.paths.RUNTIME_DATA_DIR;
  const fail = (res: Response, error: unknown, code = 'JUDGMENT_FAILED') => {
    if (error instanceof JevError) return deps.http.sendApiError(res, error.status, error.code, error.message);
    const status = Number((error as { status?: number })?.status) || 400;
    return deps.http.sendApiError(res, status, status === 404 ? 'PROJECT_NOT_FOUND' : code, error instanceof Error ? error.message : String(error));
  };

  app.post('/api/projects/:id/judgments/check', deps.http.requireLocalDaemonRequest, async (req, res) => {
    const abort = new AbortController();
    const onClose = () => { if (!res.writableEnded) abort.abort(); };
    res.once('close', onClose);
    try {
      const inputFile: unknown = req.body?.inputFile;
      if (!isDocumentPath(inputFile)) throw new Error('inputFile must be a project-relative JSON document path.');
      const project = getProject(deps.db, req.params.id);
      if (!project) throw Object.assign(new Error('Project not found.'), { status: 404 });
      const file = await deps.projectFiles.readProjectFile(deps.paths.PROJECTS_DIR, project.id, inputFile, project.metadata);
      if (file.buffer.length > 2 * 1024 * 1024) throw new Error('The document exceeds the 2 MB analysis limit.');
      const parsed = parseInterfaceSpecDocument(JSON.parse(file.buffer.toString('utf8')));
      if (!parsed.ok) throw new Error(parsed.error);
      res.set('Cache-Control', 'no-store').json(await runJudgmentCheck(dataDir, {
        doc: parsed.doc, inputFile: file.name, contentSha256: createHash('sha256').update(file.buffer).digest('hex'),
        kinds: req.body?.kinds, allowHosted: req.body?.allowHosted, signal: abort.signal,
      }));
    } catch (error) { if (!res.destroyed) fail(res, error); }
    finally { res.off('close', onClose); }
  });

  app.post('/api/judgments/feedback', deps.http.requireLocalDaemonRequest, async (req, res) => {
    try { res.json(await recordJudgmentFeedback(dataDir, req.body)); } catch (error) { fail(res, error); }
  });
  app.get('/api/judgments/scorecard', deps.http.requireLocalDaemonRequest, async (_req, res) => {
    try { res.set('Cache-Control', 'no-store').json(await judgmentScorecard(dataDir)); } catch (error) { fail(res, error); }
  });
  app.put('/api/judgments/policy', deps.http.requireLocalDaemonRequest, async (req, res) => {
    try { res.json(await setJudgmentPolicy(dataDir, req.body)); } catch (error) { fail(res, error); }
  });
  app.get('/api/judgments/dataset', deps.http.requireLocalDaemonRequest, async (req, res) => {
    try {
      const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
      const seed = req.query.seed;
      if (seed !== undefined && seed !== 'train' && seed !== 'heldout' && seed !== 'all') throw new Error('seed must be train, heldout or all.');
      // seed: the built-in SI seed set (disjoint train/held-out vocabularies); otherwise the reviewer's labels.
      const body = seed ? seedJudgmentDataset({ split: seed, ...(kind === 'field-label' || kind === 'business-name' ? { kinds: [kind] } : {}) })
        : await exportJudgmentDataset(dataDir, kind);
      res.set('Cache-Control', 'no-store').type('application/x-ndjson').send(body);
    } catch (error) { fail(res, error); }
  });
}
