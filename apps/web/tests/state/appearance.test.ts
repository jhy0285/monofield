// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_ACCENT_COLOR,
  accentContrastRatio,
  applyAppearanceToDocument,
  buildAccentPalette,
  normalizeAccentColor,
  resolveAccentColor,
} from '../../src/state/appearance';

describe('normalizeAccentColor', () => {
  it('accepts six-digit hex colors and normalizes casing', () => {
    expect(normalizeAccentColor('  #4F46E5  ')).toBe('#4f46e5');
  });

  it('rejects invalid accent colors', () => {
    expect(normalizeAccentColor('blue')).toBeNull();
    expect(normalizeAccentColor('#123')).toBeNull();
    expect(normalizeAccentColor('#12345g')).toBeNull();
  });
});

describe('resolveAccentColor', () => {
  it('falls back to the first appearance color for missing or invalid values', () => {
    expect(resolveAccentColor(undefined)).toBe(DEFAULT_ACCENT_COLOR);
    expect(resolveAccentColor('blue')).toBe(DEFAULT_ACCENT_COLOR);
  });
});

describe('applyAppearanceToDocument', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('style');
  });

  it('applies the saved dark theme and a readable semantic accent palette', () => {
    applyAppearanceToDocument({ theme: 'dark', accentColor: '#4F46E5' });

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    const accent = document.documentElement.style.getPropertyValue('--accent');
    expect(accent).not.toBe('');
    expect(accentContrastRatio(accent, '#161616')).toBeGreaterThanOrEqual(4.5);
    expect(document.documentElement.style.getPropertyValue('--selected')).toBe(accent);
    expect(document.documentElement.style.getPropertyValue('--focus-ring')).toBe(accent);
  });

  it('does not apply appearance colors to global background variables', () => {
    document.documentElement.style.setProperty('--bg', '#faf9f7');
    document.documentElement.style.setProperty('--bg-app', '#faf9f7');

    applyAppearanceToDocument({ theme: 'light', accentColor: '#059669' });

    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#faf9f7');
    expect(document.documentElement.style.getPropertyValue('--bg-app')).toBe('#faf9f7');

    document.documentElement.style.removeProperty('--bg');
    document.documentElement.style.removeProperty('--bg-app');
  });

  it('clears an explicit theme for system mode while retaining the custom accent', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.style.setProperty('--accent', '#f4f4f2');
    document.documentElement.style.setProperty('--accent-contrast', '#111111');

    applyAppearanceToDocument({ theme: 'system', accentColor: '#10B981' });

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--accent')).not.toBe('');
    expect(document.documentElement.style.getPropertyValue('--accent-contrast')).toMatch(/^#(?:111111|ffffff)$/);
  });

  it('updates every semantic accent state when the custom color changes', () => {
    applyAppearanceToDocument({ theme: 'light', accentColor: '#4F46E5' });
    const first = document.documentElement.style.getPropertyValue('--accent');

    applyAppearanceToDocument({ theme: 'light', accentColor: '#EF4444' });

    expect(document.documentElement.style.getPropertyValue('--accent')).not.toBe(first);
    expect(document.documentElement.style.getPropertyValue('--accent-strong')).not.toBe('');
    expect(document.documentElement.style.getPropertyValue('--accent-soft')).not.toBe('');
    expect(document.documentElement.style.getPropertyValue('--accent-tint')).not.toBe('');
    expect(document.documentElement.style.getPropertyValue('--accent-hover')).not.toBe('');
    expect(document.documentElement.style.getPropertyValue('--accent-pressed')).not.toBe('');
  });

  it('maps the legacy cyberpunk preference to the supported dark theme', () => {
    applyAppearanceToDocument({ theme: 'cyberpunk', accentColor: '#29d3c4' });

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--accent')).not.toBe('');
  });

  it('falls back to the default accent when no valid accent is configured', () => {
    document.documentElement.style.setProperty('--accent', '#4f46e5');

    applyAppearanceToDocument({ theme: 'system', accentColor: 'not-a-color' });

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('');
  });

  it('uses theme-owned monochrome tokens for the default accent', () => {
    applyAppearanceToDocument({ theme: 'dark', accentColor: DEFAULT_ACCENT_COLOR });

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('');
    expect(buildAccentPalette(DEFAULT_ACCENT_COLOR, 'dark')).toBeNull();
  });
});
