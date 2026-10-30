// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider } from '../../src/i18n';
import { AgentSupportTag } from '../../src/components/AgentSupportTag';
import { isCommunityAgent } from '../../src/lib/agent-support';

beforeEach(() => {
  localStorage.setItem('open-design:locale', 'en');
});
afterEach(cleanup);

describe('isCommunityAgent', () => {
  // README "Runtime capability boundary": Codex CLI and Claude Code are the
  // documented, verified engines; every other detected CLI is the community's.
  it('treats only Codex and Claude Code as verified', () => {
    expect(isCommunityAgent('codex')).toBe(false);
    expect(isCommunityAgent('claude')).toBe(false);
    for (const id of ['gemini', 'opencode', 'cursor-agent', 'qwen', 'devin', 'kimi', 'hermes']) {
      expect(isCommunityAgent(id)).toBe(true);
    }
  });

  it('does not label the hosted router as a community adapter', () => {
    expect(isCommunityAgent('amr')).toBe(false);
  });

  it('has no opinion about a missing id', () => {
    expect(isCommunityAgent(null)).toBe(false);
    expect(isCommunityAgent(undefined)).toBe(false);
    expect(isCommunityAgent('')).toBe(false);
  });
});

describe('AgentSupportTag', () => {
  it('marks a community adapter and explains what that means', () => {
    render(<I18nProvider><AgentSupportTag id="gemini" /></I18nProvider>);
    const tag = screen.getByText('Community');
    expect(tag.getAttribute('title')).toContain('not verified by MonoField');
    expect(tag.getAttribute('title')).toContain('Codex CLI and Claude Code');
  });

  it('renders nothing for a verified runtime', () => {
    const { container } = render(<I18nProvider><AgentSupportTag id="codex" /></I18nProvider>);
    expect(container.textContent).toBe('');
  });
});
