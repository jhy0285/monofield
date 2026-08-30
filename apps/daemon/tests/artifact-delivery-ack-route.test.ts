import type { Server } from 'node:http';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

type StartedServer = {
  url: string;
  server: Server;
  shutdown?: () => Promise<void> | void;
};

type RunStatus = {
  id: string;
  status: string;
  error?: string | null;
  errorCode?: string | null;
  artifactDeliveryRequired?: boolean;
  artifactDelivery?: {
    status: string;
    files: Array<{ name: string }>;
  };
};

describe('POST /api/runs/:id/artifact-delivery', { timeout: 120_000 }, () => {
  let started: StartedServer | null = null;
  let fixtureDir: string | null = null;

  afterEach(async () => {
    await Promise.resolve(started?.shutdown?.());
    if (started?.server) {
      await new Promise<void>((resolve) => started?.server.close(() => resolve()));
    }
    started = null;
    if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
    fixtureDir = null;
  });

  it('requires a local origin and matching clientRequestId and keeps success idempotent', async () => {
    fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'monofield-artifact-ack-'));
    const opencodeBin = await writeFakeOpencode(fixtureDir);
    started = await startServer({ port: 0, returnServer: true }) as StartedServer;
    await putConfig(started.url, {
      agentId: 'opencode',
      agentCliEnv: { opencode: { OPENCODE_BIN: opencodeBin } },
      telemetry: { metrics: false, content: false, artifactManifest: false },
      privacyDecisionAt: Date.now(),
    });

    const created = await createSucceededRun(started.url);

    const crossOrigin = await acknowledge(started.url, created.runId, {
      clientRequestId: created.clientRequestId,
      status: 'failed',
      files: [],
      error: 'preview failed',
    }, { Origin: 'https://example.com' });
    expect(crossOrigin.status).toBe(403);

    const wrongClient = await acknowledge(started.url, created.runId, {
      clientRequestId: 'not-the-creating-client',
      status: 'failed',
      files: [],
      error: 'preview failed',
    });
    expect(wrongClient.status).toBe(403);

    const missingPreview = await acknowledge(started.url, created.runId, {
      clientRequestId: created.clientRequestId,
      status: 'succeeded',
      files: [{ name: 'index.html', saved: true, readBack: true }],
    });
    expect(missingPreview.status).toBe(400);

    const duplicateReceipt = await acknowledge(started.url, created.runId, {
      clientRequestId: created.clientRequestId,
      status: 'succeeded',
      files: [
        { name: 'index.html', saved: true, readBack: true, previewReady: true },
        { name: 'INDEX.HTML', saved: true, readBack: true, previewReady: true },
      ],
    });
    expect(duplicateReceipt.status).toBe(400);

    setMessageRunStatus(created.assistantMessageId, created.runId, 'running');
    const completeDelivery = await acknowledge(started.url, created.runId, {
      clientRequestId: created.clientRequestId,
      status: 'succeeded',
      files: [
        { name: 'index.html', saved: true, readBack: true, previewReady: true },
        { name: 'critique.json', saved: true, readBack: true },
      ],
    });
    expect(completeDelivery.status).toBe(200);
    expect(await completeDelivery.json()).toMatchObject({
      ok: true,
      applied: true,
      run: {
        status: 'succeeded',
        artifactDelivery: {
          status: 'succeeded',
          files: [
            { name: 'index.html' },
            { name: 'critique.json' },
          ],
        },
      },
    });
    expect(readMessageRunState(created.assistantMessageId, created.runId)).toMatchObject({
      runStatus: 'succeeded',
      endedAt: expect.any(Number),
    });

    const repeatedSuccess = await acknowledge(started.url, created.runId, {
      clientRequestId: created.clientRequestId,
      status: 'succeeded',
      files: [
        { name: 'index.html', saved: true, readBack: true, previewReady: true },
        { name: 'critique.json', saved: true, readBack: true },
      ],
    });
    expect(repeatedSuccess.status).toBe(200);
    expect(await repeatedSuccess.json()).toMatchObject({
      ok: true,
      applied: false,
      reason: 'artifact-delivery-already-succeeded',
      run: { status: 'succeeded', artifactDelivery: { status: 'succeeded' } },
    });

    // Models a renderer whose successful POST reached the daemon but whose
    // response was lost. A subsequent pessimistic failure must not downgrade
    // the authoritative successful receipt.
    const failedDelivery = await acknowledge(started.url, created.runId, {
      clientRequestId: created.clientRequestId,
      status: 'failed',
      files: [
        { name: 'index.html', saved: true, readBack: true, previewReady: false },
        { name: 'critique.json', saved: false, readBack: false },
      ],
      error: 'critique.json was not saved and the HTML preview failed to load.',
    });
    expect(failedDelivery.status).toBe(200);
    const failedBody = await failedDelivery.json() as {
      ok: boolean;
      applied: boolean;
      reason?: string;
      run: RunStatus;
    };
    expect(failedBody).toMatchObject({
      ok: true,
      applied: false,
      reason: 'artifact-delivery-already-succeeded',
      run: {
        status: 'succeeded',
        artifactDelivery: {
          status: 'succeeded',
          files: [
            { name: 'index.html' },
            { name: 'critique.json' },
          ],
        },
      },
    });

    const statusResponse = await fetch(
      `${started.url}/api/runs/${encodeURIComponent(created.runId)}`,
    );
    expect(statusResponse.status).toBe(200);
    expect(await statusResponse.json()).toMatchObject({
      status: 'succeeded',
      errorCode: null,
      artifactDelivery: { status: 'succeeded' },
    });

    const messagesResponse = await fetch(
      `${started.url}/api/projects/${encodeURIComponent(created.projectId)}`
      + `/conversations/${encodeURIComponent(created.conversationId)}/messages`,
    );
    expect(messagesResponse.status).toBe(200);
    const messagesBody = await messagesResponse.json() as {
      messages: Array<{ id: string; runStatus?: string }>;
    };
    expect(messagesBody.messages.find((message) => message.id === created.assistantMessageId))
      .toMatchObject({ runStatus: 'succeeded' });

    const failedCreated = await createSucceededRun(started.url);
    setMessageRunStatus(failedCreated.assistantMessageId, failedCreated.runId, 'running');
    const firstFailure = await acknowledge(started.url, failedCreated.runId, {
      clientRequestId: failedCreated.clientRequestId,
      status: 'failed',
      files: [],
      error: 'critique.json was not saved.',
    });
    expect(firstFailure.status).toBe(200);
    expect(await firstFailure.json()).toMatchObject({
      ok: true,
      applied: true,
      run: {
        status: 'failed',
        errorCode: 'ARTIFACT_DELIVERY_FAILED',
        artifactDelivery: { status: 'failed' },
      },
    });

    const cannotEraseFailure = await acknowledge(started.url, failedCreated.runId, {
      clientRequestId: failedCreated.clientRequestId,
      status: 'succeeded',
      files: [
        { name: 'index.html', saved: true, readBack: true, previewReady: true },
        { name: 'critique.json', saved: true, readBack: true },
      ],
    });
    expect(cannotEraseFailure.status).toBe(409);

    const failedMessagesResponse = await fetch(
      `${started.url}/api/projects/${encodeURIComponent(failedCreated.projectId)}`
      + `/conversations/${encodeURIComponent(failedCreated.conversationId)}/messages`,
    );
    const failedMessagesBody = await failedMessagesResponse.json() as {
      messages: Array<{ id: string; runStatus?: string }>;
    };
    expect(failedMessagesBody.messages.find(
      (message) => message.id === failedCreated.assistantMessageId,
    )).toMatchObject({ runStatus: 'failed' });

    const reconcileFailureCreated = await createSucceededRun(started.url);
    setMessageRunStatus(
      reconcileFailureCreated.assistantMessageId,
      reconcileFailureCreated.runId,
      'running',
    );
    const retryableSuccessReceipt = {
      clientRequestId: reconcileFailureCreated.clientRequestId,
      status: 'succeeded',
      files: [
        { name: 'index.html', saved: true, readBack: true, previewReady: true },
      ],
    };
    const removeFailureTrigger = installMessageReconciliationFailure(
      reconcileFailureCreated.assistantMessageId,
      reconcileFailureCreated.runId,
      'succeeded',
    );
    try {
      const failedReconciliation = await acknowledge(
        started.url,
        reconcileFailureCreated.runId,
        retryableSuccessReceipt,
      );
      expect(failedReconciliation.status).toBe(503);
      expect(await failedReconciliation.json()).toMatchObject({
        error: { code: 'ARTIFACT_DELIVERY_RECONCILIATION_FAILED' },
      });
    } finally {
      removeFailureTrigger();
    }
    expect(readMessageRunState(
      reconcileFailureCreated.assistantMessageId,
      reconcileFailureCreated.runId,
    )).toMatchObject({ runStatus: 'running', endedAt: null });
    const unreconciledStatus = await fetch(
      `${started.url}/api/runs/${encodeURIComponent(reconcileFailureCreated.runId)}`,
    );
    expect(await unreconciledStatus.json()).toMatchObject({
      status: 'succeeded',
      artifactDeliveryRequired: true,
    });
    expect(await fetch(
      `${started.url}/api/runs/${encodeURIComponent(reconcileFailureCreated.runId)}`,
    ).then((response) => response.json())).not.toHaveProperty('artifactDelivery');

    // The exact same capability-bound body remains retryable after the DB
    // failure because the first attempt never exposed an in-memory receipt.
    const retriedReconciliation = await acknowledge(
      started.url,
      reconcileFailureCreated.runId,
      retryableSuccessReceipt,
    );
    expect(retriedReconciliation.status).toBe(200);
    expect(await retriedReconciliation.json()).toMatchObject({
      ok: true,
      applied: true,
      run: { artifactDelivery: { status: 'succeeded' } },
    });
    expect(readMessageRunStatus(
      reconcileFailureCreated.assistantMessageId,
      reconcileFailureCreated.runId,
    )).toBe('succeeded');

    const failedReconcileCreated = await createSucceededRun(started.url);
    setMessageRunStatus(
      failedReconcileCreated.assistantMessageId,
      failedReconcileCreated.runId,
      'running',
    );
    const retryableFailedReceipt = {
      clientRequestId: failedReconcileCreated.clientRequestId,
      status: 'failed',
      files: [],
      error: 'preview failed after the file was saved',
    };
    const removeFailedTrigger = installMessageReconciliationFailure(
      failedReconcileCreated.assistantMessageId,
      failedReconcileCreated.runId,
      'failed',
    );
    try {
      const failedReconciliation = await acknowledge(
        started.url,
        failedReconcileCreated.runId,
        retryableFailedReceipt,
      );
      expect(failedReconciliation.status).toBe(503);
      expect(await failedReconciliation.json()).toMatchObject({
        error: { code: 'ARTIFACT_DELIVERY_RECONCILIATION_FAILED' },
      });
    } finally {
      removeFailedTrigger();
    }
    expect(readMessageRunState(
      failedReconcileCreated.assistantMessageId,
      failedReconcileCreated.runId,
    )).toMatchObject({ runStatus: 'running', endedAt: null });
    const unreconciledFailureRun = await fetch(
      `${started.url}/api/runs/${encodeURIComponent(failedReconcileCreated.runId)}`,
    ).then((response) => response.json());
    expect(unreconciledFailureRun).toMatchObject({ status: 'succeeded' });
    expect(unreconciledFailureRun).not.toHaveProperty('artifactDelivery');

    const retriedFailure = await acknowledge(
      started.url,
      failedReconcileCreated.runId,
      retryableFailedReceipt,
    );
    expect(retriedFailure.status).toBe(200);
    expect(await retriedFailure.json()).toMatchObject({
      ok: true,
      applied: true,
      run: {
        status: 'failed',
        errorCode: 'ARTIFACT_DELIVERY_FAILED',
        artifactDelivery: { status: 'failed' },
      },
    });
    expect(readMessageRunStatus(
      failedReconcileCreated.assistantMessageId,
      failedReconcileCreated.runId,
    )).toBe('failed');
    const repeatedFailure = await acknowledge(
      started.url,
      failedReconcileCreated.runId,
      retryableFailedReceipt,
    );
    expect(repeatedFailure.status).toBe(200);
    expect(await repeatedFailure.json()).toMatchObject({
      ok: true,
      applied: false,
      run: { status: 'failed', artifactDelivery: { status: 'failed' } },
    });

    const terminalCreated = await createSucceededRun(started.url);
    setMessageRunStatus(terminalCreated.assistantMessageId, terminalCreated.runId, 'canceled');
    const terminalFailureReceipt = {
      clientRequestId: terminalCreated.clientRequestId,
      status: 'failed',
      files: [],
      error: 'delivery failed after the message was already canceled',
    };
    const terminalFailure = await acknowledge(
      started.url,
      terminalCreated.runId,
      terminalFailureReceipt,
    );
    expect(terminalFailure.status).toBe(503);
    expect(await terminalFailure.json()).toMatchObject({
      error: { code: 'ARTIFACT_DELIVERY_RECONCILIATION_FAILED' },
    });
    expect(readMessageRunStatus(terminalCreated.assistantMessageId, terminalCreated.runId))
      .toBe('canceled');
    const terminalFailureRun = await fetch(
      `${started.url}/api/runs/${encodeURIComponent(terminalCreated.runId)}`,
    ).then((response) => response.json());
    expect(terminalFailureRun).toMatchObject({ status: 'succeeded' });
    expect(terminalFailureRun).not.toHaveProperty('artifactDelivery');

    setMessageRunStatus(terminalCreated.assistantMessageId, terminalCreated.runId, 'running');
    const retriedTerminalFailure = await acknowledge(
      started.url,
      terminalCreated.runId,
      terminalFailureReceipt,
    );
    expect(retriedTerminalFailure.status).toBe(200);
    expect(await retriedTerminalFailure.json()).toMatchObject({
      ok: true,
      applied: true,
      run: { status: 'failed', artifactDelivery: { status: 'failed' } },
    });

    for (const terminalStatus of ['failed', 'canceled'] as const) {
      const terminalSuccessCreated = await createSucceededRun(started.url);
      setMessageRunStatus(
        terminalSuccessCreated.assistantMessageId,
        terminalSuccessCreated.runId,
        terminalStatus,
      );
      const terminalSuccess = await acknowledge(
        started.url,
        terminalSuccessCreated.runId,
        {
          clientRequestId: terminalSuccessCreated.clientRequestId,
          status: 'succeeded',
          files: [
            { name: 'index.html', saved: true, readBack: true, previewReady: true },
          ],
        },
      );
      expect(terminalSuccess.status).toBe(503);
      expect(await terminalSuccess.json()).toMatchObject({
        error: { code: 'ARTIFACT_DELIVERY_RECONCILIATION_FAILED' },
      });
      expect(readMessageRunStatus(
        terminalSuccessCreated.assistantMessageId,
        terminalSuccessCreated.runId,
      )).toBe(terminalStatus);
      const terminalRun = await fetch(
        `${started.url}/api/runs/${encodeURIComponent(terminalSuccessCreated.runId)}`,
      ).then((response) => response.json());
      expect(terminalRun).not.toHaveProperty('artifactDelivery');

      // Once the persisted row is made eligible again, the identical ACK can
      // complete. The rejected attempt did not freeze an authoritative
      // in-memory success receipt or overwrite the terminal row.
      setMessageRunStatus(
        terminalSuccessCreated.assistantMessageId,
        terminalSuccessCreated.runId,
        'running',
      );
      const retriedTerminalSuccess = await acknowledge(
        started.url,
        terminalSuccessCreated.runId,
        {
          clientRequestId: terminalSuccessCreated.clientRequestId,
          status: 'succeeded',
          files: [
            { name: 'index.html', saved: true, readBack: true, previewReady: true },
          ],
        },
      );
      expect(retriedTerminalSuccess.status).toBe(200);
      expect(await retriedTerminalSuccess.json()).toMatchObject({
        ok: true,
        applied: true,
        run: { artifactDelivery: { status: 'succeeded' } },
      });
    }
  });

  it('reconciles the assistant message when Stop cancels pending host delivery', async () => {
    fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'monofield-artifact-cancel-'));
    const opencodeBin = await writeFakeOpencode(fixtureDir);
    started = await startServer({ port: 0, returnServer: true }) as StartedServer;
    await putConfig(started.url, {
      agentId: 'opencode',
      agentCliEnv: { opencode: { OPENCODE_BIN: opencodeBin } },
      telemetry: { metrics: false, content: false, artifactManifest: false },
      privacyDecisionAt: Date.now(),
    });

    const created = await createSucceededRun(started.url);
    setMessageRunStatus(created.assistantMessageId, created.runId, 'queued');
    const beforeCancel = await fetch(
      `${started.url}/api/projects/${encodeURIComponent(created.projectId)}`
      + `/conversations/${encodeURIComponent(created.conversationId)}/messages`,
    );
    const beforeCancelBody = await beforeCancel.json() as {
      messages: Array<{ id: string; runStatus?: string }>;
    };
    expect(beforeCancelBody.messages.find((message) => message.id === created.assistantMessageId))
      .toMatchObject({ runStatus: 'queued' });

    const canceled = await fetch(
      `${started.url}/api/runs/${encodeURIComponent(created.runId)}/cancel`,
      { method: 'POST' },
    );
    expect(canceled.status).toBe(200);
    expect(await canceled.json()).toMatchObject({
      ok: true,
      run: { status: 'canceled', artifactDeliveryRequired: true },
    });

    const afterCancel = await fetch(
      `${started.url}/api/projects/${encodeURIComponent(created.projectId)}`
      + `/conversations/${encodeURIComponent(created.conversationId)}/messages`,
    );
    const afterCancelBody = await afterCancel.json() as {
      messages: Array<{ id: string; runStatus?: string }>;
    };
    expect(afterCancelBody.messages.find((message) => message.id === created.assistantMessageId))
      .toMatchObject({ runStatus: 'canceled' });

    const repeatedCancel = await fetch(
      `${started.url}/api/runs/${encodeURIComponent(created.runId)}/cancel`,
      { method: 'POST' },
    );
    expect(repeatedCancel.status).toBe(200);
    expect(await repeatedCancel.json()).toMatchObject({
      ok: true,
      run: { status: 'canceled' },
    });

    const retryableCancelCreated = await createSucceededRun(started.url);
    setMessageRunStatus(
      retryableCancelCreated.assistantMessageId,
      retryableCancelCreated.runId,
      'queued',
    );
    const removeCancelTrigger = installMessageReconciliationFailure(
      retryableCancelCreated.assistantMessageId,
      retryableCancelCreated.runId,
      'canceled',
    );
    try {
      const failedCancel = await fetch(
        `${started.url}/api/runs/${encodeURIComponent(retryableCancelCreated.runId)}/cancel`,
        { method: 'POST' },
      );
      expect(failedCancel.status).toBe(503);
      expect(await failedCancel.json()).toMatchObject({
        error: { code: 'ARTIFACT_DELIVERY_RECONCILIATION_FAILED' },
      });
    } finally {
      removeCancelTrigger();
    }
    expect(readMessageRunState(
      retryableCancelCreated.assistantMessageId,
      retryableCancelCreated.runId,
    )).toMatchObject({ runStatus: 'queued', endedAt: null });
    const unreconciledCancelRun = await fetch(
      `${started.url}/api/runs/${encodeURIComponent(retryableCancelCreated.runId)}`,
    ).then((response) => response.json());
    expect(unreconciledCancelRun).toMatchObject({
      status: 'succeeded',
      cancelRequested: false,
    });

    const retriedCancel = await fetch(
      `${started.url}/api/runs/${encodeURIComponent(retryableCancelCreated.runId)}/cancel`,
      { method: 'POST' },
    );
    expect(retriedCancel.status).toBe(200);
    expect(await retriedCancel.json()).toMatchObject({
      ok: true,
      run: { status: 'canceled', cancelRequested: true },
    });
    expect(readMessageRunStatus(
      retryableCancelCreated.assistantMessageId,
      retryableCancelCreated.runId,
    )).toBe('canceled');

    const lateFailure = await acknowledge(started.url, created.runId, {
      clientRequestId: created.clientRequestId,
      status: 'failed',
      files: [],
      error: 'preview waiter aborted',
    });
    expect(lateFailure.status).toBe(200);
    expect(await lateFailure.json()).toMatchObject({
      ok: true,
      applied: false,
      reason: 'run-canceled',
      run: { status: 'canceled' },
    });

    const terminalCreated = await createSucceededRun(started.url);
    setMessageRunStatus(terminalCreated.assistantMessageId, terminalCreated.runId, 'failed');
    const terminalCancel = await fetch(
      `${started.url}/api/runs/${encodeURIComponent(terminalCreated.runId)}/cancel`,
      { method: 'POST' },
    );
    expect(terminalCancel.status).toBe(503);
    expect(await terminalCancel.json()).toMatchObject({
      error: { code: 'ARTIFACT_DELIVERY_RECONCILIATION_FAILED' },
    });
    expect(readMessageRunStatus(terminalCreated.assistantMessageId, terminalCreated.runId))
      .toBe('failed');
    const terminalCancelRun = await fetch(
      `${started.url}/api/runs/${encodeURIComponent(terminalCreated.runId)}`,
    ).then((response) => response.json());
    expect(terminalCancelRun).toMatchObject({
      status: 'succeeded',
      cancelRequested: false,
    });

    setMessageRunStatus(terminalCreated.assistantMessageId, terminalCreated.runId, 'queued');
    const retriedTerminalCancel = await fetch(
      `${started.url}/api/runs/${encodeURIComponent(terminalCreated.runId)}/cancel`,
      { method: 'POST' },
    );
    expect(retriedTerminalCancel.status).toBe(200);
    expect(await retriedTerminalCancel.json()).toMatchObject({
      ok: true,
      run: { status: 'canceled' },
    });
    expect(readMessageRunStatus(terminalCreated.assistantMessageId, terminalCreated.runId))
      .toBe('canceled');
  });

  it('rejects artifact delivery receipts for ordinary development runs', async () => {
    fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'monofield-artifact-ack-scope-'));
    const opencodeBin = await writeFakeOpencode(fixtureDir);
    started = await startServer({ port: 0, returnServer: true }) as StartedServer;
    await putConfig(started.url, {
      agentId: 'opencode',
      agentCliEnv: { opencode: { OPENCODE_BIN: opencodeBin } },
      telemetry: { metrics: false, content: false, artifactManifest: false },
      privacyDecisionAt: Date.now(),
    });

    const created = await createSucceededRun(started.url, { development: true });
    const receipt = await acknowledge(started.url, created.runId, {
      clientRequestId: created.clientRequestId,
      status: 'failed',
      files: [],
      error: 'must not revise an ordinary development run',
    });

    expect(receipt.status).toBe(409);
    expect(await receipt.json()).toMatchObject({
      error: { code: 'ARTIFACT_DELIVERY_NOT_REQUIRED' },
    });
    const status = await fetch(`${started.url}/api/runs/${encodeURIComponent(created.runId)}`);
    expect(await status.json()).toMatchObject({
      status: 'succeeded',
      artifactDeliveryRequired: false,
    });
  });

  it('does not await artifact delivery for a successful question-form-only Docs turn', async () => {
    fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'monofield-artifact-question-'));
    const opencodeBin = await writeFakeOpencode(fixtureDir);
    started = await startServer({ port: 0, returnServer: true }) as StartedServer;
    await putConfig(started.url, {
      agentId: 'opencode',
      agentCliEnv: { opencode: { OPENCODE_BIN: opencodeBin } },
      telemetry: { metrics: false, content: false, artifactManifest: false },
      privacyDecisionAt: Date.now(),
    });

    const created = await createSucceededRun(started.url, {
      message: 'QUESTION_FORM_ONLY_FIXTURE',
    });
    const firstStatus = await fetch(`${started.url}/api/runs/${encodeURIComponent(created.runId)}`);
    expect(await firstStatus.json()).toMatchObject({
      status: 'succeeded',
      artifactDeliveryRequired: false,
    });

    // Models the reconnect path trying to submit a stale, pessimistic receipt:
    // the daemon must reject it and preserve the successful clarification.
    const staleReceipt = await acknowledge(started.url, created.runId, {
      clientRequestId: created.clientRequestId,
      status: 'failed',
      files: [],
      error: 'No artifact was present after reconnect.',
    });
    expect(staleReceipt.status).toBe(409);
    expect(await staleReceipt.json()).toMatchObject({
      error: { code: 'ARTIFACT_DELIVERY_NOT_REQUIRED' },
    });
    const reconnectedStatus = await fetch(
      `${started.url}/api/runs/${encodeURIComponent(created.runId)}`,
    );
    expect(await reconnectedStatus.json()).toMatchObject({
      status: 'succeeded',
      errorCode: null,
      artifactDeliveryRequired: false,
    });
  });

  it('keeps artifact delivery required when a question form is mixed with an artifact', async () => {
    fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'monofield-artifact-mixed-'));
    const opencodeBin = await writeFakeOpencode(fixtureDir);
    started = await startServer({ port: 0, returnServer: true }) as StartedServer;
    await putConfig(started.url, {
      agentId: 'opencode',
      agentCliEnv: { opencode: { OPENCODE_BIN: opencodeBin } },
      telemetry: { metrics: false, content: false, artifactManifest: false },
      privacyDecisionAt: Date.now(),
    });

    const created = await createSucceededRun(started.url, {
      message: 'MIXED_FORM_ARTIFACT_FIXTURE',
    });
    const status = await fetch(`${started.url}/api/runs/${encodeURIComponent(created.runId)}`);
    expect(await status.json()).toMatchObject({
      status: 'succeeded',
      artifactDeliveryRequired: true,
    });
  });

  it('keeps delivery fail-closed when a native artifact write is followed by a question form', async () => {
    fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'monofield-artifact-write-form-'));
    const opencodeBin = await writeFakeOpencode(fixtureDir);
    started = await startServer({ port: 0, returnServer: true }) as StartedServer;
    await putConfig(started.url, {
      agentId: 'opencode',
      agentCliEnv: { opencode: { OPENCODE_BIN: opencodeBin } },
      telemetry: { metrics: false, content: false, artifactManifest: false },
      privacyDecisionAt: Date.now(),
    });

    const created = await createSucceededRun(started.url, {
      message: 'NATIVE_WRITE_THEN_FORM_FIXTURE',
    });
    const status = await fetch(`${started.url}/api/runs/${encodeURIComponent(created.runId)}`);
    expect(await status.json()).toMatchObject({
      status: 'succeeded',
      artifactDeliveryRequired: true,
    });

    const failedReceipt = await acknowledge(started.url, created.runId, {
      clientRequestId: created.clientRequestId,
      status: 'failed',
      files: [{ name: 'index.html', saved: false, readBack: false }],
      error: 'The written artifact could not be read back.',
    });
    expect(failedReceipt.status).toBe(200);
    expect(await failedReceipt.json()).toMatchObject({
      run: {
        status: 'failed',
        errorCode: 'ARTIFACT_DELIVERY_FAILED',
        artifactDeliveryRequired: true,
      },
    });
  });
});

