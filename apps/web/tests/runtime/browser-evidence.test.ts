import { describe, expect, it, vi } from 'vitest';

import {
  READ_ONLY_BROWSER_EVIDENCE_SCRIPT,
  browserEvidencePromptExcerpt,
  collectReadOnlyBrowserEvidence,
  isReadOnlyBrowserEvidenceAction,
  redactBrowserEvidenceText,
  sanitizeBrowserEvidenceUrl,
} from '../../src/runtime/browser-evidence';

describe('read-only in-app browser evidence bridge', () => {
  it('accepts only the explicitly allowlisted read-only action ids', () => {
    expect(isReadOnlyBrowserEvidenceAction('list_images')).toBe(true);
    expect(isReadOnlyBrowserEvidenceAction('extract_colors')).toBe(true);
    expect(isReadOnlyBrowserEvidenceAction('click')).toBe(false);
    expect(isReadOnlyBrowserEvidenceAction('type_text')).toBe(false);
    expect(isReadOnlyBrowserEvidenceAction('navigate')).toBe(false);
    expect(isReadOnlyBrowserEvidenceAction('terminal_run')).toBe(false);
  });

  it('keeps the guest collector free of storage, network, and mutation APIs', () => {
    expect(READ_ONLY_BROWSER_EVIDENCE_SCRIPT).not.toMatch(/document\.cookie|localStorage|sessionStorage/i);
    expect(READ_ONLY_BROWSER_EVIDENCE_SCRIPT).not.toMatch(/fetch\(|XMLHttpRequest|navigator\.sendBeacon/i);
    expect(READ_ONLY_BROWSER_EVIDENCE_SCRIPT).not.toMatch(/\.click\(|\.focus\(|\.value\s*=|location\s*=/i);
  });

  it('removes URL query data and redacts credential-shaped text', () => {
    expect(sanitizeBrowserEvidenceUrl('https://user:pass@example.com/path?access_token=top-secret#fragment'))
      .toBe('https://example.com/path');
    expect(redactBrowserEvidenceText('Authorization: Bearer abcdefghijklmnopqrstuvwxyz')).toContain('[REDACTED]');
    expect(redactBrowserEvidenceText('apiKey=very-secret-value')).toContain('[REDACTED]');
  });

  it('validates, bounds, and scopes a collector result before it reaches the chat', async () => {
    const executeJavaScript = vi.fn(async () => ({
      assets: {
        images: Array.from({ length: 150 }, (_, index) => ({ src: `https://example.com/${index}.png` })),
        logoCandidates: [{ src: 'https://example.com/logo.png' }],
        svgs: { inlineCount: 1, linkedUrls: [] },
      },
      pageInfo: { title: 'Example', url: 'https://example.com/?token=redacted' },
      snapshot: [{ label: 'Ignored for this operation' }],
      styles: { colors: [{ value: 'rgb(1, 2, 3)', count: 1 }] },
    }));

    const result = await collectReadOnlyBrowserEvidence('list_images', {
      executeJavaScript,
      getTitle: () => 'Example',
      getURL: () => 'https://example.com/?access_token=should-not-cross',
      isDesktopWebview: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(executeJavaScript).toHaveBeenCalledWith(READ_ONLY_BROWSER_EVIDENCE_SCRIPT);
    expect(result.document.evidence).toHaveProperty('assets');
    expect(result.document.evidence).not.toHaveProperty('snapshot');
    expect(result.document.tab.url).toBe('https://example.com/');
    expect(browserEvidencePromptExcerpt(result.document, 80)).toContain('Evidence truncated in chat');
  });

  it('fails closed for a non-desktop target and for side-effecting actions', async () => {
    const target = {
      executeJavaScript: vi.fn(),
      getURL: () => 'https://example.com/',
      isDesktopWebview: false,
    };
    await expect(collectReadOnlyBrowserEvidence('snapshot', target)).resolves.toMatchObject({ ok: false });
    await expect(collectReadOnlyBrowserEvidence('click', { ...target, isDesktopWebview: true })).resolves.toMatchObject({ ok: false });
    expect(target.executeJavaScript).not.toHaveBeenCalled();
  });
});
