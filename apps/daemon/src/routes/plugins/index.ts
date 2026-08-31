import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import type { InstalledPluginSummary } from '@open-design/contracts';
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import path from 'node:path';
import type { PluginShareAction } from '../../services/plugin-share-tasks.js';

export interface RegisterPluginEventRoutesDeps {
  http: { requireLocalDaemonRequest: RequestHandler };
}

interface SqliteRowId {
  id: string;
}

interface SqliteDbLike {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): unknown;
  };
}

interface InstalledPluginLike {
  id?: string;
  title?: string;
  version?: string;
  sourceKind?: string;
  sourceMarketplaceId?: string;
  sourceMarketplaceEntryName?: string;
  sourceMarketplaceEntryVersion?: string;
  marketplaceTrust?: string;
  trust?: string;
  updatedAt?: number;
  manifest?: Record<string, unknown>;
  capabilitiesGranted?: string[];
  appliedPlugin?: { capabilitiesGranted?: string[]; [key: string]: unknown };
  assistantMessageId?: string;
  [key: string]: unknown;
}

interface AppliedPluginSnapshotLike {
  snapshotId: string;
  pluginId: string;
  [key: string]: unknown;
}

interface MissingInputErrorLike extends Error {
  fields: string[];
}

interface PluginApplyResult {
  result: {
    capabilitiesGranted: string[];
    appliedPlugin: { capabilitiesGranted: string[]; [key: string]: unknown };
    [key: string]: unknown;
  };
  warnings: unknown[];
  manifestSourceDigest?: string;
}

interface PluginShareTaskLike {
  status: 'queued' | 'running' | 'done' | 'failed';
  progress: string[];
  waiters: Set<() => void>;
}

interface PluginRouteHelpers {
  PLUGIN_PREVIEWS_DIR: string;
  pluginUpload: {
    single(field: string): RequestHandler;
    array(field: string, maxCount?: number): RequestHandler;
  };
  pluginInstallation: {
    stageUploadedPluginZip(buffer: Buffer, source: string): Promise<unknown>;
    stageUploadedPluginFolder(files: Array<{ buffer: Buffer; originalname: string }>, rawPaths: unknown): Promise<unknown>;
  };
  connectorService: unknown;
  resolvedPortRef: { current: number | null | undefined };
  pluginShareTaskStore: {
    get(id: string): PluginShareTaskLike | null;
    snapshot(task: PluginShareTaskLike, since?: number): unknown;
  };
  applyBakedPreviews(plugins: InstalledPluginLike[], previewsDir: string): unknown;
  sendMulterError(res: Response, err: unknown): unknown;
  decodeMultipartFilename(name: string): string;
  installOrUpgradePlugin(req: Request, res: Response, mode: 'install' | 'upgrade'): Promise<unknown>;
  loadPluginRegistryView(): Promise<unknown>;
  buildConnectorProbe(service: unknown): unknown;
  handleShareProject(req: Request, res: Response): Promise<unknown>;
  handlePluginTrust(req: Request, res: Response): Promise<unknown>;
  handlePluginStats(res: Response): Promise<unknown> | unknown;
  requireLocalDaemonRequest: RequestHandler;
  handleAppliedPluginExport(req: Request, res: Response): Promise<unknown>;
  handleProjectInstallFolder(req: Request, res: Response): Promise<unknown>;
  handleProjectPluginCli(req: Request, res: Response, action: PluginShareAction): Promise<unknown>;
  getProject(db: SqliteDbLike, id: string): unknown;
  sendApiError(res: Response, status: number, code: string, message: string): unknown;
  isLocalSameOrigin(req: Request, port: number | null | undefined): boolean;
  handleCandidateDraft(req: Request, res: Response): Promise<unknown>;
  handleCandidateShareTask(req: Request, res: Response): Promise<unknown>;
  handleProjectShareTask(req: Request, res: Response): Promise<unknown>;
  // Managed enterprise distributions expose and execute only plugins that
  // satisfy an administrator-owned distribution policy. Optional keeps this
  // route bundle reusable by open-mode tests and downstream embedders.
  managedDistributionOnly?: boolean;
  isPluginAllowed?(plugin: InstalledPluginLike): boolean;
}

