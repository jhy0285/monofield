import type { ChangePolicy, ChangeReview, ChangeSelector, DocumentGraphNode } from '@open-design/contracts';

export function projectRelativePath(value: string): boolean {
  return !!value && value.length <= 1024 && !/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(value)
    && !value.replace(/\\/g, '/').split('/').some(part => part === '..' || part === '.') && !value.includes('\0');
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a policy object');
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !keys.includes(key))) throw new Error('Unknown policy property; executable expressions and commands are not supported');
  return item;
}
function strings(value: unknown, max: number): string[] {
  if (!Array.isArray(value) || value.length > max || value.some(id => typeof id !== 'string' || !id.length || id.length > 160)) throw new Error(`Expected at most ${max} nonempty policy IDs of at most 160 characters`);
  return [...new Set(value as string[])];
}
function selector(value: unknown): ChangeSelector {
  const item = object(value, ['kind', 'documentFile', 'itemId', 'pathPrefix']);
  if (!['api', 'screen', 'database', 'code'].includes(String(item.kind))) throw new Error('Unknown policy target kind');
  for (const key of ['documentFile', 'pathPrefix']) if (item[key] !== undefined && (typeof item[key] !== 'string' || !projectRelativePath(item[key]))) throw new Error('Expected a project-relative policy path');
  if (item.itemId !== undefined) strings([item.itemId], 1);
  if (item.pathPrefix !== undefined && item.kind !== 'code') throw new Error('pathPrefix applies to code nodes only');
  return item as unknown as ChangeSelector;
}
/** Bounded declarative data, no dependency, expression evaluator or executable policy hooks. */
export function parseChangePolicy(value: unknown): ChangePolicy {
  const item = object(value, ['schemaVersion', 'bindings', 'rules']);
  if (item.schemaVersion !== 1 || !Array.isArray(item.bindings) || item.bindings.length > 256 || !Array.isArray(item.rules) || item.rules.length > 64) throw new Error('Expected schemaVersion 1, at most 256 bindings and 64 rules');
  const bindings = item.bindings.map(value => {
    const binding = object(value, ['target', 'checkIds']);
    const checkIds = strings(binding.checkIds, 8);
    if (!checkIds.length) throw new Error('A binding requires at least one check');
    return { target: selector(binding.target), checkIds };
  });
  const rules = item.rules.map(value => {
    const rule = object(value, ['id', 'when', 'require']);
    const id = strings([rule.id], 1)[0]!;
    const require = object(rule.require, ['checkIds', 'reviews']);
    const checkIds = strings(require.checkIds, 8), reviews = strings(require.reviews, 6);
    if (reviews.some(review => !['browser', 'keyboard', 'responsive', 'contrast', 'schema', 'migration'].includes(review))) throw new Error('Unknown review requirement');
    if (!checkIds.length && !reviews.length) throw new Error('A rule requires at least one check or review');
    return { id, when: selector(rule.when), require: { checkIds, reviews: reviews as ChangeReview[] } };
  });
  if (new Set(rules.map(rule => rule.id)).size !== rules.length) throw new Error('Policy rule IDs must be unique');
  return { schemaVersion: 1, bindings, rules };
}
export function matchesChangeSelector(node: DocumentGraphNode, selector: ChangeSelector): boolean {
  if (node.kind !== selector.kind) return false;
  if (selector.documentFile !== undefined && node.documentFile !== selector.documentFile.replace(/\\/g, '/')) return false;
  if (selector.itemId !== undefined && node.itemId !== selector.itemId) return false;
  if (selector.pathPrefix !== undefined) {
    const prefix = selector.pathPrefix.replace(/\\/g, '/').replace(/\/$/, '');
    if (node.label !== prefix && !node.label.startsWith(prefix + '/')) return false;
  }
  return true;
}
