import { expect, test } from '@/playwright/suite';
import { applyStandardMocks } from '@/playwright/mock-factory';

// The web app loads daemon config with `GET /api/app-config?compact=1`
// (`fetchDaemonConfig`). A Playwright string glob matches the query string too,
// so a '**/api/app-config' route never sees that request and the real daemon
// answers instead, silently dropping every seeded config.
test('[P1] standard app-config mock answers GET with and without a query string', async ({ page }) => {
  await applyStandardMocks(page);
  // Any same-origin document works; the fetches below go through the page's routes.
  await page.goto('/api/health');

  for (const path of ['/api/app-config', '/api/app-config?compact=1']) {
    const body = await page.evaluate(async (p) => (await fetch(p)).json(), path);
    expect(body, path).toMatchObject({ config: { agentId: 'mock', onboardingCompleted: true } });
  }
});
