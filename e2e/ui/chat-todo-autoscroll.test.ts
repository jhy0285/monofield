import { expect, test } from '@/playwright/suite';
import { waitForLoadingShell } from '@/playwright/entry';
import type { Page } from '@playwright/test';
import { APP_CONFIG_URL, routeAgents } from '@/playwright/mock-factory';

// Verifies that the chat-log stays pinned to the bottom when the inline todo
// card grows (scenario A) and that a deliberate scroll-up is not overridden by
// a subsequent TodoWrite snapshot (scenario B). The todo card is rendered inside
// the chat log with the assistant message that wrote it; it used to be pinned
// above the composer, outside the scrolling log.
//
// jsdom cannot exercise ResizeObserver or real layout geometry, so these
// assertions must run in a real browser via Playwright. The Vitest unit spec
// in apps/web/tests/components/chat-todo-autoscroll.test.tsx confirms that
// the log's content is observed; this spec confirms that the resulting
// scroll behaviour is correct end-to-end.

const STORAGE_KEY = 'open-design:config';

// Reusable app-config seed: skip onboarding, mock agent, no real model calls.
async function seedAppConfig(page: Page) {
  await page.addInitScript((key) => {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        mode: 'daemon',
        apiKey: '',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-5',
        agentId: 'mock',
        skillId: null,
        designSystemId: null,
        onboardingCompleted: true,
        agentModels: {},
        privacyDecisionAt: 1,
        telemetry: { metrics: false, content: false, artifactManifest: false },
      }),
    );
  }, STORAGE_KEY);

  await page.route(APP_CONFIG_URL, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      json: {
        config: {
          onboardingCompleted: true,
          agentId: 'mock',
          skillId: null,
          designSystemId: null,
          agentModels: {},
          privacyDecisionAt: 1,
          telemetry: { metrics: false, content: false, artifactManifest: false },
        },
      },
    });
  });

  await routeAgents(page, [
    {
      id: 'mock',
      name: 'Mock Agent',
      bin: 'mock-agent',
      available: true,
      version: 'test',
      models: [{ id: 'default', label: 'Default' }],
    },
  ]);
}

// Seed a project + conversation + messages via the daemon HTTP API, then
// navigate to the project/conversation URL. Returns ids needed for follow-up
// API calls.
//
// To guarantee the chat-log is scrollable (needed to exercise the autoscroll
// invariant), we seed FILLER_MSG_COUNT pairs of short user/assistant messages
// before the final TodoWrite assistant message.  Each message pair is roughly
// 80 px tall; 12 pairs easily exceed a 600 px viewport so the chat-log always
// has overflow to scroll.
const FILLER_MSG_COUNT = 12;

async function seedProjectWithTodos(
  page: Page,
  opts: { projectSuffix: string; todoCount: number },
): Promise<{ projectId: string; conversationId: string }> {
  const projectId = `todo-scroll-${opts.projectSuffix}-${Date.now()}`.replace(/[^A-Za-z0-9._-]/g, '-');

  const projectRes = await page.request.post('/api/projects', {
    data: {
      id: projectId,
      name: `Todo Scroll ${opts.projectSuffix}`,
      skillId: null,
      designSystemId: null,
      pendingPrompt: null,
      metadata: { kind: 'prototype' },
    },
  });
  expect(projectRes.ok(), `create project: ${await projectRes.text()}`).toBeTruthy();
  const { conversationId } = (await projectRes.json()) as { conversationId: string };
  expect(conversationId).toBeTruthy();

  // Seed several filler message pairs so the chat-log has scrollable overflow.
  for (let i = 0; i < FILLER_MSG_COUNT; i += 1) {
    const base = Date.now() - (FILLER_MSG_COUNT - i + 2) * 1000;
    const uRes = await page.request.put(
      `/api/projects/${projectId}/conversations/${conversationId}/messages/u-fill-${i}-${projectId}`,
      {
        data: {
          role: 'user',
          content: `Filler question ${i + 1}: what is step ${i + 1}?`,
          createdAt: base,
        },
      },
    );
    expect(uRes.ok(), `upsert filler user msg ${i}: ${await uRes.text()}`).toBeTruthy();

    const aRes = await page.request.put(
      `/api/projects/${projectId}/conversations/${conversationId}/messages/a-fill-${i}-${projectId}`,
      {
        data: {
          role: 'assistant',
          content: `Filler answer ${i + 1}: step ${i + 1} involves doing the work carefully.`,
          runStatus: 'succeeded',
          createdAt: base + 500,
        },
      },
    );
    expect(aRes.ok(), `upsert filler assistant msg ${i}: ${await aRes.text()}`).toBeTruthy();
  }

  // Seed the final user message.
  const userMsgId = `u-${projectId}`;
  const userMsgRes = await page.request.put(
    `/api/projects/${projectId}/conversations/${conversationId}/messages/${userMsgId}`,
    {
      data: {
        role: 'user',
        content: 'please build something',
        createdAt: Date.now() - 2000,
      },
    },
  );
  expect(userMsgRes.ok(), `upsert user msg: ${await userMsgRes.text()}`).toBeTruthy();

  // Seed an assistant message carrying a TodoWrite tool_use event.
  const todos = Array.from({ length: opts.todoCount }, (_, i) => ({
    content: `Task ${i + 1}`,
    status: 'pending',
  }));
  const assistantMsgId = `a-${projectId}`;
  const assistantMsgRes = await page.request.put(
    `/api/projects/${projectId}/conversations/${conversationId}/messages/${assistantMsgId}`,
    {
      data: {
        role: 'assistant',
        content: 'sure, here is the plan',
        runStatus: 'succeeded',
        events: [
          {
            kind: 'tool_use',
            id: `tw-${projectId}`,
            name: 'TodoWrite',
            input: { todos },
          },
        ],
        createdAt: Date.now() - 1000,
      },
    },
  );
  expect(assistantMsgRes.ok(), `upsert assistant msg: ${await assistantMsgRes.text()}`).toBeTruthy();

  return { projectId, conversationId };
}

