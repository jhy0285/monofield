import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { BrowserVerificationCapture } from '../automatic-browser-verification.js';

/** Each capture has an immutable location under the daemon's supplied artifact root. */
export async function saveBrowserVerificationArtifacts(options: {
  artifactsDir: string;
  capture: BrowserVerificationCapture;
  expectedText?: string;
  sourceFingerprint: string | null;
  verifiedAt: string;
}): Promise<{ screenshotUrl: string; reportUrl: string }> {
  const encoded = options.capture.screenshot.dataUrl.replace(/^data:image\/png;base64,/, '');
  if (encoded.length > 24 * 1024 * 1024) throw new Error('Screenshot exceeds the evidence size limit');
  const png = Buffer.from(encoded, 'base64');
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('Screenshot is not a PNG image');
  }
  const id = randomUUID();
  const directory = path.join(options.artifactsDir, 'browser-verification', id);
  const prefix = `/artifacts/browser-verification/${id}`;
  const links = { screenshotUrl: `${prefix}/screen.png`, reportUrl: `${prefix}/report.json` };
  const report = JSON.stringify({
    version: 1,
    verifiedAt: options.verifiedAt,
    sourceFingerprint: options.sourceFingerprint,
    expectedText: options.expectedText ?? null,
    ...options.capture.result,
    screenshot: { ...options.capture.screenshot, dataUrl: undefined, url: links.screenshotUrl, pageUrl: options.capture.screenshot.url },
    snapshot: options.capture.snapshot,
  }, null, 2);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'screen.png'), png, { flag: 'wx' });
  await writeFile(path.join(directory, 'report.json'), report, { flag: 'wx' });
  return links;
}
