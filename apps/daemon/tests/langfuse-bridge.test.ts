// MonoField ships no Langfuse sink: readTelemetrySinkConfig() is always null and
// reportRunCompleted() sends nothing. The bridge still builds a report context
// from the run, the database and app-config, so this suite pins what must hold
// whatever consent a user has set or whatever Langfuse keys the shell exports:
// no request is made, the delivery state says why, and odd run shapes (failed,
// no assistant message, duplicated tool events) never throw.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reportRunCompletedFromDaemon } from '../src/langfuse-bridge.js';

interface FakeMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: Array<Record<string, unknown>>;
  producedFiles?: Array<Record<string, unknown>>;
}

function makeDb(messagesByConvo: Record<string, FakeMessage[]> = {}) {
  return {
    __messages: messagesByConvo,
    prepare() {
      throw new Error('listMessages should be the only DB call in tests');
    },
  };
}

function makeRun(over: Partial<Parameters<typeof reportRunCompletedFromDaemon>[0]['run']> = {}) {
  const now = Date.now();
  return {
    id: 'run-id-1',
    projectId: 'proj-1',
    conversationId: 'conv-1',
    assistantMessageId: 'msg-1',
    agentId: 'claude',
    status: 'succeeded',
    createdAt: now - 4500,
    updatedAt: now,
    events: [
      {
        id: 1,
        event: 'agent',
        timestamp: now - 4000,
        data: {
          type: 'tool_use',
          id: 'tool-1',
          name: 'Bash',
          input: { command: 'ls -la' },
        },
      },
      {
        id: 2,
        event: 'agent',
        timestamp: now - 3500,
        data: {
          type: 'tool_result',
          toolUseId: 'tool-1',
          content: 'total 0',
          isError: false,
        },
      },
      {
        id: 3,
        event: 'agent',
        timestamp: now - 3000,
        data: {
          type: 'tool_use',
          id: 'tool-2',
          name: 'Write',
          input: { path: 'index.html' },
        },
      },
      {
        id: 4,
        event: 'agent',
        timestamp: now - 2500,
        data: {
          type: 'tool_result',
          toolUseId: 'tool-2',
          content: 'wrote index.html',
          isError: false,
        },
      },
      {
        id: 5,
        event: 'agent',
        timestamp: now - 2000,
        data: {
          type: 'usage',
          usage: { input_tokens: 100, output_tokens: 200 },
        },
      },
    ] as Array<{ id: number; event: string; data: unknown; timestamp?: number }>,
    userPrompt: 'design a coffee landing page',
    ...over,
  };
}

