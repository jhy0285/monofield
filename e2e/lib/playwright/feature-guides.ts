import type { BrowserContext, Page } from '@playwright/test';

// First-visit tours (entry destinations, Settings tabs, the development and
// creation workspaces) put a backdrop over the page that swallows pointer
// events. UI flows are not about the tours, so tests start with them marked as
// seen. Keep in sync with `EntryFeatureGuideId` in
// apps/web/src/components/EntryFeatureGuide.tsx and the storage keys in
// apps/web/src/components/DevelopmentWorkspaceTutorial.tsx.
const ENTRY_FEATURE_GUIDES_KEY = 'monofield:entry-feature-guides:v1';
const ENTRY_FEATURE_GUIDE_IDS = [
  'navigation',
  'new-project',
  'projects',
  'open-work',
  'design-systems',
  'tasks',
  'plugins',
  'integrations',
  'settings-overview',
  'settings-memory',
  'settings-media',
  'settings-review',
  'settings-pet',
  'settings-database',
  'settings-dictionaries',
] as const;
const WORKSPACE_TUTORIAL_DONE_KEYS = [
  'monofield:development-workspace-tutorial:v2',
  'monofield:creation-workspace-tutorial:v1',
] as const;

/**
 * Mark every first-visit tour as seen before the app boots. The shared suite
 * fixture applies this to each test's context; a test whose own init script
 * wipes localStorage must call it again on the page afterwards, because page
 * init scripts run after context ones.
 */
export async function markFeatureGuidesSeen(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(
    ({ key, ids, doneKeys }) => {
      try {
        window.localStorage.setItem(key, JSON.stringify(Object.fromEntries(ids.map((id) => [id, true]))));
        for (const doneKey of doneKeys) window.localStorage.setItem(doneKey, 'done');
      } catch {
        // Storage can be unavailable on opaque origins (about:blank); nothing to seed there.
      }
    },
    {
      key: ENTRY_FEATURE_GUIDES_KEY,
      ids: [...ENTRY_FEATURE_GUIDE_IDS],
      doneKeys: [...WORKSPACE_TUTORIAL_DONE_KEYS],
    },
  );
}
