import { open } from 'node:fs/promises';
import path from 'node:path';
import type { InterfaceSpecSourceIntent } from '@open-design/contracts';
import type { ToolEndpoint, ToolOperation } from './tool-tokens.js';

export type InterfaceSpecRuntimeSourceMode = 'codebase' | 'manual';

const FORM_ANSWERS_HEADER_RE = /^\s*\[form answers\s+(?:\u2014|-)\s*([^\]\r\n]+)\]/i;
const DATABASE_ENDPOINTS = new Set<string>([
  '/api/database/mutations',
  '/api/database/read',
]);
const DATABASE_OPERATIONS = new Set<string>([
  'database:mutate',
  'database:read',
]);
const MAX_INTERFACE_SPEC_POLICY_BYTES = 128 * 1024;

function answeredFormId(prompt: string): string | null {
  const match = FORM_ANSWERS_HEADER_RE.exec(prompt);
  if (!match) return null;
  return ((match[1] || '').trim().replace(/[^\w.-]/g, '') || null)?.toLowerCase() ?? null;
}

export function isInterfaceSpecFormAnswer(prompt: unknown, formId: string): boolean {
  if (typeof prompt !== 'string' || !formId.trim()) return false;
  return answeredFormId(prompt) === formId.trim().toLowerCase();
}

export function isInterfaceSpecDatabaseSampleAnswer(prompt: unknown): boolean {
  if (typeof prompt !== 'string' || answeredFormId(prompt) !== 'interface-spec-options') return false;
  return /\[value:\s*database-sample\]/i.test(prompt);
}

function sourceModeAnswer(prompt: string): InterfaceSpecRuntimeSourceMode | null {
  const line = prompt
    .split(/\r?\n/)
    .find((candidate) => /(?:source\s*mode|sourceMode)/i.test(candidate));
  if (line && /(?:\[value:\s*|:\s*)(manual)(?:\]|\s|$)/i.test(line)) return 'manual';
  if (line && /(?:\[value:\s*|:\s*)(codebase)(?:\]|\s|$)/i.test(line)) return 'codebase';
  if (/\[value:\s*manual\]/i.test(prompt)) return 'manual';
  if (/\[value:\s*codebase\]/i.test(prompt)) return 'codebase';
  return null;
}

export function resolveInterfaceSpecRuntimeSourceMode(input: {
  projectKind: unknown;
  currentPrompt: unknown;
  generationRequested: boolean;
  sourceIntent: InterfaceSpecSourceIntent;
  hasSelectedSource: boolean;
  collectionReset: boolean;
  previousMode?: InterfaceSpecRuntimeSourceMode | null;
  persistedMode?: InterfaceSpecRuntimeSourceMode | null;
}): InterfaceSpecRuntimeSourceMode | null {
  if (input.projectKind !== 'interface-spec') return null;
  const prompt = typeof input.currentPrompt === 'string' ? input.currentPrompt : '';
  const formId = answeredFormId(prompt);

  if (formId === 'interface-spec-manual-draft') return 'manual';
  if (formId === 'interface-spec-options') return 'codebase';
  if (formId === 'interface-spec-source-mode') {
    return sourceModeAnswer(prompt) ?? input.previousMode ?? input.persistedMode ?? null;
  }
  if (input.collectionReset) return 'codebase';
  if (input.generationRequested) {
    if (input.sourceIntent === 'manual') return 'manual';
    if (input.sourceIntent === 'codebase' || input.hasSelectedSource) return 'codebase';
  }
  return input.previousMode ?? input.persistedMode ?? null;
}

export function interfaceSpecDatabaseAccessAllowed(input: {
  projectKind: unknown;
  mode: InterfaceSpecRuntimeSourceMode | null;
  sourceValidated: boolean;
  optionsAnswered: boolean;
  databaseSampleRequested: boolean;
}): boolean {
  if (input.projectKind !== 'interface-spec') return true;
  // Interface-spec collection must never acquire DB capability merely because
  // an earlier turn selected codebase mode. Grant it only on the deterministic
  // options-answer turn, after the currently selected source passed preflight
  // and the user explicitly selected the database-sample branch.
  return input.mode === 'codebase'
    && input.sourceValidated
    && input.optionsAnswered
    && input.databaseSampleRequested;
}

export function scopeToolCapabilitiesForInterfaceSpecMode(
  databaseAccessAllowed: boolean,
  endpoints: readonly ToolEndpoint[],
  operations: readonly ToolOperation[],
): { allowedEndpoints: ToolEndpoint[]; allowedOperations: ToolOperation[] } {
  if (databaseAccessAllowed) {
    return { allowedEndpoints: [...endpoints], allowedOperations: [...operations] };
  }
  return {
    allowedEndpoints: endpoints.filter((endpoint) => !DATABASE_ENDPOINTS.has(endpoint)),
    allowedOperations: operations.filter((operation) => !DATABASE_OPERATIONS.has(operation)),
  };
}

export async function readPersistedInterfaceSpecSourceMode(
  workingDir: string | null,
): Promise<InterfaceSpecRuntimeSourceMode | null> {
  if (!workingDir) return null;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(path.join(workingDir, 'interface-spec.json'), 'r');
    const buffer = Buffer.allocUnsafe(MAX_INTERFACE_SPEC_POLICY_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const prefix = buffer.subarray(0, bytesRead).toString('utf8');
    const source = /"source"\s*:\s*\{(?<source>[^}]{0,8192})\}/s.exec(prefix)?.groups?.source ?? '';
    if (/"mode"\s*:\s*"manual"/i.test(source)) return 'manual';
    if (/"mode"\s*:\s*"codebase"/i.test(source)) return 'codebase';
    return null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
