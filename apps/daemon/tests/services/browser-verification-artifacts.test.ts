import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { saveBrowserVerificationArtifacts } from '../../src/services/browser-verification-artifacts.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1EAAAAASUVORK5CYII=';

describe('browser verification artifacts', () => {
  const capture = {
    screenshot: { dataUrl: `data:image/png;base64,${png}`, width: 1, height: 1, url: 'http://localhost:4173/orders' },
    snapshot: { elements: [], url: 'http://localhost:4173/orders' },
    result: { ok: true, outcomeVerified: true, error: null, interactionActions: ['click'], verifiedActions: ['assert-text', 'screenshot', 'snapshot', 'page-info'] },
  };
  it('saves independent, readable evidence for successive runs without embedding the image in JSON', async () => {
    const artifactsDir = await mkdtemp(path.join(tmpdir(), 'browser-evidence-'));
    roots.push(artifactsDir);
    const options = { artifactsDir, capture, expectedText: 'Saved', sourceFingerprint: 'source-hash', verifiedAt: '2026-09-29T00:00:00.000Z' };
    const first = await saveBrowserVerificationArtifacts(options);
    const second = await saveBrowserVerificationArtifacts(options);
    expect(first.reportUrl).not.toBe(second.reportUrl);
    const local = (url: string) => path.join(artifactsDir, url.replace('/artifacts/', ''));
    expect(await readFile(local(first.screenshotUrl))).toEqual(Buffer.from(png, 'base64'));
    const report = JSON.parse(await readFile(local(first.reportUrl), 'utf8'));
    expect(report).toMatchObject({ ok: true, expectedText: 'Saved', sourceFingerprint: 'source-hash', screenshot: { url: first.screenshotUrl, pageUrl: capture.screenshot.url } });
    expect(report.screenshot.dataUrl).toBeUndefined();
  });
  it('rejects non-image evidence before creating any artifacts', async () => {
    const artifactsDir = await mkdtemp(path.join(tmpdir(), 'browser-evidence-'));
    roots.push(artifactsDir);
    await expect(saveBrowserVerificationArtifacts({
      artifactsDir, capture: { ...capture, screenshot: { ...capture.screenshot, dataUrl: 'data:image/png;base64,cG5n' } },
      sourceFingerprint: null, verifiedAt: '2026-09-29T00:00:00.000Z',
    })).rejects.toThrow('not a PNG');
    expect(await readdir(artifactsDir)).toEqual([]);
  });
});
