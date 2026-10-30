import { describe, expect, it } from 'vitest';
import { readExpandedIndexCss } from '../helpers/read-expanded-css';

const indexCss = readExpandedIndexCss();

function cssBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(indexCss);
  if (!match) throw new Error(`Missing CSS block for ${selector}`);
  return match[1] ?? '';
}

describe('default app background colors', () => {
  it('uses the MonoField light background color by default', () => {
    const root = cssBlock(':root');

    expect(root).toContain('--bg: #f7f7f5;');
    expect(root).toContain('--bg-app: #f7f7f5;');
  });

  it('uses the MonoField dark background color', () => {
    // The dark palette is shared with the cyberpunk theme: one rule block whose
    // selector list ends in the cyberpunk attribute.
    const dark = cssBlock('[data-theme="dark"],\n[data-theme="cyberpunk"]');

    expect(dark).toContain('--bg: #0b0b0c;');
    expect(dark).toContain('--bg-app: #0b0b0c;');
  });

  it('prefers platform UI fonts over optional local app fonts', () => {
    const root = cssBlock(':root');
    const sans = /--sans:\s*([^;]+);/.exec(root)?.[1];

    expect(sans).toBeDefined();
    expect(sans).toContain("'Segoe UI'");
    expect(sans).not.toContain("'Inter'");
    expect(sans).toMatch(/'Segoe UI', 'Microsoft YaHei UI', 'Noto Sans'/);
  });
});
