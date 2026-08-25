/**
 * Read-only evidence bridge for the in-app Electron Browser.
 *
 * A remote page and an LLM are both untrusted inputs. Keep the only guest
 * script in this module, never interpolate an LLM/user selector into it, and
 * return a bounded structured record instead of a raw DOM or browser storage.
 * This is intentionally an evidence collector, not a general browser-control
 * API. Side-effecting navigation, clicks, typing, uploads, downloads and
 * arbitrary JavaScript stay outside this bridge.
 */

export interface ReadOnlyBrowserEvidenceTarget {
  executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown> | null;
  getURL: () => string;
  getTitle?: () => string;
  isDesktopWebview: boolean;
}

export type BrowserEvidenceActionId =
  | 'extract_logo'
  | 'list_images'
  | 'extract_svgs'
  | 'extract_colors'
  | 'extract_fonts'
  | 'extract_design_tokens'
  | 'extract_type_scale'
  | 'extract_buttons'
  | 'extract_grid_system'
  | 'extract_breakpoints'
  | 'extract_gradients'
  | 'extract_shadows'
  | 'extract_easings'
  | 'extract_animations'
  | 'audit_layout'
  | 'audit_accessibility'
  | 'extract_component_inventory'
  | 'extract_copy'
  | 'extract_nav'
  | 'extract_forms'
  | 'page_info'
  | 'snapshot'
  | 'extract_og_metadata';

const READ_ONLY_ACTION_IDS = new Set<BrowserEvidenceActionId>([
  'extract_logo',
  'list_images',
  'extract_svgs',
  'extract_colors',
  'extract_fonts',
  'extract_design_tokens',
  'extract_type_scale',
  'extract_buttons',
  'extract_grid_system',
  'extract_breakpoints',
  'extract_gradients',
  'extract_shadows',
  'extract_easings',
  'extract_animations',
  'audit_layout',
  'audit_accessibility',
  'extract_component_inventory',
  'extract_copy',
  'extract_nav',
  'extract_forms',
  'page_info',
  'snapshot',
  'extract_og_metadata',
]);

const MAX_STRING_LENGTH = 1_000;
const MAX_ARRAY_LENGTH = 120;
const MAX_RECORD_KEYS = 48;
const MAX_EVIDENCE_JSON_LENGTH = 48_000;

const SENSITIVE_TEXT_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g,
  /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|auth(?:entication)?|secret|password|session(?:[_ -]?id)?)\s*[:=]\s*[^\s,;"'<>]{8,}/gi,
];

export interface BrowserEvidenceDocument {
  action: BrowserEvidenceActionId;
  capturedAt: string;
  source: 'open-docs-in-app-webview';
  tab: {
    title: string;
    url: string;
  };
  version: 1;
  evidence: Record<string, unknown>;
}

export type BrowserEvidenceCollectionResult =
  | { ok: true; document: BrowserEvidenceDocument }
  | { ok: false; reason: string };

export function isReadOnlyBrowserEvidenceAction(actionId: string): actionId is BrowserEvidenceActionId {
  return READ_ONLY_ACTION_IDS.has(actionId as BrowserEvidenceActionId);
}

/** Preserve the page identity without allowing credentials or query values into chat/project evidence. */
export function sanitizeBrowserEvidenceUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    url.username = '';
    url.password = '';
    url.hash = '';
    url.search = '';
    return url.href;
  } catch {
    return '';
  }
}

/** Redact common credential-shaped strings before the page crosses into the project or chat. */
export function redactBrowserEvidenceText(value: string, maxLength = MAX_STRING_LENGTH): string {
  let redacted = String(value ?? '');
  for (const pattern of SENSITIVE_TEXT_PATTERNS) redacted = redacted.replace(pattern, '[REDACTED]');
  return redacted.slice(0, maxLength);
}

/**
 * This script deliberately reads only visible/document metadata and computed
 * presentation information. It does not read browser storage, page form
 * values, authentication material, or issue network requests.
 */