interface PluginSnapshotResolutionLike {
  ok: boolean;
  status?: number;
  body?: unknown;
  snapshotId?: string;
  snapshot?: Record<string, unknown>;
  applyResult?: PluginApplyResult['result'];
}

function localizedText(value: unknown, locale?: string): string | undefined {
  if (typeof value === 'string') return value || undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = value as Record<string, unknown>;
  const language = locale?.split('-')[0];
  const candidates = [locale, language, 'en'].filter((item): item is string => Boolean(item));
  for (const candidate of candidates) {
    const resolved = entries[candidate];
    if (typeof resolved === 'string' && resolved.length > 0) return resolved;
  }
  return Object.values(entries).find((entry): entry is string => (
    typeof entry === 'string' && entry.length > 0
  ));
}

function compactPreview(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const compact: Record<string, unknown> = {};
  for (const key of ['type', 'poster', 'video', 'gif', 'entry', 'audio', 'motion']) {
    const field = source[key];
    if (typeof field !== 'string' || field.length === 0 || field.startsWith('data:')) continue;
    // A picker only needs a fetchable preview reference. Refuse unexpectedly
    // large inline-ish values even when they do not use the data: scheme.
    compact[key] = field.slice(0, 2_048);
  }
  if (typeof source.holdMs === 'number' && Number.isFinite(source.holdMs)) {
    compact.holdMs = source.holdMs;
  }
  return Object.keys(compact).length > 0 ? compact : undefined;
}

function compactText(value: string | undefined, maxLength: number): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function compactStringList(
  value: unknown,
  options: { maxItems: number; maxItemLength: number },
): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const compact = Array.from(new Set(value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.slice(0, options.maxItemLength))))
    .slice(0, options.maxItems);
  return compact.length > 0 ? compact : undefined;
}

