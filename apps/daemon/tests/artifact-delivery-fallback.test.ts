import { describe, expect, it } from 'vitest';

import {
  executionProfileForArtifactDelivery,
  hasCompleteHostOwnedArtifactEnvelope,
  isHostOwnedArtifactFallbackAttempt,
  requiresHostOwnedArtifactDelivery,
  shouldEnforceCodexNativeSandboxCircuit,
  shouldRejectIncompleteHostOwnedArtifact,
  shouldStartHostOwnedArtifactFallback,
} from '../src/artifact-delivery-fallback.js';

const ERROR_CODE = 'CODEX_WINDOWS_SANDBOX_UNAVAILABLE';

describe('host-owned artifact delivery fallback', () => {
  it('is limited to artifact-producing Docs turns in creation projects', () => {
    expect(requiresHostOwnedArtifactDelivery({
      workMode: 'creation',
      sessionMode: 'docs',
      structuredArtifactInstructions: true,
    })).toBe(true);

    expect(requiresHostOwnedArtifactDelivery({
      workMode: 'development',
      sessionMode: 'docs',
      structuredArtifactInstructions: true,
    })).toBe(false);
    expect(requiresHostOwnedArtifactDelivery({
      workMode: 'creation',
      sessionMode: 'chat',
      structuredArtifactInstructions: true,
    })).toBe(false);
    expect(requiresHostOwnedArtifactDelivery({
      workMode: 'creation',
      sessionMode: 'docs',
      structuredArtifactInstructions: false,
    })).toBe(false);
  });

  it('starts once for the known native sandbox failure and never broadens a development run', () => {
    const base = {
      workMode: 'creation',
      sessionMode: 'docs',
      structuredArtifactInstructions: true,
      executionProfile: 'filesystem' as const,
      errorCode: ERROR_CODE,
    };

    expect(shouldStartHostOwnedArtifactFallback(base, ERROR_CODE)).toBe(true);
    expect(shouldStartHostOwnedArtifactFallback({
      ...base,
      fallbackAttempted: true,
    }, ERROR_CODE)).toBe(false);
    expect(shouldStartHostOwnedArtifactFallback({
      ...base,
      workMode: 'development',
    }, ERROR_CODE)).toBe(false);
    expect(shouldStartHostOwnedArtifactFallback({
      ...base,
      errorCode: 'OTHER_FAILURE',
    }, ERROR_CODE)).toBe(false);
  });

  it('uses text artifact delivery only after the one-way handoff', () => {
    expect(executionProfileForArtifactDelivery('filesystem', undefined)).toBe('filesystem');
    expect(executionProfileForArtifactDelivery('filesystem', true)).toBe('text_artifact');
    expect(executionProfileForArtifactDelivery('text_artifact', false)).toBe('text_artifact');
  });

  it('identifies only the one-way retry as a hard no-tools boundary', () => {
    expect(isHostOwnedArtifactFallbackAttempt({
      executionProfile: 'text_artifact',
      fallbackAttempted: true,
    })).toBe(true);
    expect(isHostOwnedArtifactFallbackAttempt({
      executionProfile: 'text_artifact',
      fallbackAttempted: false,
    })).toBe(false);
    expect(isHostOwnedArtifactFallbackAttempt({
      executionProfile: 'filesystem',
      fallbackAttempted: true,
    })).toBe(false);
  });

  it('does not let the native sandbox circuit block the no-tools recovery attempt', () => {
    expect(shouldEnforceCodexNativeSandboxCircuit('codex', 'filesystem')).toBe(true);
    expect(shouldEnforceCodexNativeSandboxCircuit('codex', 'text_artifact')).toBe(false);
    expect(shouldEnforceCodexNativeSandboxCircuit('claude', 'filesystem')).toBe(false);
  });

  it('accepts only a closed non-empty artifact envelope for host delivery', () => {
    expect(hasCompleteHostOwnedArtifactEnvelope(
      '<artifact identifier="deck" type="text/html"><!doctype html><html></html></artifact>',
    )).toBe(true);
    expect(hasCompleteHostOwnedArtifactEnvelope(
      '<artifact identifier="deck" type="text/html"><!doctype html><html></html>',
    )).toBe(false);
    expect(hasCompleteHostOwnedArtifactEnvelope('<artifact></artifact>')).toBe(false);
    expect(hasCompleteHostOwnedArtifactEnvelope('I finished the document.')).toBe(false);
  });

  it('rejects prose and partial output on the required no-tools delivery attempt', () => {
    const base = {
      deliveryRequired: true,
      executionProfile: 'text_artifact' as const,
      askedQuestion: false,
    };
    expect(shouldRejectIncompleteHostOwnedArtifact({
      ...base,
      assistantText: 'The requested document is complete.',
    })).toBe(true);
    expect(shouldRejectIncompleteHostOwnedArtifact({
      ...base,
      assistantText: '<artifact type="text/html"><html>',
    })).toBe(true);
    expect(shouldRejectIncompleteHostOwnedArtifact({
      ...base,
      assistantText: '<artifact type="text/html"><html></html></artifact>',
    })).toBe(false);
    expect(shouldRejectIncompleteHostOwnedArtifact({
      ...base,
      assistantText: '<question-form>{"questions":[]}</question-form>',
      askedQuestion: true,
    })).toBe(false);
    expect(shouldRejectIncompleteHostOwnedArtifact({
      ...base,
      executionProfile: 'filesystem',
      assistantText: 'Edited the existing file.',
    })).toBe(false);
  });
});
