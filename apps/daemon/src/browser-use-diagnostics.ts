import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { BrowserUseDiscoveryFacts, BrowserUseRunState } from '@open-design/contracts';

const BROWSER_USE_REGISTRY_BASENAME = 'codex-browser-use';
const DEFAULT_STALE_THRESHOLD_MS = 10 * 60 * 1000;

export function browserUseRegistryPath(tmpDir: string = os.tmpdir()): string {
  return path.join(tmpDir, BROWSER_USE_REGISTRY_BASENAME);
}

export function isBrowserUseRequested(...values: unknown[]): boolean {
  return values.some((value) => (
    typeof value === 'string' &&
    (
      /(^|\s)@agent-browser(\s|$)/.test(value) ||
      value.includes('Browser tab context:') ||
      value.includes('Use the selected MonoField Browser tab as the bound target.') ||
      value.includes('MonoField browser automation session:') ||
      value.includes('MonoField browser automation session:')
    )
  ));
}

export function browserAutomationSessionId(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const match = /Open (?:Agent|Docs) browser automation session:\s*([A-Za-z0-9_-]{20,128})/.exec(value);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function collectBrowserUseDiscoveryFacts({
  registryPath = browserUseRegistryPath(),
  now = Date.now(),
  currentSessionId = null,
  staleThresholdMs = DEFAULT_STALE_THRESHOLD_MS,
}: {
  registryPath?: string;
  now?: number;
  currentSessionId?: string | null;
  staleThresholdMs?: number;
} = {}): BrowserUseDiscoveryFacts {
  try {
    const entries = fs.readdirSync(registryPath, { withFileTypes: true });
    let socketCount = 0;
    let candidateCount = 0;
    let staleCount = 0;
    let newestMtime = 0;
    let currentSessionIdPresent = currentSessionId ? false : null;

    for (const entry of entries) {
      const maybeSocket = entry.isSocket?.() || entry.name.endsWith('.sock');
      if (!maybeSocket) continue;
      socketCount += 1;
      candidateCount += 1;
      if (currentSessionId && entry.name.includes(currentSessionId)) {
        currentSessionIdPresent = true;
      }
      try {
        const stat = fs.statSync(path.join(registryPath, entry.name));
        newestMtime = Math.max(newestMtime, stat.mtimeMs);
        if (now - stat.mtimeMs > staleThresholdMs) staleCount += 1;
      } catch {
        staleCount += 1;
      }
    }

    return {
      registryPath,
      registryExists: true,
      socketCount,
      candidateCount,
      staleCount,
      currentSessionIdPresent,
      probeFailureCategory: 'not-probed',
      ...(newestMtime > 0 ? { newestSocketAgeMs: Math.max(0, now - newestMtime) } : {}),
      staleThresholdMs,
    };
  } catch (error) {
    const code = typeof (error as { code?: unknown })?.code === 'string'
      ? (error as { code: string }).code
      : '';
    return {
      registryPath,
      registryExists: false,
      socketCount: 0,
      candidateCount: 0,
      staleCount: 0,
      currentSessionIdPresent: currentSessionId ? false : null,
      probeFailureCategory: code === 'ENOENT' ? 'registry-missing' : 'registry-unreadable',
      staleThresholdMs,
    };
  }
}

export function buildBrowserUseRunState({
  requested,
  agentId,
  diagnostics,
  sessionId = null,
}: {
  requested: boolean;
  agentId: string | null | undefined;
  diagnostics?: BrowserUseDiscoveryFacts;
  sessionId?: string | null;
}): BrowserUseRunState | null {
  if (!requested) return null;
  const facts = diagnostics ?? collectBrowserUseDiscoveryFacts();
  if (sessionId != null) {
    return {
      requested: true,
      available: true,
      sessionId,
      diagnostics: facts,
    };
  }
  if (agentId !== 'codex') return null;
  return {
    requested: true,
    available: false,
    reason: 'no-matching-browser-backend',
    diagnostics: facts,
  };
}

export function renderBrowserUseUnavailablePrompt(state: BrowserUseRunState | null): string {
  if (!state) return '';
  if (state.available && state.sessionId) {
    const session = state.sessionId;
    return [
      '## MonoField in-app browser automation',
      '',
      `The user approved the current in-app browser tab for this run. Session: \`${session}\`.`,
      'Use the MonoField CLI through the provided runtime wrapper. Do not launch another browser and do not use arbitrary JavaScript.',
      'The host resolves returned DOM selectors to safe coordinates and drives a visible native pointer for click, hover, focus, and drag when possible. It automatically falls back to the bounded DOM executor when native hit testing is unavailable; do not ask the user to choose a low-level mode.',
      'Wrapper prefix — PowerShell: `& $env:OD_NODE_BIN $env:OD_BIN`; POSIX: `"$OD_NODE_BIN" "$OD_BIN"`.',
      '',
      'Append one of these command arguments to that prefix:',
      `- \`browser status --session ${session}\``,
      `- \`browser page-info --session ${session}\``,
      `- \`browser snapshot --session ${session}\``,
      `- \`browser screenshot --session ${session} --out <project-png-path>\``,
      `- \`browser navigate --session ${session} --url <same-origin-url>\``,
      `- \`browser click --session ${session} --selector <css-selector>\``,
      `- \`browser hover --session ${session} --selector <css-selector>\``,
      `- \`browser drag --session ${session} --selector <source> --target-selector <target>\``,
      `- \`browser type-text --session ${session} --selector <css-selector> --text <value>\``,
      `- \`browser upload --session ${session} --selector <file-input> --file <project-file>\``,
      `- \`browser scroll --session ${session} --to top|bottom|page\``,
      `- \`browser batch --session ${session} --steps <json-array>\``,
      '',
      'Start with snapshot plus screenshot when visual state matters, use only selectors it returns, and verify the page after each mutation. Use batch only for deterministic steps that do not require intermediate reasoning.',
      'The host keeps approval active until the user stops it, the tab closes, the origin changes, or MonoField quits. It remains bound to one tab/origin and blocks sensitive fields. If it rejects an operation, stop and tell the user why.',
    ].join('\n');
  }
  return [
    '## Browser automation availability',
    '',
    `Browser automation was requested, but MonoField has not confirmed a matching in-app browser backend for this run. Reason: \`${state.reason}\`.`,
    'Treat browser-use / in-app-browser automation as unavailable for this turn.',
    'Do not use raw Google Chrome headless or ad-hoc Chrome fallback from the packaged desktop sandbox.',
    'If the task requires browser evidence, report the unavailable reason and use only the provided browser tab URL, title, and saved project context until a backend is attached.',
  ].join('\n');
}
