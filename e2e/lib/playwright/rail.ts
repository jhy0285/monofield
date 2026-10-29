import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { waitForLoadingShell } from './entry.js';

/**
 * The entry nav rail is collapsed by default; its destinations
 * (`entry-nav-*`) only become interactable once the rail is expanded via the
 * topbar toggle. This helper is idempotent — when the rail is already open the
 * toggle is not used, so it no-ops. Call it before clicking any rail nav
 * item or asserting the rail/logo is visible.
 *
 * It waits for the shell to render before deciding. Sampling the toggle once
 * right after `goto` raced hydration: the toggle was not there yet, the click
 * was skipped, and the rail stayed collapsed (inert) for the rest of the test.
 */
export async function ensureRailOpen(page: Page): Promise<void> {
  await waitForLoadingShell(page);
  const toggle = page.getByTestId('entry-rail-toggle');
  const rail = page.locator('.entry-nav-rail');
  const openRail = page.locator('.entry-nav-rail:not([inert])');
  await expect(toggle.or(openRail).first()).toBeVisible();
  if (!(await openRail.isVisible())) {
    await toggle.click();
  }
  await expect(rail).toBeVisible();
}
