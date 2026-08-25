import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanDatabaseCandidates } from '../src/database-candidates.js';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('scanDatabaseCandidates', () => {
  it('finds MyBatis mapper table references in a linked source directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'open-design-db-candidates-'));
    tempRoots.push(root);
    const mapperDir = path.join(root, 'src', 'main', 'resources', 'mybatis', 'mapper');
    await mkdir(mapperDir, { recursive: true });
    const mapperPath = path.join(mapperDir, 'MemberMapper.xml');
    await writeFile(mapperPath, '<select id="find">SELECT * FROM abtdb.tbcsm100 WHERE id = #{id}</select>\n', 'utf8');

    const candidates = await scanDatabaseCandidates([root], ['abtdb']);
    expect(candidates).toEqual([
      expect.objectContaining({
        schema: 'abtdb',
        table: 'tbcsm100',
        evidence: [expect.objectContaining({
          path: 'src/main/resources/mybatis/mapper/MemberMapper.xml',
          reason: 'SQL reference',
        })],
      }),
    ]);
    await expect(readFile(mapperPath, 'utf8')).resolves.toContain('tbcsm100');
  });
});
