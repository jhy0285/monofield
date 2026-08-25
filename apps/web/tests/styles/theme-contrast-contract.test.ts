import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const webSrcRoot = fileURLToPath(new URL('../../src/', import.meta.url));
const componentsSrcRoot = fileURLToPath(
  new URL('../../../../packages/components/src/', import.meta.url),
);
const tokensCss = readFileSync(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8');
const primitivesCss = readFileSync(
  new URL('../../src/styles/primitives.css', import.meta.url),
  'utf8',
);
const chatCss = readFileSync(new URL('../../src/styles/chat.css', import.meta.url), 'utf8');
const routinesCss = readFileSync(
  new URL('../../src/styles/viewer/routines.css', import.meta.url),
  'utf8',
);
const artifactsCss = readFileSync(
  new URL('../../src/styles/workspace/artifacts.css', import.meta.url),
  'utf8',
);
const mentionHomeCss = readFileSync(
  new URL('../../src/styles/workspace/mention-home.css', import.meta.url),
  'utf8',
);
const homeHeroCss = readFileSync(
  new URL('../../src/styles/home/home-hero.css', import.meta.url),
  'utf8',
);
const librarySectionCss = readFileSync(
  new URL('../../src/components/LibrarySection.module.css', import.meta.url),
  'utf8',
);
const memoryCss = readFileSync(
  new URL('../../src/styles/viewer/memory.css', import.meta.url),
  'utf8',
);
const designFilesCss = readFileSync(
  new URL('../../src/styles/workspace/design-files.css', import.meta.url),
  'utf8',
);
const shellCss = readFileSync(new URL('../../src/styles/shell.css', import.meta.url), 'utf8');
const connectorsCss = readFileSync(
  new URL('../../src/styles/workspace/connectors.css', import.meta.url),
  'utf8',
);
const libraryCss = readFileSync(
  new URL('../../src/styles/viewer/library.css', import.meta.url),
  'utf8',
);

function cssFilesUnder(root: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) files.push(...cssFilesUnder(path));
    else if (path.endsWith('.css')) files.push(path);
  }
  return files;
}

function ruleBodies(css: string): Array<{ selector: string; body: string }> {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: (match[1] ?? '').trim(),
    body: match[2] ?? '',
  }));
}

describe('light and dark interaction contrast contract', () => {
  it('defines discoverable control surfaces and a dedicated focus color in both themes', () => {
    expect(tokensCss.match(/--control-border:\s*#686868/g)).toHaveLength(2);
    expect(tokensCss.match(/--control-pressed:\s*#3a3a3a/g)).toHaveLength(2);
    expect(tokensCss.match(/--focus-ring:\s*#7698fd/g)).toHaveLength(2);
    expect(tokensCss.match(/--accent-contrast:\s*#111111/g)).toHaveLength(2);
    expect(tokensCss.match(/--selected-contrast:\s*#111111/g)).toHaveLength(2);
    expect(tokensCss).toMatch(/--bg-hover:\s*var\(--control-hover\)/);
    expect(tokensCss).toMatch(/--text-default:\s*var\(--text\)/);
  });

  it('keeps shared buttons readable through pressed, focused, and disabled states', () => {
    expect(primitivesCss).toMatch(/button\.primary[\s\S]*?color:\s*var\(--accent-contrast\)/);
    expect(primitivesCss).toMatch(/button\.primary:active[\s\S]*?var\(--accent-pressed\)/);
    expect(primitivesCss).toMatch(/button:focus-visible[\s\S]*?var\(--focus-ring\)/);
    expect(primitivesCss).toMatch(/button:disabled[\s\S]*?var\(--control-disabled-text\)/);
  });

  it('does not paint literal white text over theme-inverted neutral fills', () => {
    const violations: string[] = [];
    for (const path of [...cssFilesUnder(webSrcRoot), ...cssFilesUnder(componentsSrcRoot)]) {
      const css = readFileSync(path, 'utf8');
      for (const { selector, body } of ruleBodies(css)) {
        const hasInvertedNeutralFill =
          /background(?:-color)?\s*:[^;]*var\(--(?:accent|selected|text-strong|text)\b/.test(body);
        const hasLiteralWhiteForeground =
          /(?:^|[;\s])color\s*:\s*(?:white|#fff(?:fff)?)\b/i.test(body);
        if (hasInvertedNeutralFill && hasLiteralWhiteForeground) {
          violations.push(`${path}: ${selector}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('protects the high-risk chat and settings states that previously disappeared', () => {
    expect(chatCss).toMatch(/\.composer-send\s*\{[\s\S]*?color:\s*var\(--accent-contrast\)/);
    expect(chatCss).toMatch(/\.composer-send:disabled\s*\{[\s\S]*?var\(--control-disabled-text\)/);
    expect(routinesCss).toMatch(
      /\.app \.msg\.user \.user-text\s*\{[\s\S]*?color:\s*var\(--selected-contrast\)/,
    );
    expect(artifactsCss).toMatch(
      /\.settings-section-byok \.settings-test-btn[\s\S]*?color:\s*var\(--selected-contrast\)/,
    );
    expect(mentionHomeCss).toMatch(
      /\.protocol-chip\.active\s*\{[\s\S]*?color:\s*var\(--selected-contrast\)/,
    );
    expect(homeHeroCss).toMatch(
      /\.home-hero__footer-switch\.is-on i::after\s*\{[\s\S]*?background:\s*var\(--accent-contrast\)/,
    );
    expect(librarySectionCss).toMatch(
      /\.selectCheck\[data-checked='true'\]\s*\{[\s\S]*?color:\s*var\(--selected-contrast\)/,
    );
    expect(memoryCss).toMatch(
      /input:checked \+ \.toggle-slider::before\s*\{[\s\S]*?var\(--accent-contrast\)/,
    );
    expect(designFilesCss).toMatch(
      /\.df-row\.selected \.df-row-check\s*\{\s*color:\s*var\(--blue-contrast\)/,
    );
  });

  it('uses the focus token instead of an inverted action fill for focus outlines', () => {
    const legacyFocusOutlines: string[] = [];
    for (const path of [...cssFilesUnder(webSrcRoot), ...cssFilesUnder(componentsSrcRoot)]) {
      const css = readFileSync(path, 'utf8');
      if (/outline:\s*2px solid var\(--(?:accent|selected)\)/.test(css)) {
        legacyFocusOutlines.push(path);
      }
    }
    expect(legacyFocusOutlines).toEqual([]);
  });

  it('keeps high-risk custom controls visibly focused instead of suppressing their ring', () => {
    expect(shellCss).toMatch(
      /\.viewer-toolbar-zoom \.zoom-trigger:focus-visible\s*\{[\s\S]*?var\(--focus-ring\)/,
    );
    expect(shellCss).toMatch(/\.avatar-btn:focus-visible\s*\{[\s\S]*?var\(--focus-ring\)/);
    expect(connectorsCss).toMatch(
      /\.connectors-provider-tab:focus-visible\s*\{[\s\S]*?var\(--focus-ring\)/,
    );
    expect(libraryCss).toMatch(
      /\.library-ds-card-content:focus-visible\s*\{[\s\S]*?var\(--focus-ring\)/,
    );
    expect(homeHeroCss).toMatch(
      /\.home-hero__type-tab:focus-visible\s*\{[\s\S]*?var\(--focus-ring\)/,
    );
  });
});
