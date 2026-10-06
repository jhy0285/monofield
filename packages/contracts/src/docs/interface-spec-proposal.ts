import { z } from 'zod';
import { parseInterfaceSpecDocument, validateInterfaceSpecDocument, type InterfaceSpecDocument } from './interface-spec.js';

const ChangeSchema = z.object({
  op: z.enum(['add', 'remove', 'replace', 'test']),
  path: z.string().min(2).max(1024),
  value: z.unknown().optional(),
}).superRefine((change, ctx) => {
  if (change.op !== 'remove' && change.value === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${change.op} requires a JSON value.` });
  }
});

/** Small reviewable changes; the original document is reconstructed by the host. */
export const InterfaceSpecProposalSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('interface-spec-proposal'),
  baseContentSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  changes: z.array(ChangeSchema).min(1).max(500),
});
export type InterfaceSpecProposal = z.infer<typeof InterfaceSpecProposalSchema>;

type Container = Record<string, unknown> | unknown[];
function isContainer(value: unknown): value is Container {
  return value !== null && typeof value === 'object';
}
function pointer(path: string): string[] {
  if (!path.startsWith('/') || /~(?![01])/.test(path)) throw new Error('Invalid JSON pointer.');
  const parts = path.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (parts.length > 20 || parts.some((part) => ['__proto__', 'prototype', 'constructor'].includes(part))) {
    throw new Error('Unsupported proposal path.');
  }
  return parts;
}
function index(key: string, length: number, append: boolean): number {
  const value = key === '-' && append ? length : /^(?:0|[1-9][0-9]*)$/.test(key) ? Number(key) : -1;
  if (!Number.isSafeInteger(value) || value < 0 || value >= length + (append ? 1 : 0)) throw new Error('Proposal array index is out of bounds.');
  return value;
}
function read(parent: Container, key: string): unknown {
  if (Array.isArray(parent)) return parent[index(key, parent.length, false)];
  if (!Object.hasOwn(parent, key)) throw new Error(`Proposal target does not exist: ${key}`);
  return parent[key];
}
function equalJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!isContainer(left) || !isContainer(right) || Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key)
    && equalJson((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}
function assertKnownProperties(candidate: unknown, validated: unknown): void {
  if (!isContainer(candidate) || !isContainer(validated)) return;
  for (const key of Object.keys(candidate)) {
    if (!Object.hasOwn(validated, key)) throw new Error(`Unknown proposal property: ${key}`);
    assertKnownProperties((candidate as Record<string, unknown>)[key], (validated as Record<string, unknown>)[key]);
  }
}

/** Applies all operations to a private clone and validates before returning any result. */
export function applyInterfaceSpecProposal(
  original: InterfaceSpecDocument, expectedContentSha256: string, input: unknown,
): { ok: true; doc: InterfaceSpecDocument; changesApplied: number } | { ok: false; error: string } {
  try {
    const proposal = InterfaceSpecProposalSchema.parse(input);
    if (proposal.baseContentSha256.toLowerCase() !== expectedContentSha256.toLowerCase()) throw new Error('The proposal was created from a different document revision.');
    const candidate: Record<string, unknown> = JSON.parse(JSON.stringify(original));
    for (const change of proposal.changes) {
      const parts = pointer(change.path);
      let parent: Container = candidate;
      for (const part of parts.slice(0, -1)) {
        const next = read(parent, part);
        if (!isContainer(next)) throw new Error('Proposal parent is not an object or array.');
        parent = next;
      }
      const key = parts.at(-1)!;
      if (change.op === 'test') {
        if (!equalJson(read(parent, key), change.value)) throw new Error(`Proposal test failed at ${change.path}.`);
        continue;
      }
      if (Array.isArray(parent)) {
        const position = index(key, parent.length, change.op === 'add');
        if (change.op === 'add') parent.splice(position, 0, change.value);
        else if (change.op === 'remove') parent.splice(position, 1);
        else parent[position] = change.value;
      } else {
        if (change.op !== 'add') read(parent, key);
        if (change.op === 'remove') delete parent[key];
        else parent[key] = change.value;
      }
    }
    const parsed = parseInterfaceSpecDocument(candidate);
    if (!parsed.ok) throw new Error(parsed.error);
    assertKnownProperties(candidate, parsed.doc);
    const fatal = validateInterfaceSpecDocument(parsed.doc).filter((issue) => issue.severity === 'fatal');
    if (fatal.length) throw new Error(fatal.map((issue) => issue.message).join('\n'));
    return { ok: true, doc: parsed.doc, changesApplied: proposal.changes.filter((change) => change.op !== 'test').length };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}
