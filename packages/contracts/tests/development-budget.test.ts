import { expect, it } from 'vitest';
import { composeSystemPrompt } from '../src/prompts/system.js';

it('omits design discovery in development without dropping selected skill or user instructions', () => {
  const common = { sessionMode: 'docs' as const, skillBody: 'SELECTED_SKILL', userInstructions: 'USER_RULE' };
  const design = composeSystemPrompt({ ...common, metadata: { kind: 'prototype' } });
  const development = composeSystemPrompt({ ...common, metadata: { kind: 'prototype', workMode: 'development' } });
  expect(development.length).toBeLessThan(design.length / 2);
  expect(development).not.toContain('# Identity and workflow charter');
  expect(development).toContain('SELECTED_SKILL');
  expect(development).toContain('USER_RULE');
});
