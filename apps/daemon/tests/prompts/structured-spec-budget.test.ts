import { describe, expect, it } from 'vitest';

import { composeSystemPrompt } from '../../src/prompts/system.js';

describe('structured specification prompt budget', () => {
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
});
