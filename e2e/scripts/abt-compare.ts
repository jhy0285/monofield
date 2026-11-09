// Applies MonoField's own deterministic compatibility comparison to two scanner outputs.
// Used by plugins/_official/interface-spec/benchmark/abt/mf_arm.py.
//   pnpm exec tsx e2e/scripts/abt-compare.ts <before.json> <after.json> <report.json>
import { readFileSync, writeFileSync } from 'node:fs';

import { compareInterfaceSpecDocuments, parseInterfaceSpecDocument } from '@open-design/contracts';

const [before, after, out] = process.argv.slice(2);
if (!before || !after || !out) throw new Error('usage: abt-compare.ts <before.json> <after.json> <report.json>');

function load(file: string) {
  const parsed = parseInterfaceSpecDocument(JSON.parse(readFileSync(file, 'utf8')));
  if (!parsed.ok) throw new Error(`${file} is not a valid interface spec: ${parsed.error}`);
  return parsed.doc;
}

const report = compareInterfaceSpecDocuments(load(before), load(after));
writeFileSync(out, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ level: report.level, counts: report.counts, changes: report.changes.length }));
