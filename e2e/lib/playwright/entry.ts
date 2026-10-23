import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { T } from '@/timeouts';

/**
 * Dynamic-import loading shell rendered by `apps/web/app/[[...slug]]/client-app.tsx`
 * while `src/App` loads. Select it by class, never by its copy: a text locator that
 * stops matching (the copy is branded and has been renamed before) resolves to
 * "hidden" immediately, so the wait silently stops waiting.
 */
const LOADING_SHELL = '.od-loading-shell';

/**
 * Wait until the loading shell is gone. The shell is part of the initial HTML, so it
 * is already in the DOM once `page.goto(..., { waitUntil: 'domcontentloaded' })`
 * resolves. On a fresh per-worker dev server the first App compile can take 30-40s,
 * hence the generous default.
 */
export async function waitForLoadingShell(page: Page, timeout: number = T.xlong): Promise<void> {
  await page.locator(LOADING_SHELL).waitFor({ state: 'hidden', timeout });
}

/** Open `/` and wait until the Home hero and its composer are rendered. */
export async function gotoEntryHome(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForLoadingShell(page);
  await expect(page.getByTestId('home-hero')).toBeVisible({ timeout: T.long });
  await expect(page.getByTestId('home-hero-input')).toBeVisible({ timeout: T.long });
}
