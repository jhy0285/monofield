import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  interfaceSpecDatabaseAccessAllowed,
  isInterfaceSpecDatabaseSampleAnswer,
  isInterfaceSpecFormAnswer,
  readPersistedInterfaceSpecSourceMode,
  resolveInterfaceSpecRuntimeSourceMode,
  scopeToolCapabilitiesForInterfaceSpecMode,
} from '../src/interface-spec-runtime-policy.js';
import { CHAT_TOOL_ENDPOINTS, CHAT_TOOL_OPERATIONS, ToolTokenRegistry } from '../src/tool-tokens.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('interface-spec runtime source policy', () => {
  const base = {
    projectKind: 'interface-spec',
    generationRequested: false,
    sourceIntent: 'unspecified' as const,
    hasSelectedSource: false,
    collectionReset: false,
  };

  it('persists manual mode through source-mode and manual-draft form turns', () => {
    expect(resolveInterfaceSpecRuntimeSourceMode({
      ...base,
      currentPrompt: '코드베이스 없이 주문 API 인터페이스 명세서를 만들어줘',
      generationRequested: true,
      sourceIntent: 'manual',
    })).toBe('manual');
    expect(resolveInterfaceSpecRuntimeSourceMode({
      ...base,
      currentPrompt: '[form answers — interface-spec-source-mode]\n- sourceMode: 코드베이스 없이 신규 작성 [value: manual]',
    })).toBe('manual');
    expect(resolveInterfaceSpecRuntimeSourceMode({
      ...base,
      currentPrompt: '[form answers - interface-spec-manual-draft]\n- reviewStage: intake',
      previousMode: 'codebase',
    })).toBe('manual');
  });

  it('lets an explicit codebase reset override a previously manual document', () => {
    expect(resolveInterfaceSpecRuntimeSourceMode({
      ...base,
      currentPrompt: '이 코드베이스를 읽어서 인터페이스 명세서를 만들어줘',
      generationRequested: true,
      sourceIntent: 'codebase',
      hasSelectedSource: true,
      previousMode: 'manual',
      persistedMode: 'manual',
    })).toBe('codebase');
    expect(resolveInterfaceSpecRuntimeSourceMode({
      ...base,
      currentPrompt: '[form answers — interface-spec-options]\n- scope: all',
      previousMode: 'manual',
    })).toBe('codebase');
  });

  it('does not change database behavior for non-interface-spec projects', () => {
    const mode = resolveInterfaceSpecRuntimeSourceMode({
      ...base,
      projectKind: 'software-development',
      currentPrompt: 'manual',
      generationRequested: true,
      sourceIntent: 'manual',
    });
    expect(mode).toBeNull();
    expect(interfaceSpecDatabaseAccessAllowed({
      projectKind: 'software-development',
      mode,
      sourceValidated: false,
      optionsAnswered: false,
      databaseSampleRequested: false,
    })).toBe(true);
    expect(scopeToolCapabilitiesForInterfaceSpecMode(
      true,
      CHAT_TOOL_ENDPOINTS,
      CHAT_TOOL_OPERATIONS,
    )).toEqual({
      allowedEndpoints: [...CHAT_TOOL_ENDPOINTS],
      allowedOperations: [...CHAT_TOOL_OPERATIONS],
    });
  });

  it('removes DB capabilities from manual grants so route validation hard-denies execution', () => {
    const scoped = scopeToolCapabilitiesForInterfaceSpecMode(
      false,
      CHAT_TOOL_ENDPOINTS,
      CHAT_TOOL_OPERATIONS,
    );
    expect(interfaceSpecDatabaseAccessAllowed({
      projectKind: 'interface-spec',
      mode: 'manual',
      sourceValidated: true,
      optionsAnswered: true,
      databaseSampleRequested: true,
    })).toBe(false);
    expect(scoped.allowedEndpoints).not.toContain('/api/database/read');
    expect(scoped.allowedEndpoints).not.toContain('/api/database/mutations');
    expect(scoped.allowedOperations).not.toContain('database:read');
    expect(scoped.allowedOperations).not.toContain('database:mutate');
    expect(scoped.allowedEndpoints).toContain('/api/tools/live-artifacts/create');

    const registry = new ToolTokenRegistry();
    const grant = registry.mint({
      runId: 'manual-run',
      projectId: 'manual-project',
      ...scoped,
    });
    expect(registry.validate(grant.token, {
      endpoint: '/api/database/read',
      operation: 'database:read',
    })).toMatchObject({ ok: false, code: 'TOOL_ENDPOINT_DENIED' });
    expect(registry.validate(grant.token, {
      endpoint: '/api/tools/live-artifacts/create',
      operation: 'live-artifacts:create',
    })).toMatchObject({ ok: true });
    registry.clear();
  });

  it('hard-denies DB capability until codebase source preflight and options are both complete', () => {
    const optionsPrompt = '[form answers — interface-spec-options]\n- scope: all\n- 요청/응답 예시 보정 방식: 승인된 DB 샘플 보정 [value: database-sample]';
    expect(isInterfaceSpecFormAnswer(optionsPrompt, 'interface-spec-options')).toBe(true);
    expect(isInterfaceSpecDatabaseSampleAnswer(optionsPrompt)).toBe(true);
    expect(isInterfaceSpecDatabaseSampleAnswer(
      '[form answers — interface-spec-options]\n- example mode: Static analysis [value: static-analysis]',
    )).toBe(false);
    for (const candidate of [
      { mode: null, sourceValidated: false, optionsAnswered: false, databaseSampleRequested: false },
      { mode: 'codebase' as const, sourceValidated: false, optionsAnswered: true, databaseSampleRequested: true },
      { mode: 'codebase' as const, sourceValidated: true, optionsAnswered: false, databaseSampleRequested: true },
      { mode: 'codebase' as const, sourceValidated: true, optionsAnswered: true, databaseSampleRequested: false },
      { mode: 'manual' as const, sourceValidated: true, optionsAnswered: true, databaseSampleRequested: true },
    ]) {
      expect(interfaceSpecDatabaseAccessAllowed({
        projectKind: 'interface-spec',
        ...candidate,
      })).toBe(false);
    }
    expect(interfaceSpecDatabaseAccessAllowed({
      projectKind: 'interface-spec',
      mode: 'codebase',
      sourceValidated: true,
      optionsAnswered: true,
      databaseSampleRequested: true,
    })).toBe(true);
  });

  it('reads the persisted canonical source mode without parsing endpoint payloads', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'monofield-interface-mode-'));
    tempDirs.push(dir);
    await writeFile(path.join(dir, 'interface-spec.json'), JSON.stringify({
      schemaVersion: 1,
      kind: 'interface-spec',
      source: { mode: 'manual' },
      endpoints: [{ responseExample: 'x'.repeat(200_000) }],
    }), 'utf8');

    await expect(readPersistedInterfaceSpecSourceMode(dir)).resolves.toBe('manual');
  });
});
