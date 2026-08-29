import { describe, expect, it } from 'vitest';

import { composeSystemPrompt } from '../src/prompts/system.js';

describe('structured specification prompt budget', () => {
  it.each(['interface-spec', 'screen-spec'] as const)(
    'keeps %s BYOK prompts task-scoped',
    (kind) => {
      const generic = composeSystemPrompt({ sessionMode: 'docs', locale: 'ko' });
      const scoped = composeSystemPrompt({
        sessionMode: 'docs',
        locale: 'ko',
        metadata: { kind },
        skillName: kind === 'interface-spec' ? 'Interface Spec' : 'Screen Spec',
        skillBody: '# Deterministic collector\n\nFollow the structured source workflow.',
      });

      expect(scoped).toContain('# Structured specification workflow');
      expect(scoped).toContain('## Active skill');
      expect(scoped).not.toContain('# Identity and workflow charter (background)');
      expect(scoped.length).toBeLessThan(generic.length - 35_000);
    },
  );

  it('keeps BYOK guidance prompts stable and excludes artifact-only payloads', () => {
    const input = {
      sessionMode: 'docs' as const,
      locale: 'ko',
      metadata: { kind: 'interface-spec' as const },
      skillName: 'Interface Spec',
      skillBody: `# Collector\n\n${'artifact-only-rule\n'.repeat(4_000)}`,
      designSystemBody: 'design-only-rule\n'.repeat(1_000),
      pluginBlock: 'plugin-only-rule\n'.repeat(1_000),
      activeStageBlocks: ['stage-only-rule\n'.repeat(1_000)],
    };
    const guidance = composeSystemPrompt({
      ...input,
      structuredArtifactInstructions: false,
    });
    const artifact = composeSystemPrompt({
      ...input,
      structuredArtifactInstructions: true,
    });

    expect(guidance).toBe(composeSystemPrompt({
      ...input,
      structuredArtifactInstructions: false,
    }));
    expect(guidance).not.toContain('artifact-only-rule');
    expect(guidance).not.toContain('design-only-rule');
    expect(guidance).not.toContain('plugin-only-rule');
    expect(guidance).not.toContain('stage-only-rule');
    expect(artifact).toContain('artifact-only-rule');
    expect(artifact.length - guidance.length).toBeGreaterThan(70_000);
    expect(guidance.length).toBeLessThan(10_000);
  });
});
