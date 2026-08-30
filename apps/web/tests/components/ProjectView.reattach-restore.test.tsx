// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ProjectView,
  computeProducedFiles,
  computeTouchedProjectFiles,
  preTurnFileNamesForWorkMode,
  findSameTurnHtmlWriteForRecoveredArtifact,
  mergeRecoveredArtifact,
  rememberArtifactDeliveryCapability,
  waitForArtifactWriteReceipt,
} from '../../src/components/ProjectView';
import { resolvePersistedArtifactHtml } from '../../src/artifacts/recover';
import type { ChatMessage } from '../../src/types';

const listConversations = vi.fn();
const listMessages = vi.fn();
const fetchPreviewComments = vi.fn();
const loadTabs = vi.fn();
const fetchProjectFiles = vi.fn();
const fetchProjectDesignSystemPackageAudit = vi.fn();
const fetchLiveArtifacts = vi.fn();
const fetchSkill = vi.fn();
const fetchDesignSystem = vi.fn();
const getTemplate = vi.fn();
const fetchChatRunStatus = vi.fn();
const listActiveChatRuns = vi.fn();
const listProjectRuns = vi.fn();
const reattachDaemonRun = vi.fn();
const acknowledgeChatRunArtifactDelivery = vi.fn();
const streamViaDaemon = vi.fn();
const saveMessage = vi.fn();
const createConversation = vi.fn();
const patchConversation = vi.fn();
const patchProject = vi.fn();
const saveTabs = vi.fn();
const fetchProjectFileText = vi.fn();
const fetchProjectFilePreview = vi.fn();
const writeProjectTextFile = vi.fn();
const chatPaneStreamingStates: boolean[] = [];
const fileWorkspaceSpy = vi.fn();
let autoApplyOpenRequests = true;

vi.mock('../../src/i18n', () => ({
  // ProjectView calls useI18n() (for locale/t); mock it like the other
  // ProjectView suites so the render does not throw on a missing export.
  useI18n: () => ({
    locale: 'en',
    setLocale: () => undefined,
    t: (value: string) => value,
  }),
  useT: () => ((value: string) => value),
}));

vi.mock('../../src/providers/anthropic', () => ({
  streamMessage: vi.fn(),
}));

vi.mock('../../src/providers/daemon', () => ({
  acknowledgeChatRunArtifactDelivery: (...args: unknown[]) =>
    acknowledgeChatRunArtifactDelivery(...args),
  cancelChatRun: vi.fn(),
  fetchChatRunStatus: (...args: unknown[]) => fetchChatRunStatus(...args),
  listActiveChatRuns: (...args: unknown[]) => listActiveChatRuns(...args),
  listProjectRuns: (...args: unknown[]) => listProjectRuns(...args),
  reattachDaemonRun: (...args: unknown[]) => reattachDaemonRun(...args),
  streamViaDaemon: (...args: unknown[]) => streamViaDaemon(...args),
}));

vi.mock('../../src/providers/registry', () => ({
  deletePreviewComment: vi.fn(),
  fetchPreviewComments: (...args: unknown[]) => fetchPreviewComments(...args),
  fetchDesignSystem: (...args: unknown[]) => fetchDesignSystem(...args),
  fetchProjectDesignSystemPackageAudit: (...args: unknown[]) =>
    fetchProjectDesignSystemPackageAudit(...args),
  fetchLiveArtifacts: (...args: unknown[]) => fetchLiveArtifacts(...args),
  fetchProjectFilePreview: (...args: unknown[]) => fetchProjectFilePreview(...args),
  fetchProjectFileText: (...args: unknown[]) => fetchProjectFileText(...args),
  fetchProjectFiles: (...args: unknown[]) => fetchProjectFiles(...args),
  fetchSkill: (...args: unknown[]) => fetchSkill(...args),
  patchPreviewCommentStatus: vi.fn(),
  upsertPreviewComment: vi.fn(),
  writeProjectTextFile: (...args: unknown[]) => writeProjectTextFile(...args),
}));

vi.mock('../../src/providers/project-events', () => ({
  useProjectFileEvents: vi.fn(),
}));

vi.mock('../../src/router', () => ({
  navigate: vi.fn(),
}));

vi.mock('../../src/state/projects', () => ({
  cacheTabsLocally: (_projectId: string, state: unknown) => state,
  createConversation: (...args: unknown[]) => createConversation(...args),
  deleteConversation: vi.fn(),
  getTemplate: (...args: unknown[]) => getTemplate(...args),
  listConversations: (...args: unknown[]) => listConversations(...args),
  listMessages: (...args: unknown[]) => listMessages(...args),
  loadTabs: (...args: unknown[]) => loadTabs(...args),
  patchConversation: (...args: unknown[]) => patchConversation(...args),
  patchProject: (...args: unknown[]) => patchProject(...args),
  persistTabsToDaemonNow: vi.fn().mockResolvedValue(undefined),
  saveMessage: (...args: unknown[]) => saveMessage(...args),
  saveTabs: (...args: unknown[]) => saveTabs(...args),
}));

vi.mock('../../src/components/AppChromeHeader', () => ({
  AppChromeHeader: () => null,
}));

vi.mock('../../src/components/AvatarMenu', () => ({
  AvatarMenu: () => null,
}));

vi.mock('../../src/components/ChatPane', () => ({
  ChatPane: (props: { streaming?: boolean }) => {
    chatPaneStreamingStates.push(props.streaming === true);
    return null;
  },
}));

vi.mock('../../src/components/FileWorkspace', () => ({
  FileWorkspace: (props: {
    openRequest?: { name: string; nonce: number } | null;
    onOpenRequestApplied?: (
      request: { name: string; nonce: number },
      previewReady?: boolean,
    ) => void;
  }) => {
    fileWorkspaceSpy(props);
    useEffect(() => {
      if (autoApplyOpenRequests && props.openRequest) {
        props.onOpenRequestApplied?.(props.openRequest, true);
      }
    }, [props.openRequest?.nonce]);
    return null;
  },
}));

vi.mock('../../src/components/Loading', () => ({
  CenteredLoader: () => null,
}));

function renderProjectView() {
  return render(
    <ProjectView
      project={
        { id: 'project-1', name: 'Project', skillId: null, designSystemId: null } as never
      }
      routeFileName={null}
      config={
        {
          mode: 'daemon',
          agentId: 'agent-1',
          notifications: undefined,
          agentModels: {},
        } as never
      }
      agents={[{ id: 'agent-1', name: 'OpenCode', models: [] } as never]}
      skills={[]}
      designTemplates={[]}
      designSystems={[]}
      daemonLive
      onModeChange={() => {}}
      onAgentChange={() => {}}
      onAgentModelChange={() => {}}
      onRefreshAgents={() => {}}
      onOpenSettings={() => {}}
      onBack={() => {}}
      onClearPendingPrompt={() => {}}
      onTouchProject={() => {}}
      onProjectChange={() => {}}
      onProjectsRefresh={() => {}}
    />,
  );
}

