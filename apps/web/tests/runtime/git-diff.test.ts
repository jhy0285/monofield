import { describe, expect, it } from 'vitest';

import { splitUnifiedDiff } from '../../src/runtime/git-diff';

describe('splitUnifiedDiff', () => {
  it('pairs replacements and preserves line numbers in Before / After columns', () => {
    const rows = splitUnifiedDiff([
      'diff --git a/application.yml b/application.yml',
      '--- a/application.yml',
      '+++ b/application.yml',
      '@@ -1,5 +1,5 @@',
      ' server:',
      '-  port: 8081',
      '+  port: 9081',
      '   servlet:',
      '     context-path: /aop',
    ].join('\n'));

    expect(rows).toEqual([
      { kind: 'hunk', text: '@@ -1,5 +1,5 @@' },
      {
        kind: 'line',
        before: { kind: 'context', lineNumber: 1, text: 'server:' },
        after: { kind: 'context', lineNumber: 1, text: 'server:' },
      },
      {
        kind: 'line',
        before: { kind: 'deleted', lineNumber: 2, text: '  port: 8081' },
        after: { kind: 'added', lineNumber: 2, text: '  port: 9081' },
      },
      {
        kind: 'line',
        before: { kind: 'context', lineNumber: 3, text: '  servlet:' },
        after: { kind: 'context', lineNumber: 3, text: '  servlet:' },
      },
      {
        kind: 'line',
        before: { kind: 'context', lineNumber: 4, text: '    context-path: /aop' },
        after: { kind: 'context', lineNumber: 4, text: '    context-path: /aop' },
      },
    ]);
  });

  it('keeps unmatched additions and deletions as blank opposite cells', () => {
    const rows = splitUnifiedDiff([
      '@@ -8,2 +8,3 @@',
      '-old one',
      '-old two',
      '+new one',
      '+new two',
      '+new three',
    ].join('\n'));

    expect(rows.slice(1)).toEqual([
      {
        kind: 'line',
        before: { kind: 'deleted', lineNumber: 8, text: 'old one' },
        after: { kind: 'added', lineNumber: 8, text: 'new one' },
      },
      {
        kind: 'line',
        before: { kind: 'deleted', lineNumber: 9, text: 'old two' },
        after: { kind: 'added', lineNumber: 9, text: 'new two' },
      },
      {
        kind: 'line',
        before: { kind: 'empty', lineNumber: null, text: '' },
        after: { kind: 'added', lineNumber: 10, text: 'new three' },
      },
    ]);
  });

  it('treats source lines beginning with triple minus or plus as content inside a hunk', () => {
    const rows = splitUnifiedDiff('@@ -1 +1 @@\n----old\n++++new');
    expect(rows[1]).toEqual({
      kind: 'line',
      before: { kind: 'deleted', lineNumber: 1, text: '---old' },
      after: { kind: 'added', lineNumber: 1, text: '+++new' },
    });
  });
});
