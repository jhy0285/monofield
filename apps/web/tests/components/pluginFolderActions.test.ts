// Contract test for the prompts the plugin-folder card buttons send to the
// agent. `install` uses the simple shared template; `contribute` drives the
// `gh repo fork → branch → commit → gh pr create --web` flow against
// the MonoField repository; `publish` drives `gh repo create / push` against the
// author's own `plugin.repo` URL. The tests below lock the *shape* of each
// prompt (keywords + folder interpolation) without coupling to exact wording,
// so prose tweaks don't break the suite but accidental removal of a critical
// step would.

import { describe, expect, it } from 'vitest';
import { buildPluginFolderAgentActionPrompt } from '../../src/components/design-files/pluginFolderActions';

const FOLDER = 'generated-plugin';

describe('buildPluginFolderAgentActionPrompt', () => {
  describe('install', () => {
    it('mentions the folder path and the supported install CLI', () => {
      const prompt = buildPluginFolderAgentActionPrompt(FOLDER, 'install');
      expect(prompt).toContain(`Plugin folder: \`${FOLDER}\``);
      expect(prompt).toContain('monofield plugin install --source');
      expect(prompt).toContain(`${FOLDER}/monofield.json`);
    });
  });

  describe('publish (repo-publish flow)', () => {
    const prompt = buildPluginFolderAgentActionPrompt(FOLDER, 'publish');

    it('delegates repo publishing to the deterministic plugin CLI helper', () => {
      expect(prompt).toContain(`Plugin folder: \`${FOLDER}\``);
      expect(prompt).toContain(`"$MONOFIELD_NODE_BIN" "$MONOFIELD_BIN" plugin publish-repo ${FOLDER}`);
      expect(prompt).toMatch(/current gh login|target is not hard-coded/i);
    });

    it('states the CLI-owned responsibilities instead of re-listing shell steps', () => {
      expect(prompt).toContain('gh api user --jq .login');
      expect(prompt).toContain('--owner');
      expect(prompt).toMatch(/last-resort fallback/i);
      expect(prompt).toMatch(/placeholder owners are rejected/i);
      expect(prompt).toMatch(/manifest repo normalization/i);
      expect(prompt).toMatch(/repo existence check/i);
      expect(prompt).toMatch(/repo create\/update/i);
      expect(prompt).toMatch(/final verification/i);
    });

    it('bans the registry-submission CLI explicitly', () => {
      // The legacy CLI is what shipped the bug — without an explicit ban
      // the agent had been routing back to it. The mention must be in a
      // negative imperative ("Do NOT call …"), not a recommendation.
      expect(prompt).toMatch(
        /Do NOT (call|route through) `?monofield plugin publish --to <catalog>`?/i,
      );
      expect(prompt).toMatch(
        /registry[- ]submission|registry-submission flow|MonoField PR/i,
      );
    });

    it('hard-bans mid-turn clarification + auto-install + force-push + retry', () => {
      expect(prompt).toContain('<question-form>');
      expect(prompt).toMatch(/fire-and-forget|clarification UI that waits/i);
      expect(prompt).toMatch(/do not try to install/i);
      expect(prompt).toMatch(/do not force-push|--force/i);
      expect(prompt).toMatch(/do not retry/i);
    });

    it('interpolates the actual folder path into the CLI command', () => {
      // Sanity check that template-string interpolation didn't regress into
      // literal `${folderPath}` substrings.
      expect(prompt).toContain(`plugin publish-repo ${FOLDER}`);
      expect(prompt).not.toContain('${folderPath}');
    });

    it('ends by handing the repo URL back to chat', () => {
      expect(prompt).toMatch(/final repo URL printed by the CLI/i);
    });
  });

  describe('contribute (PR-based flow)', () => {
    const prompt = buildPluginFolderAgentActionPrompt(FOLDER, 'contribute');

    it('delegates MonoField PR creation to the deterministic plugin CLI helper', () => {
      expect(prompt).toContain('jhy0285/monofield');
      expect(prompt).toContain(`"$MONOFIELD_NODE_BIN" "$MONOFIELD_BIN" plugin monofield-pr ${FOLDER}`);
    });

    it('states the CLI-owned PR workflow instead of re-listing shell steps', () => {
      expect(prompt).toContain('gh api user --jq .login');
      expect(prompt).toContain('--owner');
      expect(prompt).toMatch(/last-resort fallback/i);
      expect(prompt).toMatch(/fork\/clone\/copy\/branch\/push/i);
      expect(prompt).toContain('gh pr create --web');
      expect(prompt).toMatch(/do not call the legacy catalog-link command/i);
    });

    it('uses --web so the author confirms the PR in browser', () => {
      // The "author keeps the final review click" invariant — preserved from
      // 45f52d71's "We never POST anywhere" principle.
      expect(prompt).toContain('--web');
      expect(prompt).toMatch(/do not auto-submit/i);
    });

    it('hard-bans mid-turn clarification forms to avoid 600s stalls', () => {
      // Regression guard for the stall we observed during e2e: agent paused
      // mid-turn on a clarification waiting for a host answer the user never
      // sent (they clicked the plugin-folder card instead).
      expect(prompt).toContain('<question-form>');
      expect(prompt).toMatch(/clarification UI that waits|fire-and-forget/i);
    });

    it('forbids the agent from installing tools or retrying failures', () => {
      expect(prompt).toMatch(/do not try to install/i);
      expect(prompt).toMatch(/do not retry/i);
    });

    it('interpolates the actual folder path into manifest and copy steps', () => {
      // Sanity check that template-string interpolation didn't regress into
      // literal `${folderPath}` substrings (we already shipped that bug once).
      expect(prompt).toContain(`plugin monofield-pr ${FOLDER}`);
      expect(prompt).not.toContain('${folderPath}');
    });

    it('ends by handing the PR URL back to chat', () => {
      expect(prompt).toMatch(/PR URL|pull\/new|paste it into chat/);
    });
  });
});