describe('computeProducedFiles', () => {
  it('returns files not present in the before-set', () => {
    const before = ['existing.html'];
    const next = [
      { name: 'existing.html', path: '/p/existing.html', size: 1, updatedAt: 0 },
      { name: 'new.pptx', path: '/p/new.pptx', size: 2, updatedAt: 0 },
    ];
    const produced = computeProducedFiles(before, next as never);
    expect(produced?.map((f) => f.name)).toEqual(['new.pptx']);
  });

  it('excludes user sketch files from turn output attribution', () => {
    const before = ['existing.html'];
    const next = [
      { name: 'existing.html', path: '/p/existing.html', size: 1, mtime: 1, kind: 'html', mime: 'text/html' },
      { name: 'board.sketch.json', path: '/p/board.sketch.json', size: 2, mtime: 2, kind: 'sketch', mime: 'application/json' },
      { name: 'new.pptx', path: '/p/new.pptx', size: 3, mtime: 3, kind: 'pdf', mime: 'application/pdf' },
    ];
    const produced = computeProducedFiles(before, next as never);
    expect(produced?.map((f) => f.name)).toEqual(['new.pptx']);
  });

  it('keeps generated svg files even when they are classified as sketches', () => {
    const before = ['existing.html'];
    const next = [
      { name: 'existing.html', path: '/p/existing.html', size: 1, mtime: 1, kind: 'html', mime: 'text/html' },
      { name: 'diagram.svg', path: '/p/diagram.svg', size: 2, mtime: 2, kind: 'sketch', mime: 'image/svg+xml' },
      { name: 'board.sketch.json', path: '/p/board.sketch.json', size: 3, mtime: 3, kind: 'sketch', mime: 'application/json' },
    ];
    const produced = computeProducedFiles(before, next as never);
    expect(produced?.map((f) => f.name)).toEqual(['diagram.svg']);
  });

  it('returns undefined when no baseline is provided', () => {
    expect(computeProducedFiles(undefined, [] as never)).toBeUndefined();
  });
});

describe('document delivery receipts', () => {
  it('recognizes an in-place edit as a same-turn file receipt', () => {
    const before = [{
      name: 'deck.html', path: 'deck.html', size: 10, mtime: 1, kind: 'html', mime: 'text/html',
    }];
    const after = [{ ...before[0], size: 12, mtime: 2 }];
    expect(computeTouchedProjectFiles(before as never, after as never)?.map((file) => file.name))
      .toEqual(['deck.html']);
  });

  it('bounds a host write that never resolves', async () => {
    let operationSignal: AbortSignal | undefined;
    const receipt = await waitForArtifactWriteReceipt(
      (signal) => {
        operationSignal = signal;
        return new Promise<never>(() => {});
      },
      5,
    );
    expect(receipt).toBeNull();
    expect(operationSignal?.aborted).toBe(true);
  });

  it('aborts a pending host receipt immediately when the delivery lifecycle is stopped', async () => {
    const parent = new AbortController();
    let operationSignal: AbortSignal | undefined;
    const receipt = waitForArtifactWriteReceipt(
      (signal) => {
        operationSignal = signal;
        return new Promise<never>(() => {});
      },
      60_000,
      parent.signal,
    );

    parent.abort();

    await expect(receipt).resolves.toBeNull();
    expect(operationSignal?.aborted).toBe(true);
  });
});

describe('preTurnFileNamesForWorkMode', () => {
  const files = [
    { name: 'src/app.ts' },
    { name: 'README.md' },
  ] as never;

  it('does not create a produced-file baseline for development projects', () => {
    expect(preTurnFileNamesForWorkMode('development', files)).toBeUndefined();
  });

  it('keeps the document artifact baseline for document/design work', () => {
    expect(preTurnFileNamesForWorkMode('document', files)).toEqual([
      'src/app.ts',
      'README.md',
    ]);
  });
});

describe('mergeRecoveredArtifact', () => {
  const fileA = { name: 'helper.txt', path: '/p/helper.txt', size: 1, updatedAt: 0 };
  const artifact = { name: 'deck.html', path: '/p/deck.html', size: 9, updatedAt: 0 };

  it('keeps pre-artifact files when a recovered artifact is appended', () => {
    const merged = mergeRecoveredArtifact([fileA] as never, artifact as never);
    expect(merged.map((f) => f.name)).toEqual(['helper.txt', 'deck.html']);
  });

  it('does not duplicate the artifact if the diff already contains it', () => {
    const merged = mergeRecoveredArtifact([fileA, artifact] as never, artifact as never);
    expect(merged.map((f) => f.name)).toEqual(['helper.txt', 'deck.html']);
  });

  it('returns the diff unchanged when no artifact was recovered', () => {
    const merged = mergeRecoveredArtifact([fileA] as never, null);
    expect(merged.map((f) => f.name)).toEqual(['helper.txt']);
  });
});

describe('findSameTurnHtmlWriteForRecoveredArtifact', () => {
  const html = '<!doctype html><html><head><title>Demo</title></head><body><main><h1>Demo</h1></main></body></html>';

  it('returns the same-turn HTML file when fallback content matches a Write output', async () => {
    const indexFile = {
      name: 'index.html',
      path: 'index.html',
      size: html.length,
      mtime: 2,
      kind: 'html',
      mime: 'text/html',
    };
    const readProjectHtml = vi.fn(async (name: string) =>
      name === 'index.html' ? `\uFEFF${html}\r\n` : null,
    );

    await expect(findSameTurnHtmlWriteForRecoveredArtifact({
      artifactHtml: `\n${html}\n`,
      producedFiles: [indexFile] as never,
      readProjectHtml,
    })).resolves.toBe(indexFile);
  });

  // #4308: agent-agnostic recovery is the *normalized exact content match* —
  // it already binds for any filesystem-backed CLI (not just Claude) when the
  // written file and the echoed artifact are the same document. We deliberately
  // do NOT bind on a content *mismatch*: a same-turn HTML file whose content
  // differs from the echo is a genuinely different document and must persist on
  // its own. (A blind single-file bind also mis-fired across queued runs, where
  // a prior run's artifact is still reported as "produced this turn" — the
  // app-restoration regression that motivated dropping it.)
  it('does not bind a single same-turn HTML file whose content differs from the echo', async () => {
    const indexFile = {
      name: 'index.html',
      path: 'index.html',
      size: html.length,
      mtime: 2,
      kind: 'html',
      mime: 'text/html',
    };

    await expect(findSameTurnHtmlWriteForRecoveredArtifact({
      artifactHtml: html,
      producedFiles: [indexFile] as never,
      readProjectHtml: vi.fn(async () => html.replace('Demo</h1>', 'Other</h1>')),
    })).resolves.toBeNull();
  });

  // ...and never bind when several same-turn HTML files all differ from the
  // echo — binding the wrong one could clobber the user's other in-flight work.
  it('avoids selection when multiple same-turn HTML files differ from the echo', async () => {
    const a = { name: 'a.html', path: 'a.html', kind: 'html', mime: 'text/html' };
    const b = { name: 'b.html', path: 'b.html', kind: 'html', mime: 'text/html' };

    await expect(findSameTurnHtmlWriteForRecoveredArtifact({
      artifactHtml: html,
      producedFiles: [a, b] as never,
      readProjectHtml: vi.fn(async (name: string) =>
        name === 'a.html' ? html.replace('Demo', 'AAA') : html.replace('Demo', 'BBB'),
      ),
    })).resolves.toBeNull();
  });

  // When multiple same-turn HTML files exist, bind the one whose normalized
  // content matches the echo — unambiguous regardless of which agent ran.
  it('binds the exact normalized match among multiple same-turn HTML files', async () => {
    const a = { name: 'a.html', path: 'a.html', kind: 'html', mime: 'text/html' };
    const b = { name: 'b.html', path: 'b.html', kind: 'html', mime: 'text/html' };

    await expect(findSameTurnHtmlWriteForRecoveredArtifact({
      artifactHtml: html,
      producedFiles: [a, b] as never,
      readProjectHtml: vi.fn(async (name: string) =>
        name === 'b.html' ? `﻿${html}\r\n` : html.replace('Demo', 'AAA'),
      ),
    })).resolves.toBe(b);
  });

  it('ignores non-HTML same-turn files', async () => {
    const readProjectHtml = vi.fn(async () => html);

    await expect(findSameTurnHtmlWriteForRecoveredArtifact({
      artifactHtml: html,
      producedFiles: [{ name: 'notes.md', path: 'notes.md', kind: 'text' }] as never,
      readProjectHtml,
    })).resolves.toBeNull();
    expect(readProjectHtml).not.toHaveBeenCalled();
  });
});