async function writeFakeOpencode(dir: string): Promise<string> {
  const source = `const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('opencode 1.0.0-test'); process.exit(0); }
if (args[0] === 'models') { console.log('test/model'); process.exit(0); }
if (args[0] !== 'run') { process.exit(0); }
let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { stdin += chunk; });
process.stdin.on('end', () => {
  const form = 'Need one choice.\\n<question-form id="direction">\\n{"questions":[{"id":"tone","label":"Tone","type":"text"}]}\\n</question-form>';
  const artifact = '<artifact type="text/html"><!doctype html><html><body>Draft</body></html></artifact>';
  if (stdin.includes('NATIVE_WRITE_THEN_FORM_FIXTURE')) {
    console.log(JSON.stringify({
      type: 'tool_use',
      sessionID: 'artifact-ack-session',
      part: {
        tool: 'Write',
        callID: 'write-index-html',
        state: {
          input: { file_path: 'index.html', content: '<!doctype html><html><body>Draft</body></html>' },
          status: 'completed',
          output: 'Wrote index.html',
        },
      },
    }));
  }
  const text = stdin.includes('MIXED_FORM_ARTIFACT_FIXTURE')
    ? form + '\\n' + artifact
    : stdin.includes('QUESTION_FORM_ONLY_FIXTURE')
      ? form
      : 'Done.';
  console.log(JSON.stringify({ type: 'step_start', sessionID: 'artifact-ack-session', part: { type: 'step-start' } }));
  console.log(JSON.stringify({ type: 'text', sessionID: 'artifact-ack-session', part: { type: 'text', text } }));
  console.log(JSON.stringify({ type: 'step_finish', sessionID: 'artifact-ack-session', part: { type: 'step-finish', tokens: { input: 2, output: 1 }, cost: 0 } }));
});
`;
  const scriptPath = path.join(dir, 'fake-opencode.js');
  await writeFile(scriptPath, source, 'utf8');
  if (process.platform === 'win32') {
    const cmdPath = path.join(dir, 'fake-opencode.cmd');
    await writeFile(cmdPath, '@echo off\r\nnode "%~dp0fake-opencode.js" %*\r\n', 'utf8');
    return cmdPath;
  }
  const binPath = path.join(dir, 'fake-opencode');
  await writeFile(binPath, `#!/usr/bin/env node\n${source}`, 'utf8');
  await chmod(binPath, 0o755);
  return binPath;
}

