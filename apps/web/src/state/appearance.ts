import type { AppTheme } from '../types';

const ACCENT_VARS = [
  '--accent',
  '--accent-strong',
  '--accent-soft',
  '--accent-tint',
  '--accent-hover',
  '--accent-pressed',
  '--accent-contrast',
  '--focus-ring',
  '--focus-ring-soft',
  '--selected',
  '--selected-soft',
  '--selected-contrast',
] as const;

export const DEFAULT_ACCENT_COLOR = '#111111';
export const ACCENT_SWATCHES = [
  DEFAULT_ACCENT_COLOR,
  '#2563eb',
  '#7c3aed',
  '#059669',
  '#dc2626',
  '#d97706',
  '#0891b2',
  '#db2777',
] as const;

type Rgb = { r: number; g: number; b: number };
export type AppearanceColorScheme = 'light' | 'dark';

export type AccentPalette = {
  accent: string;
  accentStrong: string;
  accentSoft: string;
  accentTint: string;
  accentHover: string;
  accentPressed: string;
  accentContrast: '#111111' | '#ffffff';
  focusRing: string;
  focusRingSoft: string;
  selected: string;
  selectedSoft: string;
  selectedContrast: '#111111' | '#ffffff';
};

export function normalizeAccentColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function resolveAccentColor(value: unknown): string {
  return normalizeAccentColor(value) ?? DEFAULT_ACCENT_COLOR;
}

function parseHex(value: string): Rgb {
  return {
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16),
  };
}

function asHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b]
    .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}

function mix(from: string, to: string, amount: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  return asHex({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  });
}

function relativeLuminance(value: string): number {
  const rgb = parseHex(value);
  const channels = [rgb.r, rgb.g, rgb.b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

export function accentContrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function ensureContrast(value: string, background: string, target: string, minimum: number): string {
  if (accentContrastRatio(value, background) >= minimum) return value;
  for (let step = 1; step <= 100; step += 1) {
    const candidate = mix(value, target, step / 100);
    if (accentContrastRatio(candidate, background) >= minimum) return candidate;
  }
  return target;
}

export function resolveAppearanceColorScheme(theme: AppTheme | undefined): AppearanceColorScheme {
  if (theme === 'dark' || theme === 'cyberpunk') return 'dark';
  if (theme === 'light') return 'light';
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/**
 * Derive an accessible semantic accent palette for the active base theme.
 * The saved value remains the user's color; only the rendered shade is nudged
 * when it would disappear against the current light or dark surface.
 */
export function buildAccentPalette(
  value: unknown,
  scheme: AppearanceColorScheme,
): AccentPalette | null {
  const source = resolveAccentColor(value);
  // The default is the product's monochrome setting. Let tokens.css provide
  // its theme-specific black (light) / white (dark) values.
  if (source === DEFAULT_ACCENT_COLOR) return null;

  const background = scheme === 'dark' ? '#161616' : '#ffffff';
  const contrastTarget = scheme === 'dark' ? '#ffffff' : '#000000';
  const accent = ensureContrast(source, background, contrastTarget, 4.5);
  const blackRatio = accentContrastRatio(accent, '#111111');
  const whiteRatio = accentContrastRatio(accent, '#ffffff');
  const accentContrast = blackRatio >= whiteRatio ? '#111111' : '#ffffff';
  const stateTarget = accentContrast === '#ffffff' ? '#000000' : '#ffffff';

  return {
    accent,
    accentStrong: accent,
    accentSoft: mix(background, accent, scheme === 'dark' ? 0.30 : 0.20),
    accentTint: mix(background, accent, scheme === 'dark' ? 0.18 : 0.10),
    accentHover: mix(accent, stateTarget, 0.12),
    accentPressed: mix(accent, stateTarget, 0.22),
    accentContrast,
    focusRing: accent,
    focusRingSoft: mix(background, accent, scheme === 'dark' ? 0.34 : 0.24),
    selected: accent,
    selectedSoft: mix(background, accent, scheme === 'dark' ? 0.24 : 0.14),
    selectedContrast: accentContrast,
  };
}

export function applyAppearanceToDocument({
  theme,
  accentColor,
}: {
  theme?: AppTheme;
  accentColor?: string;
}): void {
  const root = document.documentElement;
  const effectiveTheme = theme === 'cyberpunk' ? 'dark' : theme;
  if (effectiveTheme === 'light' || effectiveTheme === 'dark') {
    root.setAttribute('data-theme', effectiveTheme);
  } else {
    root.removeAttribute('data-theme');
  }

  for (const name of ACCENT_VARS) root.style.removeProperty(name);

  const palette = buildAccentPalette(accentColor, resolveAppearanceColorScheme(theme));
  if (palette == null) return;

  const values: Record<(typeof ACCENT_VARS)[number], string> = {
    '--accent': palette.accent,
    '--accent-strong': palette.accentStrong,
    '--accent-soft': palette.accentSoft,
    '--accent-tint': palette.accentTint,
    '--accent-hover': palette.accentHover,
    '--accent-pressed': palette.accentPressed,
    '--accent-contrast': palette.accentContrast,
    '--focus-ring': palette.focusRing,
    '--focus-ring-soft': palette.focusRingSoft,
    '--selected': palette.selected,
    '--selected-soft': palette.selectedSoft,
    '--selected-contrast': palette.selectedContrast,
  };
  for (const name of ACCENT_VARS) root.style.setProperty(name, values[name]);
}

export function observeSystemAppearance(theme: AppTheme | undefined, listener: () => void): () => void {
  if (theme !== 'system' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener?.('change', listener);
  return () => media.removeEventListener?.('change', listener);
}