describe('langfuse-bridge.reportRunCompletedFromDaemon', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-bridge-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function writeAppCfg(cfg: Record<string, unknown>) {
    await writeFile(path.join(dataDir, 'app-config.json'), JSON.stringify(cfg));
  }

  it('does nothing when telemetry.metrics is off', async () => {
    await writeAppCfg({
      installationId: 'install-1',
      telemetry: { metrics: false },
    });
    const fetchSpy = vi.fn();
    const state = await reportRunCompletedFromDaemon({
      db: makeDb(),
      dataDir,
      run: makeRun() as any,
      fetchImpl: fetchSpy as any,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(state).toMatchObject({
      langfuse_expected: false,
      langfuse_delivery_status: 'not_expected',
      langfuse_drop_reason: 'metrics_consent_off',
    });
  });

  it('does nothing when conversation/tool content reporting is off', async () => {
    await writeAppCfg({
      installationId: 'install-1',
      telemetry: { metrics: true, content: false, artifactManifest: true },
    });
    const fetchSpy = vi.fn();
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      const state = await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({
          'conv-1': [
            {
              id: 'msg-1',
              role: 'assistant',
              content: 'sensitive output',
              producedFiles: [{ name: 'secret.html', kind: 'html', size: 1 }],
            },
          ],
        }),
        dataDir,
        run: makeRun() as any,
        fetchImpl: fetchSpy as any,
      });
      expect(state).toMatchObject({
        langfuse_expected: false,
        langfuse_delivery_status: 'not_expected',
        langfuse_drop_reason: 'content_consent_off',
      });
    } finally {
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does nothing when no app-config.json exists (fresh install)', async () => {
    const fetchSpy = vi.fn();
    await reportRunCompletedFromDaemon({
      db: makeDb(),
      dataDir,
      run: makeRun() as any,
      fetchImpl: fetchSpy as any,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  describe('with every consent on and Langfuse keys in the environment', () => {
    const userAttachment = {
      path: 'uploads/brand.pdf',
      name: 'brand.pdf',
      kind: 'file',
      size: 2_481_032,
      mime: 'application/pdf',
      sha256: '1234abcd',
    };
    const conversation: FakeMessage[] = [
      { id: 'user-1', role: 'user', content: 'Use this reference.', attachments: [userAttachment] },
      {
        id: 'msg-1',
        role: 'assistant',
        content: 'Here is the page.',
        producedFiles: [{ name: 'index.html', kind: 'html', size: 1200 }],
      },
    ];
    const duplicatedToolUse = {
      id: 9,
      event: 'agent',
      timestamp: Date.now() - 1000,
      data: { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } },
    };
    const cases: Array<{
      name: string;
      db: () => unknown;
      run: () => Record<string, unknown>;
    }> = [
      {
        name: 'a succeeded run with attachments, tool events and a produced file',
        db: () => makeDbWithListMessages({ 'conv-1': conversation }),
        run: () => makeRun(),
      },
      {
        name: 'a failed run with an error message',
        db: () => makeDbWithListMessages({ 'conv-1': conversation }),
        run: () => makeRun({ status: 'failed', error: 'agent exited with code 1' } as any),
      },
      {
        name: 'a run whose assistant message the web has not saved yet',
        db: () => makeDbWithListMessages({ 'conv-1': [conversation[0]!] }),
        run: () => makeRun(),
      },
      {
        name: 'a stream that repeats a tool_use record',
        db: () => makeDbWithListMessages({ 'conv-1': conversation }),
        run: () => {
          const run = makeRun();
          return { ...run, events: [...run.events, duplicatedToolUse] };
        },
      },
    ];

    for (const scenario of cases) {
      it(`sends nothing and says why for ${scenario.name}`, async () => {
        await writeAppCfg({
          installationId: 'install-uuid-1',
          telemetry: { metrics: true, content: true, artifactManifest: true },
        });
        const fetchSpy = vi.fn();
        process.env.LANGFUSE_PUBLIC_KEY = 'pk';
        process.env.LANGFUSE_SECRET_KEY = 'sk';
        try {
          await expect(
            reportRunCompletedFromDaemon({
              db: scenario.db() as any,
              dataDir,
              run: scenario.run() as any,
              fetchImpl: fetchSpy as any,
            }),
          ).resolves.toEqual({
            langfuse_expected: false,
            langfuse_delivery_status: 'not_expected',
            langfuse_drop_reason: 'missing_sink_config',
          });
        } finally {
          delete process.env.LANGFUSE_PUBLIC_KEY;
          delete process.env.LANGFUSE_SECRET_KEY;
        }
        expect(fetchSpy).not.toHaveBeenCalled();
      });
    }
  });
});

function makeDbWithListMessages(messagesByConvo: Record<string, FakeMessage[]>) {
  // Mirror db.ts: SELECT returns *Json columns and listMessages runs them
  // through normalizeMessage which JSON.parses producedFilesJson into
  // producedFiles. Tests pass producedFiles directly, so we round-trip
  // through JSON.stringify to match the real-world shape.
  return {
    prepare(_sql: string) {
      return {
        all(cid: string) {
          return (messagesByConvo[cid] ?? []).map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            agentId: null,
            agentName: null,
            runId: null,
            runStatus: null,
            lastRunEventId: null,
            eventsJson: null,
            attachmentsJson: m.attachments
              ? JSON.stringify(m.attachments)
              : null,
            commentAttachmentsJson: null,
            producedFilesJson: m.producedFiles
              ? JSON.stringify(m.producedFiles)
              : null,
            createdAt: 0,
            startedAt: null,
            endedAt: null,
            position: 0,
          }));
        },
      };
    },
  };
}