export const READ_ONLY_BROWSER_EVIDENCE_SCRIPT = String.raw`(() => {
  const LIMIT = 120;
  const clean = (value, max = 360) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
  const safeUrl = (value) => {
    if (!value) return null;
    try {
      const url = new URL(String(value), location.href);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      url.username = '';
      url.password = '';
      url.hash = '';
      url.search = '';
      return url.href;
    } catch {
      return null;
    }
  };
  const visible = (node) => {
    if (!(node instanceof Element)) return false;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 1 && rect.height > 1;
  };
  const rect = (node) => {
    const box = node.getBoundingClientRect();
    return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
  };
  const selectorHint = (node) => {
    const id = node.getAttribute('id');
    if (id) return '#' + clean(id, 80).replace(/[^a-zA-Z0-9_-]/g, '');
    const classes = clean(node.getAttribute('class'), 80).split(' ').filter(Boolean).slice(0, 2).map((name) => '.' + name.replace(/[^a-zA-Z0-9_-]/g, '')).join('');
    return (node.tagName || 'element').toLowerCase() + classes;
  };
  const meta = (selector, attribute = 'content') => clean(document.querySelector(selector)?.getAttribute(attribute), 600);
  const allVisible = Array.from(document.querySelectorAll('body *')).filter(visible).slice(0, 900);
  const colorCounts = new Map();
  const fontCounts = new Map();
  const tokenCounts = new Map();
  const layoutIssues = [];
  const animations = [];
  for (const node of allVisible) {
    const style = getComputedStyle(node);
    for (const value of [style.color, style.backgroundColor, style.borderTopColor, style.outlineColor]) {
      const color = clean(value, 80);
      if (color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') colorCounts.set(color, (colorCounts.get(color) || 0) + 1);
    }
    const font = clean(style.fontFamily, 160);
    if (font) fontCounts.set(font, (fontCounts.get(font) || 0) + 1);
    for (const [name, value] of [['radius', style.borderRadius], ['shadow', style.boxShadow], ['gap', style.gap]]) {
      const normalized = clean(value, 180);
      if (normalized && normalized !== 'none' && normalized !== 'normal' && normalized !== '0px') tokenCounts.set(name + ':' + normalized, (tokenCounts.get(name + ':' + normalized) || 0) + 1);
    }
    const box = node.getBoundingClientRect();
    if (layoutIssues.length < 40 && (box.right > document.documentElement.clientWidth + 2 || box.left < -2)) {
      layoutIssues.push({ selector: selectorHint(node), issue: 'horizontal-overflow', ...rect(node) });
    }
    const motion = clean(style.animationName + ' | ' + style.transitionProperty + ' | ' + style.transitionTimingFunction, 220);
    if (animations.length < 40 && motion && motion !== 'none | all | ease') animations.push({ selector: selectorHint(node), motion });
  }
  const top = (map, limit = 32) => Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([value, count]) => ({ value, count }));
  const imageNodes = Array.from(document.querySelectorAll('img, source, video[poster], [style*="background"]'))
    .filter(visible)
    .slice(0, LIMIT)
    .map((node) => {
      const element = node;
      const style = getComputedStyle(element);
      const src = safeUrl(element.getAttribute('src') || element.getAttribute('poster') || '');
      const srcset = String(element.getAttribute('srcset') || '').split(',').slice(0, 12).map((candidate) => {
        const [source, ...descriptor] = candidate.trim().split(/\s+/);
        const safeSource = safeUrl(source);
        return safeSource ? [safeSource, ...descriptor].join(' ') : '';
      }).filter(Boolean).join(', ');
      const backgroundMatch = style.backgroundImage.match(/url\((?:"|')?([^"')]+)(?:"|')?\)/i);
      return {
        alt: clean(element.getAttribute('alt'), 240),
        background: backgroundMatch ? safeUrl(backgroundMatch[1]) : null,
        selector: selectorHint(element),
        src,
        srcset: srcset || null,
        ...rect(element),
      };
    })
    .filter((item) => item.src || item.background || item.srcset);
  const interactive = Array.from(document.querySelectorAll('a, button, input, select, textarea, summary, [role], [contenteditable="true"], h1, h2, h3, p'))
    .filter(visible)
    .slice(0, LIMIT)
    .map((node) => ({
      href: safeUrl(node.getAttribute('href')),
      label: clean(node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent, 300),
      role: clean(node.getAttribute('role'), 80) || null,
      selector: selectorHint(node),
      tag: node.tagName.toLowerCase(),
      ...rect(node),
    }));
  const links = Array.from(document.querySelectorAll('a[href]')).filter(visible).slice(0, LIMIT).map((node) => ({
    label: clean(node.textContent || node.getAttribute('aria-label'), 240),
    url: safeUrl(node.getAttribute('href')),
  })).filter((item) => item.url);
  const forms = Array.from(document.querySelectorAll('input, select, textarea, button[type="submit"], form')).filter(visible).slice(0, LIMIT).map((node) => ({
    label: clean(node.getAttribute('aria-label') || node.getAttribute('placeholder') || node.getAttribute('name') || node.textContent, 240),
    required: node.hasAttribute('required'),
    selector: selectorHint(node),
    tag: node.tagName.toLowerCase(),
    type: clean(node.getAttribute('type'), 80) || null,
  }));
  const rootStyle = getComputedStyle(document.documentElement);
  const cssVariables = Array.from(rootStyle).filter((name) => name.startsWith('--')).slice(0, LIMIT).map((name) => ({ name, value: clean(rootStyle.getPropertyValue(name), 240) }));
  const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).filter(visible).slice(0, 48).map((node) => ({ tag: node.tagName.toLowerCase(), text: clean(node.textContent, 360) }));
  const copy = Array.from(document.querySelectorAll('h1, h2, h3, p, li, button')).filter(visible).slice(0, LIMIT).map((node) => clean(node.textContent, 360)).filter(Boolean);
  const logoCandidates = imageNodes.filter((item) => /logo|brand|mark|header|nav/i.test(item.selector + ' ' + item.alt)).slice(0, 20);
  const svgSummary = {
    inlineCount: document.querySelectorAll('svg').length,
    linkedUrls: Array.from(document.querySelectorAll('img[src$=".svg"], object[data$=".svg"], link[href$=".svg"]')).slice(0, LIMIT).map((node) => safeUrl(node.getAttribute('src') || node.getAttribute('data') || node.getAttribute('href'))).filter(Boolean),
  };
  const result = {
    pageInfo: {
      canonical: safeUrl(meta('link[rel="canonical"]', 'href')),
      description: meta('meta[name="description"]'),
      favicon: safeUrl(meta('link[rel~="icon"]', 'href')),
      ogDescription: meta('meta[property="og:description"]'),
      ogImage: safeUrl(meta('meta[property="og:image"]')),
      ogTitle: meta('meta[property="og:title"]'),
      themeColor: meta('meta[name="theme-color"]'),
      title: clean(document.title, 360),
      url: safeUrl(location.href),
      viewport: { height: window.innerHeight, width: window.innerWidth },
    },
    assets: { images: imageNodes, logoCandidates, svgs: svgSummary },
    structure: { copy, forms, headings, links },
    styles: { animations, colors: top(colorCounts), cssVariables, fonts: top(fontCounts), tokens: top(tokenCounts), typeScale: Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, button')).filter(visible).slice(0, LIMIT).map((node) => { const style = getComputedStyle(node); return { fontFamily: clean(style.fontFamily, 140), fontSize: clean(style.fontSize, 40), fontWeight: clean(style.fontWeight, 40), lineHeight: clean(style.lineHeight, 40), selector: selectorHint(node), tag: node.tagName.toLowerCase() }; }) },
    snapshot: interactive,
    audit: { accessibility: interactive.filter((item) => ['button', 'input', 'select', 'textarea'].includes(item.tag) && !item.label).map((item) => ({ ...item, issue: 'missing-accessible-label' })).slice(0, 40), layout: layoutIssues },
  };
  return result;
})()`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

function boundedJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return undefined;
  if (typeof value === 'string') return redactBrowserEvidenceText(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean' || value == null) return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((item) => boundedJsonValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (!isRecord(value)) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_RECORD_KEYS)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const normalized = boundedJsonValue(item, depth + 1);
    if (normalized !== undefined) result[key] = normalized;
  }
  return result;
}

function compactEvidenceForAction(action: BrowserEvidenceActionId, raw: Record<string, unknown>): Record<string, unknown> {
  const pick = (...keys: string[]) => Object.fromEntries(
    keys.flatMap((key) => (key in raw ? [[key, raw[key]]] : [])),
  );
  if (action === 'page_info' || action === 'extract_og_metadata') return pick('pageInfo');
  if (action === 'snapshot') return pick('pageInfo', 'snapshot');
  if (['extract_logo', 'list_images', 'extract_svgs'].includes(action)) return pick('pageInfo', 'assets');
  if (['audit_layout', 'audit_accessibility'].includes(action)) return pick('pageInfo', 'audit', 'snapshot');
  if (['extract_component_inventory', 'extract_copy', 'extract_nav', 'extract_forms'].includes(action)) {
    return pick('pageInfo', 'structure', 'snapshot');
  }
  return pick('pageInfo', 'styles');
}

function compactDocument(document: BrowserEvidenceDocument): BrowserEvidenceDocument {
  let current = document;
  const serialized = () => JSON.stringify(current);
  if (serialized().length <= MAX_EVIDENCE_JSON_LENGTH) return current;
  const evidence = { ...current.evidence };
  delete evidence.snapshot;
  current = { ...current, evidence };
  if (serialized().length <= MAX_EVIDENCE_JSON_LENGTH) return current;
  return {
    ...current,
    evidence: {
      pageInfo: evidence.pageInfo,
      summary: 'Evidence was bounded before it crossed the in-app browser boundary.',
    },
  };
}