async function putConfig(url: string, patch: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${url}/api/app-config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  expect(response.status).toBe(200);
}

async function createSucceededRun(
  url: string,
  options: { development?: boolean; message?: string } = {},
): Promise<{
  runId: string;
  projectId: string;
  conversationId: string;
  assistantMessageId: string;
  clientRequestId: string;
}> {
  const projectId = `artifact_ack_${randomUUID()}`;
  const projectResponse = await fetch(`${url}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: projectId,
      name: 'Artifact acknowledgment route',
      metadata: options.development
        ? { kind: 'software', workMode: 'development' }
        : { kind: 'template', workMode: 'creation' },
      skipDiscoveryBrief: true,
    }),
  });
  expect(projectResponse.status).toBe(200);
  const project = await projectResponse.json() as { conversationId: string };
  const assistantMessageId = `assistant_${randomUUID()}`;
  const clientRequestId = `client_${randomUUID()}`;
  const response = await fetch(`${url}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId,
      conversationId: project.conversationId,
      assistantMessageId,
      clientRequestId,
      agentId: 'opencode',
      sessionMode: options.development ? 'question' : 'docs',
      message: options.message ?? 'Say done.',
      currentPrompt: options.message ?? 'Say done.',
    }),
  });
  expect(response.status).toBe(202);
  const created = await response.json() as { runId: string };
  const status = await waitForRun(url, created.runId);
  expect(status.status).toBe('succeeded');
  return {
    runId: created.runId,
    projectId,
    conversationId: project.conversationId,
    assistantMessageId,
    clientRequestId,
  };
}

