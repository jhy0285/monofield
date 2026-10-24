// Renders the MonoField intro motion piece (apps/monofield-site/intro-src/scene.html)
// to MP4 + poster for the public site and the in-app Guide Center.
//
//   pnpm --filter @open-design/e2e exec tsx scripts/render-intro-video.ts
//   pnpm --filter @open-design/e2e exec tsx scripts/render-intro-video.ts --preview 2,9.5,16
//
// The scene is a pure function of time (`window.seek`), so frames are exact and
// the output is reproducible. Requires ffmpeg on PATH. Inter and Noto Sans KR
// (both OFL) are fetched once from npm into the OS temp directory.

import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const sceneDir = join(repoRoot, 'apps', 'monofield-site', 'intro-src');
const FPS = 30;
const WIDTH = 1280;
const HEIGHT = 720;

const siteDir = join(repoRoot, 'apps', 'monofield-site', 'intro');
const appDir = join(repoRoot, 'apps', 'web', 'public', 'guide');
const languages = ['ko', 'en'] as const;
const posterSeconds: Record<(typeof languages)[number], number> = { ko: 11.9, en: 11.9 };

async function ensureFonts(): Promise<string> {
  const cache = join(tmpdir(), 'monofield-intro-fonts');
  const marker = join(cache, 'fonts', 'noto-sans-kr-korean-700-normal.woff2');
  if (existsSync(marker)) return join(cache, 'fonts');
  await mkdir(join(cache, 'fonts'), { recursive: true });
  for (const [pkg, prefix] of [['@fontsource/inter', 'inter-latin'], ['@fontsource/noto-sans-kr', 'noto-sans-kr-korean']] as const) {
    const packed = spawnSync('npm', ['pack', pkg, '--silent'], { cwd: cache, encoding: 'utf8' });
    if (packed.status !== 0) throw new Error(`npm pack ${pkg} failed: ${packed.stderr}`);
    const tarball = packed.stdout.trim().split('\n').pop()!;
    const extractDir = join(cache, basename(tarball, '.tgz'));
    await mkdir(extractDir, { recursive: true });
    const untar = spawnSync('tar', ['-xzf', join(cache, tarball), '-C', extractDir], { encoding: 'utf8' });
    if (untar.status !== 0) throw new Error(`tar failed: ${untar.stderr}`);
    const files = await readdir(join(extractDir, 'package', 'files'));
    for (const file of files) {
      if (file.startsWith(prefix) && file.endsWith('-normal.woff2')) {
        await copyFile(join(extractDir, 'package', 'files', file), join(cache, 'fonts', file));
      }
    }
  }
  return join(cache, 'fonts');
}

async function serve(fontDir: string): Promise<{ url: string; close: () => void }> {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    try {
      if (path.startsWith('/fonts/')) {
        res.writeHead(200, { 'content-type': 'font/woff2' });
        res.end(await readFile(join(fontDir, basename(path))));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(await readFile(join(sceneDir, 'scene.html')));
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'inherit'] });
    child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`${command} exited with ${code}`))));
  });
}

async function main() {
  const previewIndex = process.argv.indexOf('--preview');
  const previewTimes = previewIndex >= 0 ? process.argv[previewIndex + 1]!.split(',').map(Number) : null;
  const fontDir = await ensureFonts();
  const server = await serve(fontDir);
  const browser = await chromium.launch();
  try {
    for (const lang of languages) {
      const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
      await page.goto(`${server.url}/?lang=${lang}&paused`, { waitUntil: 'load' });
      await page.evaluate(() => (window as unknown as { __ready: Promise<boolean> }).__ready);
      const seek = (t: number) => page.evaluate((value) => (window as unknown as { seek: (s: number) => void }).seek(value), t);
      const duration = await page.evaluate(() => (window as unknown as { DURATION: number }).DURATION);

      if (previewTimes) {
        const out = join(tmpdir(), `monofield-intro-preview-${lang}`);
        await mkdir(out, { recursive: true });
        for (const t of previewTimes) {
          await seek(t);
          await page.screenshot({ path: join(out, `t${String(t).replace('.', '_')}.png`) });
        }
        console.log(`preview frames → ${out}`);
        await page.close();
        continue;
      }

      const framesDir = join(tmpdir(), `monofield-intro-frames-${lang}`);
      await rm(framesDir, { recursive: true, force: true });
      await mkdir(framesDir, { recursive: true });
      const total = Math.round(duration * FPS);
      for (let frame = 0; frame < total; frame += 1) {
        await seek(frame / FPS);
        await page.screenshot({ path: join(framesDir, `${String(frame).padStart(4, '0')}.png`) });
      }
      await seek(posterSeconds[lang]);
      const posterPng = join(framesDir, 'poster.png');
      await page.screenshot({ path: posterPng });
      await page.close();

      await mkdir(siteDir, { recursive: true });
      const mp4 = join(siteDir, `monofield-intro-${lang}.mp4`);
      await run('ffmpeg', [
        '-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(framesDir, '%04d.png'),
        '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', '27', '-preset', 'slow',
        '-movflags', '+faststart', '-an', mp4,
      ]);
      const poster = join(siteDir, `monofield-intro-${lang}-poster.jpg`);
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', posterPng, '-q:v', '4', poster]);

      await mkdir(appDir, { recursive: true });
      await copyFile(mp4, join(appDir, basename(mp4)));
      await copyFile(poster, join(appDir, basename(poster)));
      await rm(framesDir, { recursive: true, force: true });
      console.log(`rendered ${lang}: ${mp4}`);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

await main();