function previewManifestStamp(previewsDir: string): number {
  try {
    return statSync(path.join(previewsDir, 'manifest.json')).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Read a cheap revision without parsing every manifest_json cell. A summary
 * cache hit used to call listInstalledPlugins first, which defeated most of
 * the cache by JSON-parsing hundreds of full manifests on every navigation.
 *
 * Tests/downstream embedders may expose only a minimal SqliteDbLike. In that
 * case return null and let the compatible record-derived fingerprint path run.
 */
function readPluginSummaryRevision(
  db: SqliteDbLike,
  previewsDir: string,
  managedDistributionOnly: boolean,
): string | null {
  try {
    const rows = db.prepare(`
      SELECT id, version, updated_at AS updatedAt, trust,
             source_marketplace_id AS sourceMarketplaceId,
             source_marketplace_entry_version AS sourceMarketplaceEntryVersion
      FROM installed_plugins
      ORDER BY id ASC
    `).all() as Array<Record<string, unknown>>;
    if (rows.some((row) => (
      typeof row.id !== 'string'
      || typeof row.version !== 'string'
      || typeof row.updatedAt !== 'number'
      || typeof row.trust !== 'string'
    ))) return null;
    const marketplaceRows = managedDistributionOnly
      ? db.prepare(`
          SELECT id, refreshed_at AS refreshedAt
          FROM plugin_marketplaces
          ORDER BY id ASC
        `).all() as Array<Record<string, unknown>>
      : [];
    return createHash('sha256')
      .update(JSON.stringify({
        rows,
        marketplaceRows,
        previewManifestStamp: previewManifestStamp(previewsDir),
      }))
      .digest('hex');
  } catch {
    return null;
  }
}

/** Build the intentionally small record used by plugin pickers on Home. */
export function summarizeInstalledPlugin(
  plugin: InstalledPluginLike,
  locale?: string,
): InstalledPluginSummary {
  const manifest = plugin.manifest ?? {};
  const extension = manifest.od && typeof manifest.od === 'object' && !Array.isArray(manifest.od)
    ? manifest.od as Record<string, unknown>
    : {};
  const useCase = extension.useCase && typeof extension.useCase === 'object' && !Array.isArray(extension.useCase)
    ? extension.useCase as Record<string, unknown>
    : {};
  const context = extension.context && typeof extension.context === 'object' && !Array.isArray(extension.context)
    ? extension.context as Record<string, unknown>
    : {};
  const designSystem = context.designSystem && typeof context.designSystem === 'object' && !Array.isArray(context.designSystem)
    ? context.designSystem as Record<string, unknown>
    : {};
  const stages = extension.pipeline && typeof extension.pipeline === 'object' && !Array.isArray(extension.pipeline)
    ? (extension.pipeline as { stages?: unknown }).stages
    : undefined;
  const pipelineAtoms = Array.isArray(stages)
    ? Array.from(new Set(stages.flatMap((stage) => {
        if (!stage || typeof stage !== 'object' || Array.isArray(stage)) return [];
        const atoms = (stage as { atoms?: unknown }).atoms;
        return Array.isArray(atoms) ? atoms.filter((atom): atom is string => typeof atom === 'string') : [];
      })))
    : [];
  const examples = Array.isArray(useCase.exampleOutputs) ? useCase.exampleOutputs : [];
  const example = examples.find((entry) => entry && typeof entry === 'object' && !Array.isArray(entry)) as Record<string, unknown> | undefined;
  const title = localizedText(manifest.title_i18n, locale)
    ?? (typeof plugin.title === 'string' && plugin.title.length > 0 ? plugin.title : undefined)
    ?? localizedText(manifest.title, locale)
    ?? (typeof plugin.id === 'string' ? plugin.id : 'plugin');
  const name = typeof manifest.name === 'string' && manifest.name.length > 0
    ? manifest.name
    : (typeof plugin.id === 'string' && plugin.id.length > 0 ? plugin.id : 'plugin');
  const id = typeof plugin.id === 'string' ? plugin.id : name;
  const summary: InstalledPluginSummary = {
    summary: true,
    id,
    title,
    trust: (typeof plugin.trust === 'string' ? plugin.trust : 'untrusted') as InstalledPluginSummary['trust'],
    // These two short fields are rendered directly in marketplace cards and
    // source tabs. Omitting them made every compact record look like a local
    // 0.0.0 plugin, which was smaller but semantically incorrect.
    ...(typeof plugin.version === 'string' ? { version: plugin.version } : {}),
    ...(typeof plugin.sourceKind === 'string'
      ? { sourceKind: plugin.sourceKind as InstalledPluginSummary['sourceKind'] }
      : {}),
    ...(name !== id ? { name } : {}),
  };
  const copy = <K extends keyof InstalledPluginSummary>(key: K, value: InstalledPluginSummary[K] | undefined) => {
    if (value !== undefined) summary[key] = value;
  };
  copy('marketplaceTrust', plugin.marketplaceTrust as InstalledPluginSummary['marketplaceTrust']);
  // Card descriptions and all author/source metadata are detail-only. Rich
  // cards fetch the one hovered record lazily instead of shipping hundreds of
  // descriptions during app startup.
  copy('tags', compactStringList(manifest.tags, { maxItems: 16, maxItemLength: 80 }));
  for (const key of ['kind', 'taskKind', 'mode', 'scenario', 'surface'] as const) {
    copy(key, typeof extension[key] === 'string'
      ? compactText(extension[key] as string, 120)
      : undefined);
  }
  copy('hidden', typeof extension.hidden === 'boolean' ? extension.hidden : undefined);
  copy('preview', compactPreview(extension.preview));
  copy('bakedPreview', compactPreview(extension.bakedPreview));
  copy('hasQuery', localizedText(useCase.query, locale) !== undefined ? true : undefined);
  copy('pipelineAtoms', compactStringList(pipelineAtoms, { maxItems: 24, maxItemLength: 80 }));
  copy('designSystemRef', typeof designSystem.ref === 'string'
    ? compactText(designSystem.ref, 512)
    : undefined);
  copy('exampleOutput', example && typeof example.path === 'string'
    ? {
        path: example.path.slice(0, 1_024),
        ...(typeof example.title === 'string'
          ? { title: compactText(example.title, 160) }
          : {}),
      }
    : undefined);
  return summary;
}

export interface RegisterPluginRoutesDeps {
  db: SqliteDbLike;
  paths: { PROJECTS_DIR: string; PLUGIN_REGISTRY_ROOTS: string[]; PLUGIN_LOCKFILE_PATH: string };
  plugins: {
    listInstalledPlugins: (db: SqliteDbLike) => InstalledPluginLike[];
    getInstalledPlugin: (db: SqliteDbLike, id: string) => InstalledPluginLike | null;
    installPlugin: (db: SqliteDbLike, args: unknown) => AsyncIterable<unknown>;
    uninstallPlugin: (db: SqliteDbLike, id: string, roots: string[]) => Promise<{ ok: boolean; removedFolder?: boolean; warning?: string }>;
    installFromLocalFolder: (db: SqliteDbLike, args: unknown) => AsyncIterable<unknown>;
    applyPlugin: (args: unknown) => PluginApplyResult;
    doctorPlugin: (plugin: InstalledPluginLike, registry: unknown, extras: unknown) => unknown;
    getSnapshot: (db: SqliteDbLike, id: string) => AppliedPluginSnapshotLike | null;
    pruneExpiredSnapshots: (db: SqliteDbLike, opts?: { before?: number }) => { removed: number; ids: string[] };
    readPluginLockfile: (path: string) => Promise<unknown>;
    resolvePluginSnapshot: (args: unknown) => PluginSnapshotResolutionLike | null;
    MissingInputError: new (...args: unknown[]) => MissingInputErrorLike;
    pluginPromptBlock: (snap: AppliedPluginSnapshotLike) => string;
    listSkillPluginCandidates: (db: SqliteDbLike, projectId: string, includeDismissed?: boolean) => InstalledPluginLike[];
    dismissSkillPluginCandidate: (db: SqliteDbLike, projectId: string, candidateId: string) => InstalledPluginLike | null;
    generateSkillPluginDraft: (db: SqliteDbLike, projectRoot: string, projectId: string, candidateId: string) => Promise<unknown>;
    FIRST_PARTY_ATOMS: unknown[];
  };
  helpers: PluginRouteHelpers;
}

export function registerPluginEventRoutes(app: Express, deps: RegisterPluginEventRoutesDeps): void {
  app.get('/api/plugins/events/snapshot', async (req, res) => {
    const since = Number(typeof req.query.since === 'string' ? req.query.since : 0);
    const { pluginEventSnapshot } = await import('../../plugins/events.js');
    const events = pluginEventSnapshot(Number.isFinite(since) && since > 0 ? since : 0);
    res.json({ events, count: events.length, generatedAt: Date.now() });
  });
  app.get('/api/plugins/events/stats', async (_req, res) => {
    const { pluginEventSnapshot, summarisePluginEvents } = await import('../../plugins/events.js');
    res.json({ stats: summarisePluginEvents(pluginEventSnapshot()), generatedAt: Date.now() });
  });
  app.post('/api/plugins/events/purge', deps.http.requireLocalDaemonRequest, async (_req, res) => {
    try {
      const { purgePluginEventBuffer } = await import('../../plugins/events.js');
      res.json({ ok: true, ...purgePluginEventBuffer() });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });
  app.get('/api/plugins/events', async (req, res) => {
    const since = Number(typeof req.query.since === 'string' ? req.query.since : 0);
    const { pluginEventSnapshot, subscribePluginEvents } = await import('../../plugins/events.js');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    for (const ev of pluginEventSnapshot(Number.isFinite(since) && since > 0 ? since : 0)) res.write(`event: backlog\ndata: ${JSON.stringify(ev)}\n\n`);
    const unsubscribe = subscribePluginEvents((ev) => res.write(`event: plugin\ndata: ${JSON.stringify(ev)}\n\n`));
    req.on('close', () => { unsubscribe(); });
  });
}

export function registerPluginRoutes(app: Express, deps: RegisterPluginRoutesDeps): void {
  const { db, paths, plugins, helpers } = deps;
  const summaryCache = new Map<string, {
    fingerprint: string;
    plugins: InstalledPluginSummary[];
    body: string;
    etag: string;
  }>();
  const isPluginAllowed = (plugin: InstalledPluginLike): boolean =>
    helpers.isPluginAllowed?.(plugin) !== false;
  const managedPolicyBlocked = (res: Response, message: string) => res.status(403).json({
    error: {
      code: 'managed-plugin-policy-blocked',
      message,
    },
  });
  const isSnapshotAllowed = (snapshot: AppliedPluginSnapshotLike): boolean => {
    const plugin = plugins.getInstalledPlugin(db, snapshot.pluginId);
    return Boolean(plugin && isPluginAllowed(plugin));
  };

  app.get('/api/plugins', async (req, res) => {
    try {
      const requestedView = typeof req.query.view === 'string'
        ? req.query.view
        : req.get('x-monofield-plugin-view');
      if (requestedView === 'summary') {
        const locale = typeof req.query.locale === 'string'
          ? req.query.locale
          : req.get('x-monofield-locale');
        const cacheKey = locale?.toLowerCase() || 'default';
        const fastFingerprint = readPluginSummaryRevision(
          db,
          helpers.PLUGIN_PREVIEWS_DIR,
          helpers.managedDistributionOnly === true,
        );
        const cached = summaryCache.get(cacheKey);
        const sendSummary = (entry: NonNullable<typeof cached>) => {
          res.vary('x-monofield-plugin-view');
          res.vary('x-monofield-locale');
          res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
          res.setHeader('ETag', entry.etag);
          const validators = (req.get('if-none-match') ?? '')
            .split(',')
            .map((value) => value.trim());
          if (validators.includes(entry.etag) || validators.includes('*')) {
            return res.status(304).end();
          }
          return res.type('application/json').send(entry.body);
        };
        if (cached && fastFingerprint && cached.fingerprint === fastFingerprint) {
          return sendSummary(cached);
        }
        const visible = plugins.listInstalledPlugins(db).filter(isPluginAllowed);
        const fingerprint = fastFingerprint ?? visible.map((plugin) => [
          plugin.id,
          plugin.version,
          plugin.updatedAt,
          plugin.trust,
          plugin.sourceMarketplaceId,
          plugin.sourceMarketplaceEntryVersion,
          previewManifestStamp(helpers.PLUGIN_PREVIEWS_DIR),
        ].join(':')).join('|');
        const withPreviews = helpers.applyBakedPreviews(
          visible,
          helpers.PLUGIN_PREVIEWS_DIR,
        ) as InstalledPluginLike[];
        const summaries = withPreviews.map((plugin) => summarizeInstalledPlugin(plugin, locale));
        const body = JSON.stringify({ plugins: summaries });
        const entry = {
          fingerprint,
          plugins: summaries,
          body,
          etag: `"${createHash('sha256').update(body).digest('base64url')}"`,
        };
        summaryCache.set(cacheKey, entry);
        while (summaryCache.size > 8) {
          const oldest = summaryCache.keys().next().value;
          if (typeof oldest !== 'string') break;
          summaryCache.delete(oldest);
        }
        return sendSummary(entry);
      }
      const visible = plugins.listInstalledPlugins(db).filter(isPluginAllowed);
      const withPreviews = helpers.applyBakedPreviews(
        visible,
        helpers.PLUGIN_PREVIEWS_DIR,
      ) as InstalledPluginLike[];
      res.json({ plugins: withPreviews });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
  app.get('/api/plugins/:id', async (req, res) => {
    try {
      const plugin = plugins.getInstalledPlugin(db, req.params.id);
      if (!plugin || !isPluginAllowed(plugin)) {
        return res.status(404).json({ error: 'plugin not found' });
      }
      const [withPreview] = helpers.applyBakedPreviews(
        [plugin],
        helpers.PLUGIN_PREVIEWS_DIR,
      ) as InstalledPluginLike[];
      return res.json(withPreview ?? plugin);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });
  app.post('/api/plugins/upload-zip', (req, res) => helpers.pluginUpload.single('file')(req, res, async (err: unknown) => { if (err) return helpers.sendMulterError(res, err); try { const file = req.file; if (!file?.buffer) return res.status(400).json({ error: 'file is required' }); const result = await helpers.pluginInstallation.stageUploadedPluginZip(file.buffer, `upload:zip:${helpers.decodeMultipartFilename(file.originalname || 'plugin.zip')}`); res.status((result as { ok?: boolean }).ok ? 200 : 400).json(result); } catch (uploadErr: unknown) { res.status(400).json({ ok: false, warnings: [], message: uploadErr instanceof Error ? uploadErr.message : String(uploadErr), log: [] }); } }));
  app.post('/api/plugins/upload-folder', (req, res) => helpers.pluginUpload.array('files', 500)(req, res, async (err: unknown) => { if (err) return helpers.sendMulterError(res, err); try { const files = Array.isArray(req.files) ? req.files as Array<{ buffer: Buffer; originalname: string }> : []; if (files.length === 0) return res.status(400).json({ error: 'files are required' }); const result = await helpers.pluginInstallation.stageUploadedPluginFolder(files, req.body?.paths); res.status((result as { ok?: boolean } | null)?.ok ? 200 : 400).json(result); } catch (uploadErr: unknown) { res.status(400).json({ ok: false, warnings: [], message: uploadErr instanceof Error ? uploadErr.message : String(uploadErr), log: [] }); } }));
  app.post('/api/plugins/install', async (req, res) => helpers.installOrUpgradePlugin(req, res, 'install'));
  app.post('/api/plugins/:id/uninstall', async (req, res) => { try { const result = await plugins.uninstallPlugin(db, req.params.id, paths.PLUGIN_REGISTRY_ROOTS); if (!result.ok && !result.removedFolder) return res.status(404).json({ error: 'plugin not found', warning: result.warning }); res.json(result); } catch (err) { res.status(500).json({ error: String(err) }); } });
  app.post('/api/plugins/:id/upgrade', async (req, res) => helpers.installOrUpgradePlugin(req, res, 'upgrade'));
  app.post('/api/plugins/:id/apply', async (req, res) => {
    try {
      const plugin = plugins.getInstalledPlugin(db, req.params.id);
      if (!plugin) return res.status(404).json({ error: 'plugin not found' });
      if (!isPluginAllowed(plugin)) {
        return managedPolicyBlocked(res, 'This plugin is not approved by the managed distribution policy.');
      }
      const body = req.body && typeof req.body === 'object'
        ? req.body as Record<string, unknown>
        : {};
      const inputs = body.inputs && typeof body.inputs === 'object' ? body.inputs : {};
      const grantCaps = Array.isArray(body.grantCaps)
        ? body.grantCaps.filter((c: unknown): c is string => typeof c === 'string')
        : [];
      if (helpers.managedDistributionOnly && grantCaps.length > 0) {
        return managedPolicyBlocked(
          res,
          'Request-scoped capability grants are disabled in managed distribution mode.',
        );
      }
      const locale = typeof body.locale === 'string' ? body.locale : undefined;
      const registry = await helpers.loadPluginRegistryView();
      const connectorProbe = helpers.buildConnectorProbe(helpers.connectorService);

      // Applying from an existing project must return a real, persisted
      // snapshot. The composer sends that id to POST /api/runs, which keeps
      // the selected plugin frozen even if the installed plugin changes
      // between selection and send. Project-less Home applies remain a pure
      // preview; POST /api/projects persists them through the same resolver.
      const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
      if (projectId) {
        const conversationId = typeof body.conversationId === 'string'
          ? body.conversationId.trim()
          : '';
        const resolved = plugins.resolvePluginSnapshot({
          db,
          body: {
            pluginId: req.params.id,
            pluginInputs: inputs,
            grantCaps,
            locale,
          },
          projectId,
          ...(conversationId ? { conversationId } : {}),
          registry,
          connectorProbe,
        });
        if (!resolved) {
          return res.status(500).json({
            error: { code: 'plugin-apply-failed', message: 'Plugin apply did not produce a snapshot.' },
          });
        }
        if (!resolved.ok) {
          const responseBody = resolved.body && typeof resolved.body === 'object'
            ? resolved.body as Record<string, unknown>
            : { error: 'plugin apply failed' };
          const error = responseBody.error && typeof responseBody.error === 'object'
            ? responseBody.error as Record<string, unknown>
            : null;
          const data = error?.data && typeof error.data === 'object'
            ? error.data as Record<string, unknown>
            : null;
          return res.status(resolved.status ?? 400).json({
            ...responseBody,
            ...(Array.isArray(data?.missing) ? { fields: data.missing } : {}),
          });
        }
        if (!resolved.applyResult || !resolved.snapshot || !resolved.snapshotId) {
          return res.status(500).json({
            error: { code: 'plugin-apply-failed', message: 'Persisted plugin apply result is incomplete.' },
          });
        }
        return res.json({
          ok: true,
          ...resolved.applyResult,
          appliedPlugin: resolved.snapshot,
          warnings: [],
          manifestSourceDigest: resolved.snapshot.manifestSourceDigest,
        });
      }

      const computed = plugins.applyPlugin({ plugin, inputs, registry, locale, connectorProbe });
      if (grantCaps.length > 0) {
        const merged = new Set([...computed.result.capabilitiesGranted, ...grantCaps]);
        computed.result.capabilitiesGranted = Array.from(merged);
        computed.result.appliedPlugin.capabilitiesGranted = Array.from(merged);
      }
      res.json({
        ok: true,
        ...computed.result,
        warnings: computed.warnings,
        manifestSourceDigest: computed.manifestSourceDigest,
      });
    } catch (err: unknown) {
      if (err instanceof plugins.MissingInputError) {
        return res.status(422).json({ error: 'missing_inputs', fields: err.fields });
      }
      res.status(500).json({ error: String(err) });
    }
  });
  app.post('/api/plugins/:id/share-project', async (req, res) => {
    if (helpers.managedDistributionOnly) {
      return managedPolicyBlocked(
        res,
        'Public plugin sharing is disabled in managed distribution mode. Publish through the company SCM and approval pipeline.',
      );
    }
    return helpers.handleShareProject(req, res);
  });
  app.post('/api/plugins/:id/doctor', async (req, res) => { try { const plugin = plugins.getInstalledPlugin(db, req.params.id); if (!plugin) return res.status(404).json({ error: 'plugin not found' }); if (!isPluginAllowed(plugin)) return managedPolicyBlocked(res, 'This plugin is not approved by the managed distribution policy.'); const registry = await helpers.loadPluginRegistryView(); const connectorProbe = helpers.buildConnectorProbe(helpers.connectorService); res.json(plugins.doctorPlugin(plugin, registry, { connectorProbe })); } catch (err) { res.status(500).json({ error: String(err) }); } });
  app.post('/api/plugins/:id/trust', async (req, res) => {
    if (helpers.managedDistributionOnly) {
      return managedPolicyBlocked(
        res,
        'Local plugin trust changes are disabled in managed distribution mode.',
      );
    }
    return helpers.handlePluginTrust(req, res);
  });
  app.get('/api/plugins/stats', async (_req, res) => helpers.handlePluginStats(res));
  app.get('/api/applied-plugins/:snapshotId', (req, res) => { try { const snap = plugins.getSnapshot(db, req.params.snapshotId); if (!snap || !isSnapshotAllowed(snap)) return res.status(404).json({ error: 'snapshot not found' }); res.json(snap); } catch (err) { res.status(500).json({ error: String(err) }); } });
  app.get('/api/applied-plugins/:snapshotId/canon', (req, res) => { try { const snap = plugins.getSnapshot(db, req.params.snapshotId); if (!snap || !isSnapshotAllowed(snap)) return res.status(404).json({ error: 'snapshot not found' }); const block = plugins.pluginPromptBlock(snap); const accepts = String(req.headers.accept ?? '').toLowerCase(); if (accepts.includes('text/plain')) { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.send(block); return; } res.json({ snapshotId: snap.snapshotId, pluginId: snap.pluginId, block }); } catch (err) { res.status(500).json({ error: String(err) }); } });
  app.get('/api/applied-plugins', (_req, res) => { try { const rows = db.prepare(`SELECT id FROM applied_plugin_snapshots ORDER BY applied_at DESC LIMIT 500`).all() as SqliteRowId[]; res.json({ snapshots: rows.map((r) => plugins.getSnapshot(db, r.id)).filter((x): x is AppliedPluginSnapshotLike => x !== null && isSnapshotAllowed(x)) }); } catch (err) { res.status(500).json({ error: String(err) }); } });
  app.get('/api/projects/:projectId/applied-plugins', (req, res) => { try { const rows = db.prepare(`SELECT id FROM applied_plugin_snapshots WHERE project_id = ? ORDER BY applied_at DESC`).all(req.params.projectId) as SqliteRowId[]; res.json({ snapshots: rows.map((r) => plugins.getSnapshot(db, r.id)).filter((x): x is AppliedPluginSnapshotLike => x !== null && isSnapshotAllowed(x)) }); } catch (err) { res.status(500).json({ error: String(err) }); } });
  app.post('/api/applied-plugins/export', helpers.requireLocalDaemonRequest, async (req, res) => helpers.handleAppliedPluginExport(req, res));
  app.post('/api/applied-plugins/prune', async (req, res) => { try { const body = req.body && typeof req.body === 'object' ? req.body : {}; const before = typeof body.before === 'number' ? body.before : undefined; const result = plugins.pruneExpiredSnapshots(db, before ? { before } : {}); if (result.removed > 0) { try { const { recordPluginEvent } = await import('../../plugins/events.js'); recordPluginEvent({ kind: 'plugin.snapshot-pruned', pluginId: '', details: { removed: result.removed, ...(before ? { before } : {}) } }); } catch {} } res.json({ ok: true, removed: result.removed, ids: result.ids }); } catch (err) { res.status(500).json({ error: String(err) }); } });
}

export function registerProjectPluginRoutes(app: Express, deps: RegisterPluginRoutesDeps): void {
  const { db, paths, plugins, helpers } = deps;
  app.post('/api/projects/:id/plugins/install-folder', async (req, res) => helpers.handleProjectInstallFolder(req, res));
  const managedSharingBlocked = (res: Response) => res.status(403).json({
    error: {
      code: 'managed-plugin-sharing-blocked',
      message: 'Public plugin sharing is disabled in managed distribution mode. Publish through the company SCM and approval pipeline.',
    },
  });
  app.post('/api/projects/:id/plugins/publish-github', async (req, res) => helpers.managedDistributionOnly ? managedSharingBlocked(res) : helpers.handleProjectPluginCli(req, res, 'publish-github'));
  app.get('/api/projects/:id/plugin-candidates', (req, res) => { try { const project = helpers.getProject(db, req.params.id); if (!project) return helpers.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found'); const includeDismissed = req.query.includeDismissed === 'true'; res.json({ candidates: plugins.listSkillPluginCandidates(db, req.params.id, includeDismissed) }); } catch (err: unknown) { res.status(400).json({ error: err instanceof Error ? err.message : String(err) }); } });
  app.post('/api/projects/:id/plugin-candidates/:candidateId/dismiss', (req, res) => { if (!helpers.isLocalSameOrigin(req, helpers.resolvedPortRef.current)) return res.status(403).json({ error: 'cross-origin request rejected' }); const candidate = plugins.dismissSkillPluginCandidate(db, req.params.id, req.params.candidateId); if (!candidate) return helpers.sendApiError(res, 404, 'NOT_FOUND', 'plugin candidate not found'); if (candidate.assistantMessageId) db.prepare(`DELETE FROM messages WHERE id = ?`).run(candidate.assistantMessageId); res.json({ ok: true, candidate }); });
  app.post('/api/projects/:id/plugin-candidates/:candidateId/draft', async (req, res) => helpers.handleCandidateDraft(req, res));
  app.post('/api/projects/:id/plugin-candidates/:candidateId/share-tasks', async (req, res) => helpers.managedDistributionOnly ? managedSharingBlocked(res) : helpers.handleCandidateShareTask(req, res));
  app.post('/api/projects/:id/plugins/contribute-open-design', async (req, res) => helpers.managedDistributionOnly ? managedSharingBlocked(res) : helpers.handleProjectPluginCli(req, res, 'contribute-open-design'));
  app.post('/api/projects/:id/plugins/share-tasks', async (req, res) => helpers.managedDistributionOnly ? managedSharingBlocked(res) : helpers.handleProjectShareTask(req, res));
  app.post('/api/plugins/share-tasks/:id/wait', (req, res) => {
    if (!helpers.isLocalSameOrigin(req, helpers.resolvedPortRef.current)) return res.status(403).json({ error: 'cross-origin request rejected' });
    const task = helpers.pluginShareTaskStore.get(req.params.id);
    if (!task) return res.status(404).json({ error: 'task not found' });
    const since = Number.isFinite(req.body?.since) ? Number(req.body.since) : 0;
    const requestedTimeout = Number.isFinite(req.body?.timeoutMs) ? Number(req.body.timeoutMs) : 25_000;
    const timeoutMs = Math.min(Math.max(requestedTimeout, 0), 25_000);
    const respond = () => { if (!res.writableEnded) res.json(helpers.pluginShareTaskStore.snapshot(task, since)); };
    if (task.status === 'done' || task.status === 'failed' || task.progress.length > since) return respond();
    let resolved = false;
    const wake = () => { if (resolved) return; resolved = true; task.waiters.delete(wake); clearTimeout(timer); respond(); };
    task.waiters.add(wake);
    const timer = setTimeout(wake, timeoutMs);
    res.on('close', wake);
  });
}
