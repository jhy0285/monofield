import { describe, expect, it } from 'vitest';

import { composeSystemPrompt } from '../../src/prompts/system.js';

describe('structured specification prompt budget', () => {
  it('requires direct grounding for time-sensitive high-stakes document facts', () => {
    const prompt = composeSystemPrompt({ sessionMode: 'docs', locale: 'ko' });

    expect(prompt).toContain('never invent current values, dates, events, citations, or recommendations');
    expect(prompt).toContain('direct source URL and an as-of time');
    expect(prompt).toContain('unknown/unverified placeholders');
  });

  it.each(['interface-spec', 'screen-spec'] as const)(
    'keeps %s workflows task-scoped instead of loading the generic design charter',
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

  it.each(['interface-spec', 'screen-spec'] as const)(
    'lazy-loads %s artifact instructions for guidance turns with a stable fingerprint',
    (kind) => {
      const largeSkillBody = `# Deterministic collector\n\n${'artifact-only-rule\n'.repeat(4_000)}`;
      const base = {
        sessionMode: 'docs' as const,
        locale: 'ko',
        metadata: { kind },
        skillName: kind === 'interface-spec' ? 'Interface Spec' : 'Screen Spec',
        skillBody: largeSkillBody,
        designSystemBody: 'design-only-rule\n'.repeat(1_000),
        pluginBlock: 'plugin-only-rule\n'.repeat(1_000),
        activeStageBlocks: ['stage-only-rule\n'.repeat(1_000)],
      };
      const guidance = composeSystemPrompt({
        ...base,
        structuredArtifactInstructions: false,
      });
      const repeatedGuidance = composeSystemPrompt({
        ...base,
        structuredArtifactInstructions: false,
      });
      const artifact = composeSystemPrompt({
        ...base,
        structuredArtifactInstructions: true,
      });

      expect(guidance).toBe(repeatedGuidance);
      expect(guidance).toContain('# Docs mode');
      expect(guidance).toContain('# Structured specification workflow');
      expect(guidance).not.toContain('artifact-only-rule');
      expect(guidance).not.toContain('design-only-rule');
      expect(guidance).not.toContain('plugin-only-rule');
      expect(guidance).not.toContain('stage-only-rule');
      expect(artifact).toContain('artifact-only-rule');
      expect(artifact.length - guidance.length).toBeGreaterThan(70_000);
      expect(guidance.length).toBeLessThan(12_000);
    },
  );
});
