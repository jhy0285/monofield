import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { T } from '@/timeouts';

/**
 * Open the entry Home view and wait until its composer is interactive.
 *
 * The web app is a client-only SPA behind a dynamic import, so every
 * navigation first paints the `.od-loading-shell` placeholder. On a fresh
 * per-worker dev server the first navigation also waits for Next to compile
 * the App chunk, which routinely outlasts a default expect timeout. Wait on
 * the shell itself (brand-agnostic, unlike its "Loading …" copy) with a long
 * budget, then on the Home composer.
 */
export async function gotoEntryHome(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('.od-loading-shell').waitFor({ state: 'hidden', timeout: T.xlong });
  await expect(page.getByTestId('home-hero')).toBeVisible({ timeout: T.long });
  await expect(page.getByTestId('home-hero-input')).toBeVisible();
}