// Pause until .chat-log is mounted, messages have loaded, and the loading
// overlay is gone. The first non-empty message from the seed is "Filler
// question 1" so waiting for that text confirms the daemon responded with
// the stored message list.
async function waitForChatReady(page: Page) {
  await waitForLoadingShell(page);
  await expect(page.locator('.chat-log')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('chat-composer')).toBeVisible({ timeout: 10_000 });
  // Wait until at least one filler message has rendered so the chat-log has
  // real content (not the empty-state template card grid).
  await expect(
    page.locator('.chat-log').getByText('Filler question 1: what is step 1?', { exact: true }),
  ).toBeVisible({ timeout: 10_000 });
}

// Read the chat-log scroll distance from the bottom (scrollHeight - scrollTop - clientHeight).
async function chatLogBottomDistance(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.chat-log');
    if (!el) return -1;
    return el.scrollHeight - el.scrollTop - el.clientHeight;
  });
}

// Read the total scrollable overflow (scrollHeight - clientHeight).
// A value > 0 means the chat-log has content that can be scrolled.
async function chatLogScrollableHeight(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.chat-log');
    if (!el) return -1;
    return el.scrollHeight - el.clientHeight;
  });
}

// Grow the inline todo card, which is what a TodoWrite snapshot with more items
// does. The card lives inside the scrolling log, so the log's scrollHeight grows
// while its clientHeight stays the same. A user pinned to the bottom must be kept
// there by the ChatPane's observer; a user who scrolled up must stay where they are.
async function growInlineTodo(page: Page, extraPx: number) {
  await page.evaluate((px) => {
    const el = document.querySelector<HTMLElement>('.chat-log .op-card.op-todo');
    if (!el) throw new Error('No inline todo card found in .chat-log');
    el.style.minHeight = `${el.offsetHeight + px}px`;
  }, extraPx);
  // Give the browser two rAF cycles to flush ResizeObserver callbacks and the
  // nested followLatestIfPinned rAF.
  await page.waitForTimeout(100);
}

async function chatLogScrollHeight(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelector<HTMLElement>('.chat-log')?.scrollHeight ?? -1);
}

