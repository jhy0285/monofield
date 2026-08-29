import { describe, expect, it } from 'vitest';
import { claudeAgentDef } from '../src/runtimes/defs/claude.js';

const MODELS = [
  'default',
  'claude-opus-5',
  'claude-mythos-5',
  'claude-fable-5',
  'claude-sonnet-5',
  'claude-opus-4-8',
  'claude-haiku-4-5-20251001',
  'opus',
  'sonnet',
  'haiku',
];

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

function build(model: string, reasoning?: string): string[] {
  return claudeAgentDef.buildArgs('prompt', [], [], { model, reasoning }, {});
}

describe('claude buildArgs --effort wiring', () => {
  it('keeps current fixed ids plus moving aliases in the static fallback catalog', () => {
    const ids = claudeAgentDef.fallbackModels.map((model) => model.id);
    expect(ids.slice(0, 6)).toEqual([
      'default',
      'claude-opus-5',
      'claude-mythos-5',
      'claude-fable-5',
      'claude-sonnet-5',
      'claude-opus-4-8',
    ]);
    expect(ids).toEqual(expect.arrayContaining(['opus', 'sonnet', 'haiku']));
  });

  it('declares the five CLI effort levels plus default', () => {
    const ids = (claudeAgentDef.reasoningOptions ?? []).map((o) => o.id);
    expect(ids).toEqual(['default', 'low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('passes --effort for every effort level on every configured model', () => {
    for (const model of MODELS) {
      for (const effort of EFFORTS) {
        const args = build(model, effort);
        const idx = args.indexOf('--effort');
        expect(idx, `${model} / ${effort}`).toBeGreaterThanOrEqual(0);
        expect(args[idx + 1], `${model} / ${effort}`).toBe(effort);
        // Model flag still correct (or omitted for default).
        if (model === 'default') {
          expect(args).not.toContain('--model');
        } else {
          expect(args[args.indexOf('--model') + 1]).toBe(model);
        }
      }
    }
  });

  it('omits --effort when reasoning is default/absent/invalid', () => {
    for (const reasoning of ['default', undefined, 'ultra', ''] as const) {
      const args = build('claude-opus-4-8', reasoning);
      expect(args, String(reasoning)).not.toContain('--effort');
    }
  });

  it('keeps --effort compatible with the stream-json invocation', () => {
    const args = build('claude-sonnet-5', 'high');
    expect(args.slice(0, 6)).toEqual([
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
    ]);
    expect(args).toContain('--permission-mode');
  });
});
