import { parse } from '@vue/compiler-sfc';
import { parseJavascript } from './javascript.js';
import { edge, ontologyId, unit, type ParsedUnit } from './model.js';

export function parseVue(path: string, text: string, sha256: string): ParsedUnit {
  const { descriptor, errors } = parse(text, { filename: path });
  if (errors.length) throw new Error('Invalid Vue single-file component');
  const result = unit(path, 'vue', sha256), screenId = ontologyId('screen', path);
  result.nodes.push({ id: screenId, kind: 'screen', label: path.split('/').at(-1)!, evidence: result.nodes[0]!.evidence });
  result.edges.push(edge(result.nodes[0]!.id, screenId, 'declares', result.nodes[0]!.evidence));
  for (const block of [descriptor.script, descriptor.scriptSetup]) {
    if (!block) continue;
    if (block.src) { result.references.push({ from: screenId, name: block.src, kind: 'module', evidence: { path, sha256, line: block.loc.start.line } }); continue; }
    if (block.lang && !['js', 'ts', 'jsx', 'tsx'].includes(block.lang)) {
      result.issues.push({ path, reason: 'unsupported-language', message: `Vue script language is unsupported: ${block.lang}` }); continue;
    }
    const parsed = parseJavascript(path, block.content, sha256, { screen: true, typescript: block.lang === 'ts' || block.lang === 'tsx', jsx: block.lang === 'jsx' || block.lang === 'tsx', lineOffset: block.loc.start.line - 1 });
    result.nodes.push(...parsed.nodes); result.edges.push(...parsed.edges); result.references.push(...parsed.references); result.issues.push(...parsed.issues);
  }
  if (descriptor.template?.src) result.issues.push({ path, reason: 'unresolved-reference', message: 'External Vue template requires separate analysis' });
  // Template tags identify component usage; name alignment with imports remains a candidate.
  const template = descriptor.template?.ast;
  function visit(node: unknown) {
    if (!node || typeof node !== 'object') return;
    const value = node as { tag?: string; children?: unknown[]; loc?: { start: { line: number } } };
    if (value.tag && (/^[A-Z]/.test(value.tag) || value.tag.includes('-'))) {
      result.references.push({ from: screenId, name: value.tag, kind: 'component', evidence: { path, sha256, line: value.loc?.start.line ?? 1 } });
    }
    for (const child of value.children ?? []) visit(child);
  }
  visit(template);
  return result;
}
