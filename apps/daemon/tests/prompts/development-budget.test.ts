import { expect, it } from 'vitest';
import { composeSystemPrompt } from '../../src/prompts/system.js';

it('keeps development concise even in docs sessions, preserving explicit instructions', () => {
  const common = {
    sessionMode: 'docs' as const, streamFormat: 'json' as const,
    skillBody: 'SELECTED_SKILL', pluginBlock: 'SELECTED_PLUGIN',
    userInstructions: 'USER_RULE', projectInstructions: 'PROJECT_RULE',
  };
  const design = composeSystemPrompt({ ...common, metadata: { kind: 'prototype' } });
  const development = composeSystemPrompt({ ...common, metadata: { kind: 'prototype', workMode: 'development' } });
  expect(development.length).toBeLessThan(design.length / 2);
  expect(development).not.toContain('# Identity and workflow charter');
  for (const instruction of ['SELECTED_SKILL', 'SELECTED_PLUGIN', 'USER_RULE', 'PROJECT_RULE']) {
    expect(development).toContain(instruction);
  }
});