async function acknowledge(
  url: string,
  runId: string,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${url}/api/runs/${encodeURIComponent(runId)}/artifact-delivery`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  });
}

function setMessageRunStatus(
  assistantMessageId: string,
  runId: string,
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled',
): void {
  const dataDir = process.env.OD_DATA_DIR;
  if (!dataDir) throw new Error('OD_DATA_DIR is required for artifact delivery tests');
  const sqlite = new Database(path.join(dataDir, 'app.sqlite'));
  try {
    const result = sqlite.prepare(
      `UPDATE messages
          SET run_status = ?,
              ended_at = CASE WHEN ? IN ('queued', 'running') THEN NULL ELSE ended_at END
        WHERE id = ? AND run_id = ?`,
    ).run(status, status, assistantMessageId, runId);
    expect(result.changes).toBe(1);
  } finally {
    sqlite.close();
  }
}

function installMessageReconciliationFailure(
  assistantMessageId: string,
  runId: string,
  targetStatus: 'succeeded' | 'failed' | 'canceled',
): () => void {
  const dataDir = process.env.OD_DATA_DIR;
  if (!dataDir) throw new Error('OD_DATA_DIR is required for artifact delivery tests');
  const databasePath = path.join(dataDir, 'app.sqlite');
  const triggerName = `artifact_ack_failure_${randomUUID().replaceAll('-', '')}`;
  const quoteSqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const sqlite = new Database(databasePath);
  try {
    sqlite.exec(
      `CREATE TRIGGER "${triggerName}"
         BEFORE UPDATE OF run_status ON messages
         WHEN OLD.id = ${quoteSqlString(assistantMessageId)}
          AND OLD.run_id = ${quoteSqlString(runId)}
           AND NEW.run_status = ${quoteSqlString(targetStatus)}
       BEGIN
         SELECT RAISE(ABORT, 'injected artifact reconciliation failure');
       END`,
    );
  } finally {
    sqlite.close();
  }
  return () => {
    const cleanup = new Database(databasePath);
    try {
      cleanup.exec(`DROP TRIGGER IF EXISTS "${triggerName}"`);
    } finally {
      cleanup.close();
    }
  };
}

function readMessageRunStatus(assistantMessageId: string, runId: string): string | null {
  return readMessageRunState(assistantMessageId, runId)?.runStatus ?? null;
}

function readMessageRunState(
  assistantMessageId: string,
  runId: string,
): { runStatus: string | null; endedAt: number | null } | null {
  const dataDir = process.env.OD_DATA_DIR;
  if (!dataDir) throw new Error('OD_DATA_DIR is required for artifact delivery tests');
  const sqlite = new Database(path.join(dataDir, 'app.sqlite'), { readonly: true });
  try {
    const row = sqlite.prepare(
      `SELECT run_status, ended_at FROM messages WHERE id = ? AND run_id = ?`,
    ).get(assistantMessageId, runId) as {
      run_status: string | null;
      ended_at: number | null;
    } | undefined;
    return row
      ? { runStatus: row.run_status, endedAt: row.ended_at }
      : null;
  } finally {
    sqlite.close();
  }
}

async function waitForRun(url: string, runId: string): Promise<RunStatus> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 60_000) {
    const response = await fetch(`${url}/api/runs/${encodeURIComponent(runId)}`);
    expect(response.status).toBe(200);
    const run = await response.json() as RunStatus;
    if (['succeeded', 'failed', 'canceled'].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`run ${runId} did not finish`);
}
