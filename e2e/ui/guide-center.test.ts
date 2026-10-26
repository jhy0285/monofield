import { expect, test } from '@/playwright/suite';
import { gotoEntryHome } from '@/playwright/entry';
import { applyStandardMocks } from '@/playwright/mock-factory';
import { ensureRailOpen } from '@/playwright/rail';
import type { Page } from '@playwright/test';
import { T } from '@/timeouts';

test.describe.configure({ timeout: T.xlong });

test.beforeEach(async ({ page }) => {
  await applyStandardMocks(page);
});

// An MP4 audio track announces itself with a sound-handler `hdlr` box.
function hasAudioTrack(mp4: Buffer): boolean {
  for (let at = mp4.indexOf('hdlr'); at !== -1; at = mp4.indexOf('hdlr', at + 4)) {
    if (mp4.toString('ascii', at + 12, at + 16) === 'soun') return true;
  }
  return false;
}

async function openGuideCenter(page: Page) {
  await gotoEntryHome(page);
  await ensureRailOpen(page);
  await page.getByTestId('entry-help-trigger').click();
  await page.getByTestId('entry-help-guide-center').click();
  await expect(page.getByTestId('guide-center')).toBeVisible();
}

test('[P1] help menu opens the guide center with the intro video, chapters and four steps', async ({ page }) => {
  await openGuideCenter(page);
  const guide = page.getByTestId('guide-center');

  await expect(guide.getByRole('heading', { name: 'MonoField guide' })).toBeVisible();
  const video = page.getByTestId('guide-center-video');
  await expect(video).toHaveAttribute('poster', '/guide/monofield-intro-en-poster.jpg');
  await expect(video.locator('source')).toHaveAttribute('src', '/guide/monofield-intro-en.mp4');
  await expect(page.getByTestId('guide-center-play')).toBeVisible();

  // The shipped video and poster must actually be served by the web app.
  const asset = await page.request.get('/guide/monofield-intro-en.mp4', { headers: { Range: 'bytes=0-1023' } });
  expect([200, 206]).toContain(asset.status());
  expect((await page.request.get('/guide/monofield-intro-en-poster.jpg')).ok()).toBe(true);

  // The intro is narrated: what the app serves must carry an audio track, and the
  // player must not start muted or hide its controls.
  for (const language of ['en', 'ko']) {
    const served = await page.request.get(`/guide/monofield-intro-${language}.mp4`);
    expect(served.ok()).toBe(true);
    expect(hasAudioTrack(await served.body())).toBe(true);
  }
  await expect(video).toHaveJSProperty('muted', false);
  await expect(video).toHaveJSProperty('controls', true);

  for (const index of [1, 2, 3, 4]) {
    await expect(page.getByTestId(`guide-center-chapter-${index}`)).toBeVisible();
  }
  await expect(guide.getByText('Open a folder')).toBeVisible();
  await expect(guide.getByText('Export deliverables')).toBeVisible();

  // Playback state must not remount the <video> element.
  await page.getByTestId('guide-center-video').evaluate((element) => {
    (element as HTMLVideoElement & { __kept?: boolean }).__kept = true;
  });
  await page.getByTestId('guide-center-chapter-2').click();
  await expect
    .poll(() => page.getByTestId('guide-center-video').evaluate((element) => (element as HTMLVideoElement & { __kept?: boolean }).__kept === true))
    .toBe(true);
});

test('[P1] guide center starts a project, replays the tour and closes with Escape', async ({ page }) => {
  await openGuideCenter(page);
  await page.getByTestId('guide-center-replay').click();
  await expect(page.getByTestId('guide-center')).toHaveCount(0);
  await expect(page.getByTestId('entry-feature-guide')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('entry-feature-guide')).toHaveCount(0);

  await ensureRailOpen(page);
  await page.getByTestId('entry-help-trigger').click();
  await page.getByTestId('entry-help-guide-center').click();
  await expect(page.getByTestId('guide-center')).toBeVisible();
  await page.getByTestId('guide-center-start').click();
  await expect(page.getByTestId('guide-center')).toHaveCount(0);
  await expect(page.getByTestId('new-project-modal')).toBeVisible();

  await page.keyboard.press('Escape');
  await page.getByTestId('entry-help-trigger').click();
  await page.getByTestId('entry-help-guide-center').click();
  await expect(page.getByTestId('guide-center')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('guide-center')).toHaveCount(0);
});

test('[P1] home offers the intro video and opens the same guide center', async ({ page }) => {
  await gotoEntryHome(page);
  await page.getByTestId('home-hero-intro-video').click();
  await expect(page.getByTestId('guide-center')).toBeVisible();
  await expect(page.getByTestId('guide-center-video')).toHaveAttribute('poster', /monofield-intro-en-poster\.jpg$/);
  await page.getByTestId('guide-center-close').click();
  await expect(page.getByTestId('guide-center')).toHaveCount(0);
});
