import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('desktop package file patterns', () => {
  it('exclude development-only documents, tests, screenshots, logs, and maps on every platform', async () => {
    const sources = await Promise.all([
      readFile(new URL('../src/win/constants.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/mac/constants.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/linux.ts', import.meta.url), 'utf8'),
    ]);
    for (const source of sources) {
      expect(source).toContain('!**/*.log');
      expect(source).toContain('!**/*.map');
      expect(source).toContain('!**/*.md');
      expect(source).toContain('tests');
      expect(source).toContain('screenshots');
    }
  });
});