// #4318: when the model emits a prose-only <artifact> next to a complete
// same-turn <html> document, the call site must resolve the persisted HTML
// (recovering the preceding document) BEFORE the dedup lookup. Feeding the raw
// prose summary makes the normalized exact-match miss the same-turn Write file
// and the recovered document persists a second time as a duplicate artifact.
describe('same-turn dedup for recovered prose-only artifacts (#4318)', () => {
  const realHtml = '<!doctype html><html><head><title>Recovered</title></head><body><main><h1>Recovered</h1></main></body></html>';
  const proseSummary = '(The complete document above is the delivered artifact.)';
  const sourceText = `${realHtml}\n<artifact identifier="page" type="text/html">${proseSummary}</artifact>`;
  const indexFile = { name: 'index.html', path: 'index.html', kind: 'html', mime: 'text/html' };
  const readProjectHtml = () =>
    vi.fn(async (name: string) => (name === 'index.html' ? realHtml : null));

  it('binds the same-turn HTML write once the persisted HTML is resolved', async () => {
    const persistedHtml = resolvePersistedArtifactHtml({
      artifactHtml: proseSummary,
      identifier: 'page',
      sourceText,
    });
    await expect(findSameTurnHtmlWriteForRecoveredArtifact({
      artifactHtml: persistedHtml,
      producedFiles: [indexFile] as never,
      readProjectHtml: readProjectHtml(),
    })).resolves.toBe(indexFile);
  });

  it('misses the match when fed the raw prose summary (the pre-fix regression)', async () => {
    await expect(findSameTurnHtmlWriteForRecoveredArtifact({
      artifactHtml: proseSummary,
      producedFiles: [indexFile] as never,
      readProjectHtml: readProjectHtml(),
    })).resolves.toBeNull();
  });
});

