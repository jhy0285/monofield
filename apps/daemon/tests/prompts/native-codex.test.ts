import { describe, expect, it } from 'vitest';
import { canSkipNativeCodexInstructions, nativeCodexUserRequest } from '../../src/prompts/native-codex.js';
import { composeSystemPrompt } from '../../src/prompts/system.js';

describe('native Codex context preservation', () => {
  const native = { agentId: 'codex', sessionMode: 'chat' as const, streamFormat: 'json-event-stream' };
  it('does not remove seeded history or text merely containing a user marker', () => {
    const history = '## user\nFirst request\n\n## assistant\nPrior answer\n\n## user\nNext request';
    expect(nativeCodexUserRequest(history, 'Next request')).toBe(history);
    expect(nativeCodexUserRequest('## user\nNext request', 'Next request')).toBe('Next request');
    expect(nativeCodexUserRequest('## user\nDifferent text', 'Next request')).toBe('## user\nDifferent text');
  });
  it.each([
    { memoryBody: 'Keep Korean terminology and never send customer data.' },
    { userInstructions: 'Do not change public API signatures.' },
    { projectInstructions: 'All document fields require code evidence.' },
    { skillBody: '# Selected workflow\nPreserve approved edits.' },
    { pluginBlock: '## Approved plugin\nCollect sources.' },
    { activeStageBlocks: ['## Selected stage\nReview evidence.'] },
    { metadata: { kind: 'interface-spec' as const } },
    { metadata: { databaseContext: { connectionId: 'db-1' } } },
  ])('preserves selected context %j', (extra) => {
    expect(canSkipNativeCodexInstructions({ ...native, ...extra })).toBe(false);
    expect(composeSystemPrompt({ ...native, ...extra })).not.toBe('');
  });
  it('keeps API and tool-free recovery profiles out of the native fast path', () => {
    expect(canSkipNativeCodexInstructions({ ...native, streamFormat: 'plain' })).toBe(false);
    expect(canSkipNativeCodexInstructions({ ...native, executionProfile: 'text_artifact' })).toBe(false);
  });
  it('keeps every memory fact while omitting artifact-only memory coaching from chat', () => {
    const memory = 'Use Korean terminology.\nDo not send customer data.\nPublic API signatures must stay unchanged.\nNever discard approved document edits.';
    const withMemory = composeSystemPrompt({ ...native, memoryBody: memory });
    const assistedBase = composeSystemPrompt({ ...native, projectInstructions: 'selected' });
    expect(withMemory).toContain(memory);
    expect(withMemory).toContain('The current user request takes precedence');
    expect(withMemory).not.toContain('Expanding intent this way');
    expect(withMemory).not.toContain('auto_rewrite_gate');
    expect(withMemory.length - assistedBase.length - memory.length).toBeLessThan(400);
  });
});
