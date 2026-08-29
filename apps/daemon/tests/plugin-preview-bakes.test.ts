import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  PLUGIN_PREVIEWS_ROUTE,
  applyBakedPreviews,
} from '../src/plugin-preview-bakes.js';

const created: string[] = [];

afterEach(async () => {
  delete process.env.OD_PLUGIN_PREVIEWS_BASE_URL;
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('plugin preview bake resolution', () => {
  it('uses local assets when present and the CDN fallback for manifest-only entries', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'monofield-preview-bakes-'));
    created.push(dir);
    await writeFile(path.join(dir, 'local.mp4'), 'video');
    await writeFile(path.join(dir, 'local.jpg'), 'poster');
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({
      previews: {
        local: { video: 'local.mp4', poster: 'local.jpg', holdMs: 500 },
        remote: { video: 'remote.mp4', poster: 'remote.jpg' },
      },
    }));

    const records = applyBakedPreviews([
      { id: 'local', manifest: { od: {} } },
      { id: 'remote', manifest: { od: {} } },
    ], dir) as Array<{ manifest: { od: { bakedPreview: { video: string; poster: string } } } }>;

    expect(records[0]?.manifest.od.bakedPreview).toMatchObject({
      video: `${PLUGIN_PREVIEWS_ROUTE}/local.mp4`,
      poster: `${PLUGIN_PREVIEWS_ROUTE}/local.jpg`,
      holdMs: 500,
    });
    expect(records[1]?.manifest.od.bakedPreview.video).toBe(
      'https://repo-assets.open-design.ai/plugin-previews/remote.mp4',
    );
  });
});