describe('ProjectView daemon reattach restore', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.sessionStorage.clear();
    chatPaneStreamingStates.length = 0;
    autoApplyOpenRequests = true;
  });

  it('does not replay a terminal succeeded row just because produced files are missing', async () => {
    const startedAt = Date.now();
    listConversations.mockResolvedValue([{ id: 'conv-1', title: 'Conversation' }]);
    listMessages.mockResolvedValue([
      {
        id: 'msg-done',
        role: 'assistant',
        content: 'All done!',
        createdAt: startedAt,
        startedAt,
        runStatus: 'succeeded',
      } satisfies ChatMessage,
    ]);
    fetchPreviewComments.mockResolvedValue([]);
    loadTabs.mockResolvedValue({ tabs: [], activeTabId: null });
    fetchProjectFiles.mockResolvedValue([]);
    fetchLiveArtifacts.mockResolvedValue([]);
    fetchSkill.mockResolvedValue(null);
    fetchDesignSystem.mockResolvedValue(null);
    getTemplate.mockResolvedValue(null);

    renderProjectView();

    await waitFor(() => expect(listMessages).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fetchProjectFiles).toHaveBeenCalled());
    expect(listActiveChatRuns).not.toHaveBeenCalled();
    expect(listProjectRuns).not.toHaveBeenCalled();
    expect(fetchChatRunStatus).not.toHaveBeenCalled();
    expect(reattachDaemonRun).not.toHaveBeenCalled();
    expect(
      saveMessage.mock.calls
        .map((call) => call[2] as ChatMessage)
        .some((m) => m?.id === 'msg-done' && m.runStatus === 'failed'),
    ).toBe(false);
  });

  it('fails closed when terminal replay contains a complete artifact followed by a truncated one', async () => {
    const startedAt = Date.now();
    const replayed =
      '<artifact identifier="index.html" type="text/html">' +
      '<!doctype html><html><body><main>complete</main></body></html>' +
      '</artifact><artifact identifier="critique.json" type="application/json"';
    listConversations.mockResolvedValue([{ id: 'conv-1', title: 'Conversation' }]);
    listMessages.mockResolvedValue([{
      id: 'msg-truncated-artifacts',
      role: 'assistant',
      content: '',
      events: [{ kind: 'text', text: replayed }],
      createdAt: startedAt,
      startedAt,
      runId: 'run-truncated-artifacts',
      runStatus: 'succeeded',
      preTurnFileNames: [],
    } satisfies ChatMessage]);
    fetchPreviewComments.mockResolvedValue([]);
    loadTabs.mockResolvedValue({ tabs: [], active: null });
    fetchProjectFiles.mockResolvedValue([]);
    fetchLiveArtifacts.mockResolvedValue([]);
    fetchSkill.mockResolvedValue(null);
    fetchDesignSystem.mockResolvedValue(null);
    getTemplate.mockResolvedValue(null);
    fetchChatRunStatus.mockResolvedValue({
      id: 'run-truncated-artifacts',
      status: 'succeeded',
      createdAt: startedAt,
      updatedAt: startedAt,
      exitCode: 0,
      signal: null,
    });
    listActiveChatRuns.mockResolvedValue([]);

    renderProjectView();

    await waitFor(() => {
      const failed = saveMessage.mock.calls
        .map((call) => call[2] as ChatMessage)
        .find((message) => (
          message?.id === 'msg-truncated-artifacts'
          && message.runStatus === 'failed'
          && message.events?.some((event) => (
            event.kind === 'status'
            && event.label === 'artifact_delivery_failed'
          ))
        ));
      expect(failed).toBeTruthy();
    });
    expect(writeProjectTextFile).not.toHaveBeenCalled();
  });

  it('replays and verifies every artifact when delivery was interrupted by reload', async () => {
    const startedAt = Date.now();
    const replayed =
      '<artifact identifier="index.html" type="text/html">' +
      '<!doctype html><html><head><title>Dashboard</title></head><body><main>ready</main></body></html>' +
      '</artifact>' +
      '<artifact identifier="critique.json" type="application/json">' +
      '{"summary":"verified"}</artifact>';
    const written = new Map<string, string>();
    const currentFiles = () => [...written.entries()].map(([name, content], index) => ({
      name,
      path: name,
      size: content.length,
      mtime: startedAt + index + 1,
      kind: name.endsWith('.html') ? 'html' : 'code',
      mime: name.endsWith('.html') ? 'text/html' : 'application/json',
    }));
    listConversations.mockResolvedValue([{ id: 'conv-1', title: 'Conversation' }]);
    listMessages.mockResolvedValue([
      {
        id: 'user-interrupted-delivery',
        role: 'user',
        content: 'Create index.html and critique.json.',
      } satisfies ChatMessage,
      {
        id: 'msg-interrupted-delivery',
        role: 'assistant',
        content: '',
        events: [],
        createdAt: startedAt,
        startedAt,
        runId: 'run-interrupted-delivery',
        runStatus: 'succeeded',
        preTurnFileNames: [],
      } satisfies ChatMessage,
    ]);
    fetchPreviewComments.mockResolvedValue([]);
    loadTabs.mockResolvedValue({ tabs: [], activeTabId: null });
    fetchProjectFiles.mockImplementation(async () => currentFiles());
    fetchProjectFileText.mockImplementation(async (_projectId: string, name: string) => (
      written.get(name) ?? null
    ));
    writeProjectTextFile.mockImplementation(async (
      _projectId: string,
      name: string,
      content: string,
    ) => {
      written.set(name, content);
      return currentFiles().find((file) => file.name === name) ?? null;
    });
    fetchLiveArtifacts.mockResolvedValue([]);
    fetchSkill.mockResolvedValue(null);
    fetchDesignSystem.mockResolvedValue(null);
    getTemplate.mockResolvedValue(null);
    fetchChatRunStatus.mockResolvedValue({
      id: 'run-interrupted-delivery',
      status: 'succeeded',
      createdAt: startedAt,
      updatedAt: startedAt,
      exitCode: 0,
      signal: null,
      artifactDeliveryRequired: true,
    });
    listActiveChatRuns.mockResolvedValue([]);
    acknowledgeChatRunArtifactDelivery.mockResolvedValue({
      ok: true,
      applied: true,
      run: {
        id: 'run-interrupted-delivery',
        status: 'succeeded',
        artifactDeliveryRequired: true,
        artifactDelivery: {
          status: 'succeeded',
          acknowledgedAt: startedAt + 10,
          files: [
            { name: 'index.html', saved: true, readBack: true, previewReady: true },
            { name: 'critique.json', saved: true, readBack: true },
          ],
        },
      },
    });
    reattachDaemonRun.mockImplementation(async (options: any) => {
      options.handlers.onDelta(replayed);
      options.onRunStatus?.('succeeded');
      options.handlers.onDone();
    });
    rememberArtifactDeliveryCapability(
      'run-interrupted-delivery',
      'client-interrupted-delivery',
    );

    renderProjectView();

    await waitFor(() => {
      const restored = saveMessage.mock.calls
        .map((call) => call[2] as ChatMessage)
        .find((message) => (
          message?.id === 'msg-interrupted-delivery'
          && message.runStatus === 'succeeded'
          && message.producedFiles?.length === 2
        ));
      expect(restored?.producedFiles?.map((file) => file.name).sort()).toEqual([
        'critique.json',
        'index.html',
      ]);
    });
    expect([...written.keys()].sort()).toEqual(['critique.json', 'index.html']);
    expect(fetchProjectFileText).toHaveBeenCalledWith(
      'project-1',
      'index.html',
      expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }),
    );
    expect(acknowledgeChatRunArtifactDelivery).toHaveBeenCalledWith(
      'run-interrupted-delivery',
      {
        clientRequestId: 'client-interrupted-delivery',
        status: 'succeeded',
        files: expect.arrayContaining([
          { name: 'index.html', saved: true, readBack: true, previewReady: true },
          { name: 'critique.json', saved: true, readBack: true },
        ]),
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('keeps a single reattach owner and streaming UI until deferred recovery settles', async () => {
    const startedAt = Date.now();
    const html =
      '<!doctype html><html><head><title>Deferred</title></head>' +
      '<body><main>deferred recovery</main></body></html>';
    const replayed =
      '<artifact identifier="index.html" type="text/html">' + html + '</artifact>';
    const file = {
      name: 'index.html',
      path: 'index.html',
      size: html.length,
      mtime: startedAt + 1,
      kind: 'html',
      mime: 'text/html',
    };
    let written = false;
    let resolveReadback!: (value: string | null) => void;
    const pendingReadback = new Promise<string | null>((resolve) => {
      resolveReadback = resolve;
    });
    listConversations.mockResolvedValue([{ id: 'conv-1', title: 'Conversation' }]);
    listMessages.mockResolvedValue([
      { id: 'user-deferred', role: 'user', content: 'Create index.html.' } satisfies ChatMessage,
      {
        id: 'msg-deferred',
        role: 'assistant',
        content: '',
        events: [],
        createdAt: startedAt,
        startedAt,
        runId: 'run-deferred',
        runStatus: 'succeeded',
        preTurnFileNames: [],
      } satisfies ChatMessage,
    ]);
    fetchPreviewComments.mockResolvedValue([]);
    loadTabs.mockResolvedValue({ tabs: [], activeTabId: null });
    fetchProjectFiles.mockImplementation(async () => (written ? [file] : []));
    writeProjectTextFile.mockImplementation(async () => {
      written = true;
      return file;
    });
    fetchProjectFileText.mockImplementation(async () => pendingReadback);
    fetchLiveArtifacts.mockResolvedValue([]);
    fetchSkill.mockResolvedValue(null);
    fetchDesignSystem.mockResolvedValue(null);
    getTemplate.mockResolvedValue(null);
    fetchChatRunStatus.mockResolvedValue({
      id: 'run-deferred',
      status: 'succeeded',
      createdAt: startedAt,
      updatedAt: startedAt,
      exitCode: 0,
      signal: null,
      artifactDeliveryRequired: true,
    });
    listActiveChatRuns.mockResolvedValue([]);
    acknowledgeChatRunArtifactDelivery.mockResolvedValue({
      ok: true,
      applied: true,
      run: {
        id: 'run-deferred',
        status: 'succeeded',
        artifactDelivery: {
          status: 'succeeded',
          acknowledgedAt: startedAt + 2,
          files: [{ name: 'index.html', saved: true, readBack: true, previewReady: true }],
        },
      },
    });
    reattachDaemonRun.mockImplementation(async (options: any) => {
      options.handlers.onDelta(replayed);
      options.onRunStatus?.('succeeded');
      options.handlers.onDone();
    });
    rememberArtifactDeliveryCapability('run-deferred', 'client-deferred');

    renderProjectView();

    await waitFor(() => expect(fetchProjectFileText).toHaveBeenCalledTimes(1));
    expect(reattachDaemonRun).toHaveBeenCalledTimes(1);
    expect(writeProjectTextFile).toHaveBeenCalledTimes(1);
    expect(chatPaneStreamingStates.at(-1)).toBe(true);

    // Let React/effects cycle while readback is still pending. Ownership must
    // remain with the same recovery; no duplicate replay or write is allowed.
    await Promise.resolve();
    expect(reattachDaemonRun).toHaveBeenCalledTimes(1);
    expect(writeProjectTextFile).toHaveBeenCalledTimes(1);
    expect(chatPaneStreamingStates.at(-1)).toBe(true);

    resolveReadback(html);

    await waitFor(() => {
      expect(saveMessage.mock.calls
        .map((call) => call[2] as ChatMessage)
        .some((message) => (
          message?.id === 'msg-deferred'
          && message.runStatus === 'succeeded'
          && message.producedFiles?.some((entry) => entry.name === 'index.html')
        ))).toBe(true);
    });
    await waitFor(() => expect(chatPaneStreamingStates.at(-1)).toBe(false));
    expect(reattachDaemonRun).toHaveBeenCalledTimes(1);
    expect(writeProjectTextFile).toHaveBeenCalledTimes(1);
  });

  it('serializes exact previews for two concurrent interrupted HTML recoveries', async () => {
    const startedAt = Date.now();
    const htmlByRun = new Map([
      ['run-a', '<!doctype html><html><head><title>Alpha</title></head><body><main>alpha</main></body></html>'],
      ['run-b', '<!doctype html><html><head><title>Beta</title></head><body><main>beta</main></body></html>'],
    ]);
    const fileByRun = new Map([['run-a', 'alpha'], ['run-b', 'beta']]);
    const written = new Map<string, string>();
    const currentFiles = () => [...written.entries()].map(([name, content], index) => ({
      name,
      path: name,
      size: content.length,
      mtime: startedAt + index + 1,
      kind: 'html',
      mime: 'text/html',
    }));
    listConversations.mockResolvedValue([{ id: 'conv-1', title: 'Conversation' }]);
    listMessages.mockResolvedValue([
      { id: 'user-a', role: 'user', content: 'Create alpha.html.' } satisfies ChatMessage,
      { id: 'msg-a', role: 'assistant', content: '', events: [], createdAt: startedAt, startedAt, runId: 'run-a', runStatus: 'succeeded', preTurnFileNames: [] } satisfies ChatMessage,
      { id: 'user-b', role: 'user', content: 'Create beta.html.' } satisfies ChatMessage,
      { id: 'msg-b', role: 'assistant', content: '', events: [], createdAt: startedAt, startedAt, runId: 'run-b', runStatus: 'succeeded', preTurnFileNames: [] } satisfies ChatMessage,
    ]);
    fetchPreviewComments.mockResolvedValue([]);
    loadTabs.mockResolvedValue({ tabs: [], activeTabId: null });
    fetchProjectFiles.mockImplementation(async () => currentFiles());
    writeProjectTextFile.mockImplementation(async (_projectId: string, name: string, content: string) => {
      written.set(name, content);
      return currentFiles().find((file) => file.name === name) ?? null;
    });
    fetchProjectFileText.mockImplementation(async (_projectId: string, name: string) => written.get(name) ?? null);
    fetchLiveArtifacts.mockResolvedValue([]);
    fetchSkill.mockResolvedValue(null);
    fetchDesignSystem.mockResolvedValue(null);
    getTemplate.mockResolvedValue(null);
    fetchChatRunStatus.mockImplementation(async (runId: string) => ({
      id: runId,
      status: 'succeeded',
      createdAt: startedAt,
      updatedAt: startedAt,
      exitCode: 0,
      signal: null,
      artifactDeliveryRequired: true,
    }));
    listActiveChatRuns.mockResolvedValue([]);
    acknowledgeChatRunArtifactDelivery.mockImplementation(async (runId: string, body: any) => ({
      ok: true,
      applied: true,
      run: {
        id: runId,
        status: 'succeeded',
        artifactDeliveryRequired: true,
        artifactDelivery: { status: 'succeeded', acknowledgedAt: startedAt + 10, files: body.files },
      },
    }));
    reattachDaemonRun.mockImplementation(async (options: any) => {
      const identifier = fileByRun.get(options.runId)!;
      options.handlers.onDelta(
        `<artifact identifier="${identifier}" type="text/html" title="${identifier}.html">${htmlByRun.get(options.runId)}</artifact>`,
      );
      options.onRunStatus?.('succeeded');
      options.handlers.onDone();
    });
    rememberArtifactDeliveryCapability('run-a', 'client-a');
    rememberArtifactDeliveryCapability('run-b', 'client-b');
    autoApplyOpenRequests = false;

    renderProjectView();

    await waitFor(() => expect(reattachDaemonRun).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(writeProjectTextFile).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const props = fileWorkspaceSpy.mock.calls.at(-1)?.[0] as any;
      expect(props?.openRequest?.name).toBe('alpha.html');
    });
    let props = fileWorkspaceSpy.mock.calls.at(-1)?.[0] as any;
    const firstRequest = props.openRequest;
    props.onOpenRequestApplied(firstRequest, true);

    await waitFor(() => expect(writeProjectTextFile).toHaveBeenCalledTimes(2));
    expect(chatPaneStreamingStates.at(-1)).toBe(true);
    await waitFor(() => {
      const latest = fileWorkspaceSpy.mock.calls.at(-1)?.[0] as any;
      expect(latest?.openRequest?.name).toBe('beta.html');
      expect(latest?.openRequest?.nonce).not.toBe(firstRequest.nonce);
    });
    props = fileWorkspaceSpy.mock.calls.at(-1)?.[0] as any;
    props.onOpenRequestApplied(props.openRequest, true);

    await waitFor(() => expect(acknowledgeChatRunArtifactDelivery).toHaveBeenCalledTimes(2));
    expect(acknowledgeChatRunArtifactDelivery.mock.calls.map((call) => call[0]).sort())
      .toEqual(['run-a', 'run-b']);
    expect(written.size).toBe(2);
  });

  it('aborts an active recovery transaction when the project unmounts', async () => {
    const startedAt = Date.now();
    const html = '<!doctype html><html><head><title>Unmount</title></head><body><main>pending</main></body></html>';
    const file = { name: 'unmount.html', path: 'unmount.html', size: html.length, mtime: startedAt + 1, kind: 'html', mime: 'text/html' };
    let written = false;
    let recoverySignal: AbortSignal | null = null;
    listConversations.mockResolvedValue([{ id: 'conv-1', title: 'Conversation' }]);
    listMessages.mockResolvedValue([
      { id: 'user-unmount', role: 'user', content: 'Create unmount.html.' } satisfies ChatMessage,
      { id: 'msg-unmount', role: 'assistant', content: '', events: [], createdAt: startedAt, startedAt, runId: 'run-unmount', runStatus: 'succeeded', preTurnFileNames: [] } satisfies ChatMessage,
    ]);
    fetchPreviewComments.mockResolvedValue([]);
    loadTabs.mockResolvedValue({ tabs: [], activeTabId: null });
    fetchProjectFiles.mockImplementation(async () => written ? [file] : []);
    writeProjectTextFile.mockImplementation(async () => { written = true; return file; });
    fetchProjectFileText.mockResolvedValue(html);
    fetchLiveArtifacts.mockResolvedValue([]);
    fetchSkill.mockResolvedValue(null);
    fetchDesignSystem.mockResolvedValue(null);
    getTemplate.mockResolvedValue(null);
    fetchChatRunStatus.mockImplementation(async (_runId: string, options?: { signal?: AbortSignal }) => {
      if (options?.signal) recoverySignal = options.signal;
      return { id: 'run-unmount', status: 'succeeded', createdAt: startedAt, updatedAt: startedAt, exitCode: 0, signal: null, artifactDeliveryRequired: true };
    });
    listActiveChatRuns.mockResolvedValue([]);
    reattachDaemonRun.mockImplementation(async (options: any) => {
      options.handlers.onDelta(`<artifact identifier="unmount" type="text/html" title="unmount.html">${html}</artifact>`);
      options.handlers.onDone();
    });
    rememberArtifactDeliveryCapability('run-unmount', 'client-unmount');
    autoApplyOpenRequests = false;

    const view = renderProjectView();
    await waitFor(() => expect(writeProjectTextFile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(recoverySignal).not.toBeNull());
    expect(recoverySignal!.aborted).toBe(false);

    view.unmount();
    expect(recoverySignal!.aborted).toBe(true);
    await Promise.resolve();
    expect(acknowledgeChatRunArtifactDelivery).not.toHaveBeenCalled();
  });

  it('never lets a generic reattach error persist when authoritative delivery status is unavailable', async () => {
    const startedAt = Date.now();
    const replayed =
      '<artifact identifier="index.html" type="text/html">' +
      '<!doctype html><html><body>must use delivery gate</body></html>' +
      '</artifact>';
    listConversations.mockResolvedValue([{ id: 'conv-1', title: 'Conversation' }]);
    listMessages.mockResolvedValue([
      { id: 'user-error-gate', role: 'user', content: 'Create index.html.' } satisfies ChatMessage,
      {
        id: 'msg-error-gate',
        role: 'assistant',
        content: '',
        events: [],
        createdAt: startedAt,
        startedAt,
        runId: 'run-error-gate',
        runStatus: 'succeeded',
        preTurnFileNames: [],
      } satisfies ChatMessage,
    ]);
    fetchPreviewComments.mockResolvedValue([]);
    loadTabs.mockResolvedValue({ tabs: [], activeTabId: null });
    fetchProjectFiles.mockResolvedValue([]);
    fetchLiveArtifacts.mockResolvedValue([]);
    fetchSkill.mockResolvedValue(null);
    fetchDesignSystem.mockResolvedValue(null);
    getTemplate.mockResolvedValue(null);
    fetchChatRunStatus.mockResolvedValueOnce({
      id: 'run-error-gate',
      status: 'succeeded',
      createdAt: startedAt,
      updatedAt: startedAt,
      exitCode: 0,
      signal: null,
      artifactDeliveryRequired: true,
    }).mockResolvedValueOnce(null);
    listActiveChatRuns.mockResolvedValue([]);
    reattachDaemonRun.mockImplementation(async (options: any) => {
      options.handlers.onDelta(replayed);
      options.handlers.onError(new Error('stream disconnected before terminal replay'));
    });
    rememberArtifactDeliveryCapability('run-error-gate', 'client-error-gate');

    renderProjectView();

    await waitFor(() => expect(reattachDaemonRun).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fetchChatRunStatus.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(writeProjectTextFile).not.toHaveBeenCalled();
    expect(acknowledgeChatRunArtifactDelivery).not.toHaveBeenCalled();
    const finalMessage = saveMessage.mock.calls
      .map((call) => call[2] as ChatMessage)
      .filter((message) => message?.id === 'msg-error-gate')
      .at(-1);
    expect(finalMessage?.runStatus).toBe('failed');
    expect(finalMessage?.producedFiles ?? []).toHaveLength(0);
  });

  it.each([
    {
      name: 'duplicate artifact declarations',
      replayed:
        '<artifact identifier="index.html" type="text/html"><!doctype html><html><body>one</body></html></artifact>' +
        '<artifact identifier="index.html" type="text/html"><!doctype html><html><body>two</body></html></artifact>',
    },
    {
      name: 'an incomplete artifact tail',
      replayed:
        '<artifact identifier="index.html" type="text/html"><!doctype html><html><body>one</body></html></artifact>' +
        '<artifact identifier="critique.json" type="application/json"',
    },
  ])('fails closed for interrupted recovery with $name', async ({ replayed }) => {
    const startedAt = Date.now();
    listConversations.mockResolvedValue([{ id: 'conv-1', title: 'Conversation' }]);
    listMessages.mockResolvedValue([
      { id: 'user-invalid-replay', role: 'user', content: 'Create index.html.' } satisfies ChatMessage,
      {
        id: 'msg-invalid-replay',
        role: 'assistant',
        content: '',
        events: [],
        createdAt: startedAt,
        startedAt,
        runId: 'run-invalid-replay',
        runStatus: 'succeeded',
        preTurnFileNames: [],
      } satisfies ChatMessage,
    ]);
    fetchPreviewComments.mockResolvedValue([]);
    loadTabs.mockResolvedValue({ tabs: [], activeTabId: null });
    fetchProjectFiles.mockResolvedValue([]);
    fetchLiveArtifacts.mockResolvedValue([]);
    fetchSkill.mockResolvedValue(null);
    fetchDesignSystem.mockResolvedValue(null);
    getTemplate.mockResolvedValue(null);
    fetchChatRunStatus.mockResolvedValue({
      id: 'run-invalid-replay',
      status: 'succeeded',
      createdAt: startedAt,
      updatedAt: startedAt,
      exitCode: 0,
      signal: null,
      artifactDeliveryRequired: true,
    });
    listActiveChatRuns.mockResolvedValue([]);
    acknowledgeChatRunArtifactDelivery.mockResolvedValue({
      ok: true,
      applied: true,
      run: { id: 'run-invalid-replay', status: 'failed' },
    });
    reattachDaemonRun.mockImplementation(async (options: any) => {
      options.handlers.onDelta(replayed);
      options.onRunStatus?.('succeeded');
      options.handlers.onDone();
    });
    rememberArtifactDeliveryCapability('run-invalid-replay', 'client-invalid-replay');

    renderProjectView();

    await waitFor(() => {
      expect(saveMessage.mock.calls
        .map((call) => call[2] as ChatMessage)
        .some((message) => (
          message?.id === 'msg-invalid-replay'
          && message.runStatus === 'failed'
          && message.events?.some((event) => (
            event.kind === 'status' && event.label === 'artifact_delivery_failed'
          ))
        ))).toBe(true);
    });
    expect(writeProjectTextFile).not.toHaveBeenCalled();
  });

  it('restores every file from a previously acknowledged multi-artifact delivery', async () => {
    const startedAt = Date.now();
    const replayed =
      '<artifact identifier="index.html" type="text/html">' +
      '<!doctype html><html><body><main>dashboard</main></body></html>' +
      '</artifact>' +
      '<artifact identifier="critique.json" type="application/json">' +
      '{"summary":"reviewed"}</artifact>';
    const files = [
      { name: 'index.html', path: 'index.html', size: 10, mtime: startedAt + 1, kind: 'html', mime: 'text/html' },
      { name: 'critique.json', path: 'critique.json', size: 5, mtime: startedAt + 1, kind: 'code', mime: 'application/json' },
    ];
    listConversations.mockResolvedValue([{ id: 'conv-1', title: 'Conversation' }]);
    listMessages.mockResolvedValue([{
      id: 'msg-acknowledged-artifacts',
      role: 'assistant',
      content: '',
      events: [{ kind: 'text', text: replayed }],
      createdAt: startedAt,
      startedAt,
      runId: 'run-acknowledged-artifacts',
      runStatus: 'succeeded',
      preTurnFileNames: [],
    } satisfies ChatMessage]);
    fetchPreviewComments.mockResolvedValue([]);
    loadTabs.mockResolvedValue({ tabs: [], active: null });
    fetchProjectFiles.mockResolvedValue(files);
    fetchLiveArtifacts.mockResolvedValue([]);
    fetchSkill.mockResolvedValue(null);
    fetchDesignSystem.mockResolvedValue(null);
    getTemplate.mockResolvedValue(null);
    fetchChatRunStatus.mockResolvedValue({
      id: 'run-acknowledged-artifacts',
      status: 'succeeded',
      createdAt: startedAt,
      updatedAt: startedAt,
      exitCode: 0,
      signal: null,
      artifactDelivery: {
        status: 'succeeded',
        acknowledgedAt: startedAt + 2,
        files: [
          { name: 'index.html', saved: true, readBack: true, previewReady: true },
          { name: 'critique.json', saved: true, readBack: true },
        ],
      },
    });
    listActiveChatRuns.mockResolvedValue([]);

    renderProjectView();

    await waitFor(() => {
      const restored = saveMessage.mock.calls
        .map((call) => call[2] as ChatMessage)
        .find((message) => (
          message?.id === 'msg-acknowledged-artifacts'
          && message.runStatus === 'succeeded'
          && message.producedFiles?.length === 2
        ));
      expect(restored?.producedFiles?.map((file) => file.name)).toEqual([
        'index.html',
        'critique.json',
      ]);
    });
  });

  it('populates producedFiles on the persisted message after reattach completes', async () => {
    const startedAt = Date.now();
    listConversations.mockResolvedValue([{ id: 'conv-1', title: 'Conversation' }]);
    listMessages.mockResolvedValue([
      {
        id: 'msg-reattach',
        role: 'assistant',
        content: '',
        createdAt: startedAt,
        startedAt,
        runId: 'run-1',
        runStatus: 'running',
        preTurnFileNames: ['existing.html'],
      } satisfies ChatMessage,
    ]);
    fetchPreviewComments.mockResolvedValue([]);
    loadTabs.mockResolvedValue({ tabs: [], activeTabId: null });
    const beforeFiles = [{ name: 'existing.html', path: '/p/existing.html', size: 1, updatedAt: 0 }];
    const afterFiles = [
      ...beforeFiles,
      { name: 'new.pptx', path: '/p/new.pptx', size: 2, updatedAt: 0 },
    ];
    fetchProjectFiles.mockResolvedValueOnce(beforeFiles).mockResolvedValue(afterFiles);
    fetchLiveArtifacts.mockResolvedValue([]);
    fetchSkill.mockResolvedValue(null);
    fetchDesignSystem.mockResolvedValue(null);
    getTemplate.mockResolvedValue(null);
    fetchChatRunStatus.mockResolvedValue({
      id: 'run-1',
      status: 'running',
      createdAt: startedAt,
      updatedAt: startedAt,
      exitCode: null,
      signal: null,
    });
    listActiveChatRuns.mockResolvedValue([]);

    let capturedHandlers: {
      onDelta: (text: string) => void;
      onAgentEvent: (ev: unknown) => void;
      onDone: () => void;
    } | null = null;
    reattachDaemonRun.mockImplementation(
      async (options: { handlers: { onDelta: any; onAgentEvent: any; onDone: any } }) => {
        capturedHandlers = options.handlers;
        return new Promise<void>(() => {});
      },
    );

    renderProjectView();

    await waitFor(() => expect(reattachDaemonRun).toHaveBeenCalledTimes(1));
    expect(capturedHandlers).not.toBeNull();

    capturedHandlers!.onDelta('hello ');
    capturedHandlers!.onAgentEvent({ kind: 'thinking', text: 'reasoning step' });
    capturedHandlers!.onDelta('world');
    capturedHandlers!.onDone();

    await waitFor(() => {
      const lastWithProduced = saveMessage.mock.calls
        .map((call) => call[2] as ChatMessage)
        .filter((m) => m?.id === 'msg-reattach' && Array.isArray(m.producedFiles))
        .at(-1);
      expect(lastWithProduced?.producedFiles?.map((f) => f.name)).toEqual(['new.pptx']);
      expect(lastWithProduced?.runStatus).toBe('succeeded');
    });
  });

  it('reaches succeeded state via the SSE end event even when only the terminal event replays', async () => {
    const startedAt = Date.now();
    listConversations.mockResolvedValue([{ id: 'conv-1', title: 'Conversation' }]);
    listMessages.mockResolvedValue([
      {
        id: 'msg-late',
        role: 'assistant',
        content: 'partial',
        createdAt: startedAt,
        startedAt,
        runId: 'run-late',
        runStatus: 'running',
        preTurnFileNames: [],
      } satisfies ChatMessage,
    ]);
    fetchPreviewComments.mockResolvedValue([]);
    loadTabs.mockResolvedValue({ tabs: [], activeTabId: null });
    fetchProjectFiles.mockResolvedValue([]);
    fetchLiveArtifacts.mockResolvedValue([]);
    fetchSkill.mockResolvedValue(null);
    fetchDesignSystem.mockResolvedValue(null);
    getTemplate.mockResolvedValue(null);
    fetchChatRunStatus.mockResolvedValue({
      id: 'run-late',
      status: 'succeeded',
      createdAt: startedAt,
      updatedAt: startedAt,
      exitCode: 0,
      signal: null,
    });
    listActiveChatRuns.mockResolvedValue([]);

    let capturedOnDone: (() => void) | null = null;
    reattachDaemonRun.mockImplementation(
      async (options: { handlers: { onDone: () => void } }) => {
        capturedOnDone = options.handlers.onDone;
        return new Promise<void>(() => {});
      },
    );

    renderProjectView();

    await waitFor(() => expect(reattachDaemonRun).toHaveBeenCalledTimes(1));
    expect(capturedOnDone).not.toBeNull();
    capturedOnDone!();

    await waitFor(() => {
      const succeeded = saveMessage.mock.calls
        .map((call) => call[2] as ChatMessage)
        .find((m) => m?.id === 'msg-late' && m.runStatus === 'succeeded');
      expect(succeeded).toBeTruthy();
    });
  });

  it('preserves failed runStatus when onRunStatus records failure before onDone fires', async () => {
    const startedAt = Date.now();
    listConversations.mockResolvedValue([{ id: 'conv-1', title: 'Conversation' }]);
    listMessages.mockResolvedValue([
      {
        id: 'msg-fail',
        role: 'assistant',
        content: '',
        createdAt: startedAt,
        startedAt,
        runId: 'run-fail',
        runStatus: 'running',
        preTurnFileNames: [],
      } satisfies ChatMessage,
    ]);
    fetchPreviewComments.mockResolvedValue([]);
    loadTabs.mockResolvedValue({ tabs: [], activeTabId: null });
    fetchProjectFiles.mockResolvedValue([]);
    fetchLiveArtifacts.mockResolvedValue([]);
    fetchSkill.mockResolvedValue(null);
    fetchDesignSystem.mockResolvedValue(null);
    getTemplate.mockResolvedValue(null);
    fetchChatRunStatus.mockResolvedValue({
      id: 'run-fail',
      status: 'failed',
      createdAt: startedAt,
      updatedAt: startedAt,
      exitCode: 1,
      signal: null,
    });
    listActiveChatRuns.mockResolvedValue([]);

    let captured: {
      onDone: () => void;
      onRunStatus: (s: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled') => void;
    } | null = null;
    reattachDaemonRun.mockImplementation(async (options: any) => {
      captured = { onDone: options.handlers.onDone, onRunStatus: options.onRunStatus };
      return new Promise<void>(() => {});
    });

    renderProjectView();
    await waitFor(() => expect(reattachDaemonRun).toHaveBeenCalledTimes(1));
    expect(captured).not.toBeNull();

    captured!.onRunStatus('failed');
    captured!.onDone();

    await waitFor(() => {
      const finalSave = saveMessage.mock.calls
        .map((call) => call[2] as ChatMessage)
        .filter((m) => m?.id === 'msg-fail' && (m.runStatus === 'failed' || m.runStatus === 'succeeded'))
        .at(-1);
      expect(finalSave?.runStatus).toBe('failed');
    });
  });

  it('renders AMR recharge guidance when a reattached run reports insufficient balance', async () => {
    const startedAt = Date.now();
    listConversations.mockResolvedValue([{ id: 'conv-1', title: 'Conversation' }]);
    listMessages.mockResolvedValue([
      {
        id: 'msg-amr-balance',
        role: 'assistant',
        content: '',
        createdAt: startedAt,
        startedAt,
        runId: 'run-amr-balance',
        runStatus: 'running',
        preTurnFileNames: [],
      } satisfies ChatMessage,
    ]);
    fetchPreviewComments.mockResolvedValue([]);
    loadTabs.mockResolvedValue({ tabs: [], activeTabId: null });
    fetchProjectFiles.mockResolvedValue([]);
    fetchLiveArtifacts.mockResolvedValue([]);
    fetchSkill.mockResolvedValue(null);
    fetchDesignSystem.mockResolvedValue(null);
    getTemplate.mockResolvedValue(null);
    fetchChatRunStatus.mockResolvedValue({
      id: 'run-amr-balance',
      status: 'running',
      createdAt: startedAt,
      updatedAt: startedAt,
      exitCode: null,
      signal: null,
    });
    listActiveChatRuns.mockResolvedValue([]);

    reattachDaemonRun.mockImplementation(async (options: any) => {
      const error = new Error(
        'AMR Cloud reported insufficient balance for this model. Recharge your AMR wallet at https://open-design.ai/amr/wallet, then retry this run.',
      ) as Error & { code: string; details: unknown };
      error.code = 'AMR_INSUFFICIENT_BALANCE';
      error.details = {
        kind: 'amr_account',
        action: 'recharge',
        actionUrl: 'https://open-design.ai/amr/wallet',
      };
      options.handlers.onError(error);
    });

    renderProjectView();

    await waitFor(() => expect(reattachDaemonRun).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const finalSave = saveMessage.mock.calls
        .map((call) => call[2] as ChatMessage)
        .filter((m) => m?.id === 'msg-amr-balance' && m.runStatus === 'failed')
        .at(-1);
      expect(finalSave?.events?.some(
        (event) => event.kind === 'status'
          && event.label === 'error'
          && (event as { code?: string }).code === 'AMR_INSUFFICIENT_BALANCE',
      )).toBe(true);
    });
  });

  it('preserves canceled runStatus when onRunStatus records cancellation before onDone fires', async () => {
    const startedAt = Date.now();
    listConversations.mockResolvedValue([{ id: 'conv-1', title: 'Conversation' }]);
    listMessages.mockResolvedValue([
      {
        id: 'msg-cancel',
        role: 'assistant',
        content: '',
        createdAt: startedAt,
        startedAt,
        runId: 'run-cancel',
        runStatus: 'running',
        preTurnFileNames: [],
      } satisfies ChatMessage,
    ]);
    fetchPreviewComments.mockResolvedValue([]);
    loadTabs.mockResolvedValue({ tabs: [], activeTabId: null });
    fetchProjectFiles.mockResolvedValue([]);
    fetchLiveArtifacts.mockResolvedValue([]);
    fetchSkill.mockResolvedValue(null);
    fetchDesignSystem.mockResolvedValue(null);
    getTemplate.mockResolvedValue(null);
    fetchChatRunStatus.mockResolvedValue({
      id: 'run-cancel',
      status: 'canceled',
      createdAt: startedAt,
      updatedAt: startedAt,
      exitCode: null,
      signal: 'SIGTERM',
    });
    listActiveChatRuns.mockResolvedValue([]);

    let captured: {
      onDelta: (text: string) => void;
      onDone: () => void;
      onRunStatus: (s: any) => void;
    } | null = null;
    reattachDaemonRun.mockImplementation(async (options: any) => {
      captured = {
        onDelta: options.handlers.onDelta,
        onDone: options.handlers.onDone,
        onRunStatus: options.onRunStatus,
      };
      return new Promise<void>(() => {});
    });

    renderProjectView();
    await waitFor(() => expect(reattachDaemonRun).toHaveBeenCalledTimes(1));
    captured!.onDelta(
      '<artifact identifier="partial.html" type="text/html"><!doctype html><html><body>',
    );
    captured!.onRunStatus('canceled');
    captured!.onDone();

    await waitFor(() => {
      const finalSave = saveMessage.mock.calls
        .map((call) => call[2] as ChatMessage)
        .filter((m) => m?.id === 'msg-cancel' && (m.runStatus === 'canceled' || m.runStatus === 'succeeded'))
        .at(-1);
      expect(finalSave?.runStatus).toBe('canceled');
    });
    expect(writeProjectTextFile).not.toHaveBeenCalled();
  });

  it('persists the last buffered delta immediately on pagehide instead of waiting for the 500ms debounce', async () => {
    const startedAt = Date.now();
    listConversations.mockResolvedValue([{ id: 'conv-1', title: 'Conversation' }]);
    listMessages.mockResolvedValue([
      {
        id: 'msg-unload',
        role: 'assistant',
        content: '',
        createdAt: startedAt,
        startedAt,
        runId: 'run-unload',
        runStatus: 'running',
        preTurnFileNames: [],
      } satisfies ChatMessage,
    ]);
    fetchPreviewComments.mockResolvedValue([]);
    loadTabs.mockResolvedValue({ tabs: [], activeTabId: null });
    fetchProjectFiles.mockResolvedValue([]);
    fetchLiveArtifacts.mockResolvedValue([]);
    fetchSkill.mockResolvedValue(null);
    fetchDesignSystem.mockResolvedValue(null);
    getTemplate.mockResolvedValue(null);
    fetchChatRunStatus.mockResolvedValue({
      id: 'run-unload',
      status: 'running',
      createdAt: startedAt,
      updatedAt: startedAt,
      exitCode: null,
      signal: null,
    });
    listActiveChatRuns.mockResolvedValue([]);

    let capturedOnDelta: ((text: string) => void) | null = null;
    reattachDaemonRun.mockImplementation(async (options: any) => {
      capturedOnDelta = options.handlers.onDelta;
      return new Promise<void>(() => {});
    });

    renderProjectView();
    await waitFor(() => expect(reattachDaemonRun).toHaveBeenCalledTimes(1));
    expect(capturedOnDelta).not.toBeNull();

    // Stream a delta. persistSoon would schedule a save in 500ms, but the
    // page is about to be torn down — anything not yet persisted is lost.
    capturedOnDelta!('last buffered chunk');

    // Page reload fires pagehide synchronously while the document is still
    // alive; the buffered chunk must reach saveMessage with keepalive=true
    // BEFORE the debounce timer would otherwise fire.
    saveMessage.mockClear();
    window.dispatchEvent(new Event('pagehide'));

    await waitFor(() => {
      const keepaliveSave = saveMessage.mock.calls.find((call) => {
        const msg = call[2] as ChatMessage;
        const opts = call[3] as { keepalive?: boolean } | undefined;
        return (
          msg?.id === 'msg-unload' &&
          typeof msg.content === 'string' &&
          msg.content.includes('last buffered chunk') &&
          opts?.keepalive === true
        );
      });
      expect(keepaliveSave).toBeTruthy();
    });
  });
});
