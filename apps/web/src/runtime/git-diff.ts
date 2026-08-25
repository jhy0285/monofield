export type SplitDiffCellKind = 'context' | 'added' | 'deleted' | 'empty';

export type SplitDiffCell = {
  kind: SplitDiffCellKind;
  lineNumber: number | null;
  text: string;
};

export type SplitDiffRow =
  | { kind: 'hunk'; text: string }
  | { kind: 'line'; before: SplitDiffCell; after: SplitDiffCell };

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function cell(kind: SplitDiffCellKind, lineNumber: number | null, text = ''): SplitDiffCell {
  return { kind, lineNumber, text };
}

/**
 * Convert a unified Git patch into paired rows suitable for a Before / After
 * comparison. Unchanged context is mirrored; adjacent delete/add blocks are
 * zipped so a replacement occupies one visual row.
 */
export function splitUnifiedDiff(patch: string): SplitDiffRow[] {
  const lines = patch.replace(/\r\n/g, '\n').split('\n');
  const rows: SplitDiffRow[] = [];
  let index = 0;

  while (index < lines.length) {
    const header = lines[index] ?? '';
    const match = HUNK_HEADER.exec(header);
    if (!match) {
      index += 1;
      continue;
    }

    let beforeLine = Number(match[1]);
    let afterLine = Number(match[2]);
    rows.push({ kind: 'hunk', text: header });
    index += 1;

    while (index < lines.length && !HUNK_HEADER.test(lines[index] ?? '')) {
      const line = lines[index] ?? '';

      if (line.startsWith(' ')) {
        const text = line.slice(1);
        rows.push({
          kind: 'line',
          before: cell('context', beforeLine, text),
          after: cell('context', afterLine, text),
        });
        beforeLine += 1;
        afterLine += 1;
        index += 1;
        continue;
      }

      if (line.startsWith('-') || line.startsWith('+')) {
        const deleted: SplitDiffCell[] = [];
        const added: SplitDiffCell[] = [];
        while (index < lines.length) {
          const changed = lines[index] ?? '';
          if (changed.startsWith('-')) {
            deleted.push(cell('deleted', beforeLine, changed.slice(1)));
            beforeLine += 1;
            index += 1;
            continue;
          }
          if (changed.startsWith('+')) {
            added.push(cell('added', afterLine, changed.slice(1)));
            afterLine += 1;
            index += 1;
            continue;
          }
          if (changed.startsWith('\\ No newline at end of file')) {
            index += 1;
            continue;
          }
          break;
        }
        const count = Math.max(deleted.length, added.length);
        for (let offset = 0; offset < count; offset += 1) {
          rows.push({
            kind: 'line',
            before: deleted[offset] ?? cell('empty', null),
            after: added[offset] ?? cell('empty', null),
          });
        }
        continue;
      }

      // Patch metadata and the optional no-newline marker do not represent a
      // source line in either revision, so they stay out of the paired view.
      index += 1;
    }
  }

  return rows;
}