export async function collectReadOnlyBrowserEvidence(
  actionId: string,
  target: ReadOnlyBrowserEvidenceTarget | null,
): Promise<BrowserEvidenceCollectionResult> {
  if (!isReadOnlyBrowserEvidenceAction(actionId)) {
    return { ok: false, reason: 'This action requires confirmation-enabled browser control and is unavailable in the read-only broker.' };
  }
  if (!target?.isDesktopWebview) {
    return { ok: false, reason: 'Secure in-app browser inspection is available only in the desktop WebView.' };
  }
  try {
    const raw = await target.executeJavaScript(READ_ONLY_BROWSER_EVIDENCE_SCRIPT);
    if (!isRecord(raw)) return { ok: false, reason: 'The browser did not return structured evidence.' };
    const evidence = boundedJsonValue(compactEvidenceForAction(actionId, raw));
    if (!isRecord(evidence)) return { ok: false, reason: 'The browser evidence could not be validated.' };
    return {
      ok: true,
      document: compactDocument({
        action: actionId,
        capturedAt: new Date().toISOString(),
        source: 'open-docs-in-app-webview',
        tab: {
          title: redactBrowserEvidenceText(String(target.getTitle?.() ?? '')),
          url: sanitizeBrowserEvidenceUrl(String(target.getURL() ?? '')),
        },
        version: 1,
        evidence,
      }),
    };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'Browser evidence collection failed.' };
  }
}

export function browserEvidencePromptExcerpt(document: BrowserEvidenceDocument, maxLength = 14_000): string {
  const serialized = JSON.stringify(document, null, 2);
  if (serialized.length > maxLength) {
    return `${serialized.slice(0, maxLength)}\nEvidence truncated in chat; use the saved project JSON for the complete bounded record.`;
  }
  return serialized.length <= maxLength ? serialized : `${serialized.slice(0, maxLength)}\n… evidence truncated in chat; use the saved project JSON for the complete bounded record.`;
}
