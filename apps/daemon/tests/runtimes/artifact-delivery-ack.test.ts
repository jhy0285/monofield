import { describe, expect, it, vi } from 'vitest';

import { createChatRunService } from '../../src/runtimes/runs.js';

function createRuns() {
  return createChatRunService({
    createSseResponse: () => ({
      send: vi.fn(() => true),
      end: vi.fn(),
      cleanup: vi.fn(),
    }),
    createSseErrorPayload: (code: string, message: string) => ({
      error: { code, message },
    }),
    ttlMs: 60_000,
  });
}

describe('chat run artifact delivery acknowledgment', () => {
  it('monotonically revises a terminal agent success to delivery failure', () => {
    const runs = createRuns();
    const run = runs.create({ clientRequestId: 'client-1' });
    run.artifactDeliveryRequired = true;
    runs.finish(run, 'succeeded', 0, null);

    const result = runs.acknowledgeArtifactDelivery(run, {
      status: 'failed',
      files: [
        { name: 'index.html', saved: true, readBack: true, previewReady: false },
      ],
      error: 'The preview document failed to load.',
    });

    expect(result).toMatchObject({
      applied: true,
      run: {
        status: 'failed',
        errorCode: 'ARTIFACT_DELIVERY_FAILED',
        error: 'The preview document failed to load.',
        artifactDelivery: {
          status: 'failed',
          files: [
            { name: 'index.html', saved: true, readBack: true, previewReady: false },
          ],
        },
      },
    });
    expect(runs.statusBody(run)).toMatchObject({
      status: 'failed',
      artifactDelivery: { status: 'failed' },
    });
  });

  it('records a successful receipt and makes later acknowledgments idempotent', () => {
    const runs = createRuns();
    const run = runs.create({ clientRequestId: 'client-2' });
    run.artifactDeliveryRequired = true;
    runs.finish(run, 'succeeded', 0, null);

    const result = runs.acknowledgeArtifactDelivery(run, {
      status: 'succeeded',
      files: [
        { name: 'index.html', saved: true, readBack: true, previewReady: true },
        { name: 'critique.json', saved: true, readBack: true },
      ],
    });

    expect(result).toMatchObject({
      applied: true,
      run: {
        status: 'succeeded',
        artifactDelivery: {
          status: 'succeeded',
          files: [
            { name: 'index.html', saved: true, readBack: true, previewReady: true },
            { name: 'critique.json', saved: true, readBack: true },
          ],
        },
      },
    });

    const repeatedSuccess = runs.acknowledgeArtifactDelivery(run, {
      status: 'succeeded',
      files: [
        { name: 'index.html', saved: true, readBack: true, previewReady: true },
        { name: 'critique.json', saved: true, readBack: true },
      ],
    });
    const ambiguousFailure = runs.acknowledgeArtifactDelivery(run, {
      status: 'failed',
      files: [],
      error: 'the renderer lost the successful HTTP response',
    });

    expect(repeatedSuccess).toMatchObject({
      applied: false,
      reason: 'artifact-delivery-already-succeeded',
      run: { status: 'succeeded', artifactDelivery: { status: 'succeeded' } },
    });
    expect(ambiguousFailure).toMatchObject({
      applied: false,
      reason: 'artifact-delivery-already-succeeded',
      run: { status: 'succeeded', artifactDelivery: { status: 'succeeded' } },
    });
  });

  it('requires the in-memory run to finish before accepting a successful receipt', () => {
    const runs = createRuns();
    const run = runs.create({ clientRequestId: 'client-running' });
    run.artifactDeliveryRequired = true;

    const result = runs.acknowledgeArtifactDelivery(run, {
      status: 'succeeded',
      files: [
        { name: 'index.html', saved: true, readBack: true, previewReady: true },
      ],
    });

    expect(result).toMatchObject({
      applied: false,
      reason: 'run-not-terminal',
      run: { status: 'queued' },
    });
    expect(runs.statusBody(run)).not.toHaveProperty('artifactDelivery');
  });

  it('preserves cancellation and does not attach a late delivery result', () => {
    const runs = createRuns();
    const run = runs.create({ clientRequestId: 'client-3' });
    run.artifactDeliveryRequired = true;
    runs.finish(run, 'canceled', null, 'SIGTERM');

    const result = runs.acknowledgeArtifactDelivery(run, {
      status: 'failed',
      files: [],
      error: 'late browser failure',
    });

    expect(result).toMatchObject({
      applied: false,
      reason: 'run-canceled',
      run: { status: 'canceled' },
    });
    expect(runs.statusBody(run)).not.toHaveProperty('artifactDelivery');
  });

  it('allows Stop after process success while required host delivery is still pending', async () => {
    const runs = createRuns();
    const run = runs.create({ clientRequestId: 'client-delivery-stop' });
    run.artifactDeliveryRequired = true;
    runs.finish(run, 'succeeded', 0, null);

    const canceled = await runs.cancel(run);
    const lateReceipt = runs.acknowledgeArtifactDelivery(run, {
      status: 'failed',
      files: [],
      error: 'preview waiter aborted',
    });

    expect(canceled).toMatchObject({ status: 'canceled' });
    expect(lateReceipt).toMatchObject({
      applied: false,
      reason: 'run-canceled',
      run: { status: 'canceled' },
    });
  });

  it('does not let a later success erase an acknowledged delivery failure', () => {
    const runs = createRuns();
    const run = runs.create({ clientRequestId: 'client-4' });
    run.artifactDeliveryRequired = true;
    runs.finish(run, 'succeeded', 0, null);
    runs.acknowledgeArtifactDelivery(run, {
      status: 'failed',
      files: [],
      error: 'missing critique.json',
    });

    const result = runs.acknowledgeArtifactDelivery(run, {
      status: 'succeeded',
      files: [
        { name: 'index.html', saved: true, readBack: true, previewReady: true },
      ],
    });

    expect(result).toMatchObject({
      applied: false,
      reason: 'artifact-delivery-already-failed',
      run: {
        status: 'failed',
        errorCode: 'ARTIFACT_DELIVERY_FAILED',
      },
    });
  });

  it('rejects delivery receipts for ordinary non-artifact runs', () => {
    const runs = createRuns();
    const run = runs.create({ clientRequestId: 'client-development' });
    runs.finish(run, 'succeeded', 0, null);

    const result = runs.acknowledgeArtifactDelivery(run, {
      status: 'failed',
      files: [],
      error: 'must not revise a normal development run',
    });

    expect(result).toMatchObject({
      applied: false,
      reason: 'artifact-delivery-not-required',
      run: { status: 'succeeded' },
    });
    expect(runs.statusBody(run)).not.toHaveProperty('artifactDelivery');
  });
});
