// Baked plugin preview clips — the daemon side of scripts/bake-plugin-previews.mjs.
//
// The home gallery renders html plugins as live, scaled hover-pan iframes, which
// is GPU-expensive at scale. When a plugin has a pre-baked preview (a small VP9
// `.webm` hover-pan clip + a poster `.jpg`), we rewrite that plugin's record so
// its `od.preview` becomes a `video` block. The web gallery's `inferPluginPreview`
// then classifies it as `media` and renders a cheap poster + hover-play `<video>`
// (MediaSurface) instead of a live iframe. Plugins without a bake are left
// untouched and keep the live-iframe path as the fallback.
//
// Files + a `manifest.json` live under `<dir>` (OD_PLUGIN_PREVIEWS_DIR, default
// `<project>/.od/plugin-previews`). CI bakes them and uploads to R2; the daemon
// serves whatever is present locally at `/api/plugin-previews/<file>`.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const PLUGIN_PREVIEWS_ROUTE = '/api/plugin-previews';

// Public R2 (Cloudflare CDN) origin the baked clips are published to. Used as
// the default so the packaged desktop app and the web deployment both serve
// previews with zero configuration; OD_PLUGIN_PREVIEWS_BASE_URL overrides it.
const DEFAULT_PUBLIC_BASE = 'https://repo-assets.open-design.ai/plugin-previews';

interface BakeEntry {
  video: string;
  poster: string;
  holdMs?: number;
  durationMs?: number;
}

export interface BakedPreviewBlock {
  poster: string;
  video: string;
  holdMs?: number;
}

export function resolvePluginPreviewsDir(projectRoot: string): string {
  const env = process.env.OD_PLUGIN_PREVIEWS_DIR;
  if (env) return path.isAbsolute(env) ? env : path.resolve(projectRoot, env);
  // Default to the checked-in manifest dir (CI commits manifest.json here; the
  // clips themselves live on R2). Local dev overrides OD_PLUGIN_PREVIEWS_DIR to
  // a freshly-baked dir that also holds the mp4/poster files for local serving.
  return path.join(projectRoot, 'data', 'plugin-previews');
}

let cache: {
  dir: string;
  mtimeMs: number;
  previews: Record<string, BakeEntry>;
  blocks?: Record<string, BakedPreviewBlock>;
} | null = null;

function loadManifest(dir: string): Record<string, BakeEntry> {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) return {};
  try {
    const mtimeMs = statSync(manifestPath).mtimeMs;
    if (cache && cache.dir === dir && cache.mtimeMs === mtimeMs) return cache.previews;
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      previews?: Record<string, BakeEntry>;
    };
    const previews = parsed.previews ?? {};
    cache = { dir, mtimeMs, previews };
    return previews;
  } catch (err) {
    // A malformed/unreadable manifest would otherwise silently disable every
    // baked preview with no trace; surface it so it's diagnosable.
    console.warn(`[plugin-preview-bakes] failed to load ${manifestPath}: ${String(err)}`);
    return {};
  }
}

export function bakedPreviewBlock(id: string, dir: string): BakedPreviewBlock | null {
  const previews = loadManifest(dir);
  const entry = previews[id];
  if (!entry || !entry.video || !entry.poster) return null;
  if (cache?.dir === dir && cache.blocks) return cache.blocks[id] ?? null;
  const blocks: Record<string, BakedPreviewBlock> = {};
  // Resolve where the clip is fetchable from, in priority order:
  //   1. an explicit OD_PLUGIN_PREVIEWS_BASE_URL override;
  //   2. the daemon's own /api/plugin-previews route when the clips are on disk
  //      (local dev / a freshly-baked dir);
  //   3. the public R2 origin — the default for the packaged desktop app and the
  //      web deployment, so neither needs any config: the checked-in manifest
  //      names the clips and they're served from R2's CDN.
  const envBase = process.env.OD_PLUGIN_PREVIEWS_BASE_URL?.replace(/\/+$/, '');
  // A production manifest commonly contains hundreds of CDN entries while
  // the local directory contains only manifest.json. Calling existsSync twice
  // per entry made the first picker request spend hundreds of milliseconds in
  // filesystem probes. Read the directory once and fall back to existsSync
  // only for the uncommon nested relative path.
  let localFiles = new Set<string>();
  if (!envBase) {
    try {
      localFiles = new Set(readdirSync(dir, { withFileTypes: true })
        .filter((item) => item.isFile())
        .map((item) => item.name));
    } catch {
      localFiles = new Set();
    }
  }
  const localAssetExists = (relativePath: string) => (
    !relativePath.includes('/') && !relativePath.includes('\\')
      ? localFiles.has(relativePath)
      : existsSync(path.join(dir, relativePath))
  );
  for (const [pluginId, candidate] of Object.entries(previews)) {
    if (!candidate.video || !candidate.poster) continue;
    const onDisk = !envBase
      && localAssetExists(candidate.video)
      && localAssetExists(candidate.poster);
    const base = envBase || (onDisk ? PLUGIN_PREVIEWS_ROUTE : DEFAULT_PUBLIC_BASE);
    blocks[pluginId] = {
      poster: `${base}/${candidate.poster}`,
      video: `${base}/${candidate.video}`,
      ...(typeof candidate.holdMs === 'number' ? { holdMs: candidate.holdMs } : {}),
    };
  }
  if (cache?.dir === dir) cache.blocks = blocks;
  return blocks[id] ?? null;
}

// Attach the baked clip under `manifest.od.bakedPreview` (a SEPARATE field —
// we deliberately do NOT overwrite `od.preview`). The gallery card opts into the
// baked clip via `inferPluginPreview(record, { preferBaked: true })`, while the
// detail modal keeps reading the real `od.preview` and renders the live,
// interactive page. Records are shallow-cloned so registry rows stay pure.
export function applyBakedPreviews<T extends { id: string; manifest?: unknown }>(
  records: T[],
  dir: string,
): T[] {
  const previews = loadManifest(dir);
  if (Object.keys(previews).length === 0) return records;
  // Resolve all blocks in one directory read before walking records. Reading
  // through bakedPreviewBlock for every record would still stat manifest.json
  // hundreds of times even though the resolved block map is already cached.
  const firstId = Object.keys(previews)[0];
  if (firstId) bakedPreviewBlock(firstId, dir);
  const blocks = cache?.dir === dir ? cache.blocks : undefined;
  return records.map((rec) => {
    const block = blocks?.[rec.id];
    if (!block) return rec;
    const manifest = { ...((rec.manifest ?? {}) as Record<string, unknown>) };
    const od = { ...((manifest.od ?? {}) as Record<string, unknown>) };
    od.bakedPreview = block;
    manifest.od = od;
    return { ...rec, manifest };
  });
}