test.describe('chat pane autoscroll on TodoCard growth', () => {
  test.describe.configure({ timeout: 45_000 });

  test.beforeEach(async ({ page }) => {
    await seedAppConfig(page);
  });

  test('[P2] scenario A: pinned user stays at bottom after the inline todo card grows', async ({
    page,
  }) => {
    const { projectId, conversationId } = await seedProjectWithTodos(page, {
      projectSuffix: 'a',
      todoCount: 4,
    });

    await page.goto(`/projects/${projectId}/conversations/${conversationId}`, {
      waitUntil: 'domcontentloaded',
    });
    await waitForChatReady(page);

    // After initial load the chat log should be pinned to the bottom.
    const distanceAfterLoad = await chatLogBottomDistance(page);
    expect(
      distanceAfterLoad,
      `expected chat-log pinned to bottom on load (distance=${distanceAfterLoad})`,
    ).toBeLessThan(20);

    // Guard: the filler messages must create actual scroll overflow.  If the
    // chat-log is not scrollable the grow step is a no-op and the assertion
    // below passes vacuously — defeat the bug detector entirely.
    const scrollableHeight = await chatLogScrollableHeight(page);
    expect(
      scrollableHeight,
      `expected chat-log to have scrollable overflow (scrollableHeight=${scrollableHeight}); ` +
      `seed more filler messages if this fires`,
    ).toBeGreaterThan(50);

    // Verify the inline todo card rendered.
    await expect(page.locator('.chat-log .op-card.op-todo')).toBeVisible({ timeout: 5_000 });

    // Capture scrollHeight before growing so we can assert the grow step
    // actually changed the layout this test is designed to protect against.
    const scrollHeightBeforeGrow = await chatLogScrollHeight(page);

    // Grow the todo card by 80 px (simulates a new TodoWrite snapshot with more
    // items) and verify the chat-log stays at the bottom.
    await growInlineTodo(page, 80);

    // Hard precondition: the grow step must have made the log taller. If a
    // layout change stops the card from growing the log, the distance check
    // below passes vacuously and the regression detector is defeated — fail
    // fast instead.
    const scrollHeightAfterGrow = await chatLogScrollHeight(page);
    expect(
      scrollHeightAfterGrow,
      `expected grow step to increase chat-log scrollHeight ` +
      `(before=${scrollHeightBeforeGrow} after=${scrollHeightAfterGrow}); ` +
      `increase extraPx in growInlineTodo or check the layout if this fires`,
    ).toBeGreaterThan(scrollHeightBeforeGrow);

    const distanceAfterGrow = await chatLogBottomDistance(page);
    expect(
      distanceAfterGrow,
      `expected chat-log re-pinned after todo card grew (distance=${distanceAfterGrow})`,
    ).toBeLessThan(20);
  });

  test('[P2] scenario B: user scroll-up is preserved when the inline todo card grows', async ({
    page,
  }) => {
    const { projectId, conversationId } = await seedProjectWithTodos(page, {
      projectSuffix: 'b',
      todoCount: 4,
    });

    await page.goto(`/projects/${projectId}/conversations/${conversationId}`, {
      waitUntil: 'domcontentloaded',
    });
    await waitForChatReady(page);

    // Verify the inline todo card is mounted.
    await expect(page.locator('.chat-log .op-card.op-todo')).toBeVisible({ timeout: 5_000 });

    // Scroll the chat-log up by 150 px to break the pinned-to-bottom invariant.
    // We scroll by at least 80 px (the pinnedToBottomRef threshold) to ensure
    // the ChatPane considers the user as having deliberately scrolled away.
    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('.chat-log');
      if (!el) throw new Error('No .chat-log element found');
      // Scroll up by 150 px — beyond the 80 px pinned threshold.
      el.scrollTop = Math.max(0, el.scrollTop - 150);
      // Dispatch a synthetic scroll event so ChatPane's onScroll listener
      // fires and updates pinnedToBottomRef to false.
      el.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await page.waitForTimeout(50);

    const distanceAfterScroll = await chatLogBottomDistance(page);

    // Hard precondition: the scroll must have moved past the 80px suppression
    // threshold. If this fails, the seed / layout changed and the test no
    // longer exercises the "user scrolled away, do not yank them back" path —
    // fail fast instead of silently skipping the regression check below.
    expect(
      distanceAfterScroll,
      `expected scroll-up to move chat-log more than 80px from bottom (distance=${distanceAfterScroll}); ` +
      `seed more filler messages or increase the scroll offset if this fires`,
    ).toBeGreaterThan(80);

    // Capture scrollTop and scrollHeight before growing — the invariant is that
    // scrollTop is preserved while the content below the user gets taller.
    const scrollTopBeforeGrow = await page.evaluate(
      () => document.querySelector<HTMLElement>('.chat-log')?.scrollTop ?? -1,
    );
    const scrollHeightBeforeGrow = await chatLogScrollHeight(page);

    // Now grow the todo card — the non-pinned user should NOT be dragged back.
    await growInlineTodo(page, 80);

    // Hard precondition: the grow step must have made the log taller. If this
    // fails, the layout changed and the test no longer exercises the "user
    // scrolled away, do not yank them back" path — fail fast.
    const scrollHeightAfterGrow = await chatLogScrollHeight(page);
    expect(
      scrollHeightAfterGrow,
      `expected grow step to increase chat-log scrollHeight ` +
      `(before=${scrollHeightBeforeGrow} after=${scrollHeightAfterGrow}); ` +
      `increase extraPx in growInlineTodo or check the layout if this fires`,
    ).toBeGreaterThan(scrollHeightBeforeGrow);

    // Core invariant: scrollTop must be preserved. A regression where
    // followLatestIfPinned fires and snaps the user back to the bottom would
    // set scrollTop = scrollHeight - clientHeight, far from scrollTopBeforeGrow.
    const scrollTopAfterGrow = await page.evaluate(
      () => document.querySelector<HTMLElement>('.chat-log')?.scrollTop ?? -1,
    );
    const SCROLL_PRESERVATION_TOLERANCE_PX = 20;
    expect(
      Math.abs(scrollTopAfterGrow - scrollTopBeforeGrow),
      `expected scrollTop preserved within ${SCROLL_PRESERVATION_TOLERANCE_PX}px of pre-grow ` +
      `(before=${scrollTopBeforeGrow} after=${scrollTopAfterGrow} ` +
      `delta=${Math.abs(scrollTopAfterGrow - scrollTopBeforeGrow)})`,
    ).toBeLessThan(SCROLL_PRESERVATION_TOLERANCE_PX);
  });
});
