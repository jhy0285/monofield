import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanDatabaseCandidates, type DatabaseCandidate } from '../src/database-candidates.js';

const tempRoots: string[] = [];

async function makeProject(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-design-db-candidates-'));
  tempRoots.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
  return root;
}

function summarize(candidates: DatabaseCandidate[]) {
  return candidates
    .map((candidate) => ({
      schema: candidate.schema,
      table: candidate.table,
      lines: candidate.evidence.map((item) => item.line),
    }))
    .sort((a, b) => a.table.localeCompare(b.table));
}

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

  describe('MyBatis / iBATIS mapper XML', () => {
    const userMapper = [
      '<mapper namespace="egov.user.UserMapper">',
      '  <select id="selectUser" resultType="UserVO">',
      '    SELECT USER_ID, USER_NM',
      '      FROM COMTNEMPLYRINFO',
      '     WHERE USER_ID = #{userId}',
      '  </select>',
      '</mapper>',
      '',
    ];

    it('finds a table whose FROM sits on its own line inside a statement element', async () => {
      const root = await makeProject({ 'src/UserMapper.xml': userMapper.join('\n') });

      expect(await scanDatabaseCandidates([root])).toEqual([
        {
          schema: null,
          table: 'COMTNEMPLYRINFO',
          evidence: [{ path: 'src/UserMapper.xml', line: 4, reason: 'SQL reference' }],
        },
      ]);
    });

    it('reports the right line for CRLF mapper files', async () => {
      const root = await makeProject({ 'src/UserMapper.xml': userMapper.join('\r\n') });

      expect(summarize(await scanDatabaseCandidates([root]))).toEqual([
        { schema: null, table: 'COMTNEMPLYRINFO', lines: [4] },
      ]);
    });

    it('covers FROM, JOIN, INTO, UPDATE, DELETE FROM and MERGE INTO inside statement elements', async () => {
      const root = await makeProject({
        'src/AdminMapper.xml': [
          '<mapper namespace="egov.admin.AdminMapper">',
          '  <select id="list">',
          '    SELECT A.ID',
          '      FROM TB_SEL A',
          '      LEFT OUTER',
          '      JOIN TB_JOINED B',
          '        ON A.ID = B.ID',
          '  </select>',
          '  <insert id="add">',
          '    INSERT',
          '      INTO TB_INS',
          '         ( ID )',
          '    VALUES ( #{id} )',
          '  </insert>',
          '  <update id="edit">',
          '    UPDATE',
          '           TB_UPD',
          '       SET NM = #{nm}',
          '  </update>',
          '  <delete id="remove">',
          '    DELETE',
          '      FROM TB_DEL',
          '     WHERE ID = #{id}',
          '  </delete>',
          '  <update id="upsert">',
          '    MERGE INTO TB_MRG T',
          '    USING ( SELECT #{id} AS ID ) S',
          '       ON ( T.ID = S.ID )',
          '  </update>',
          '</mapper>',
          '',
        ].join('\n'),
      });

      expect(summarize(await scanDatabaseCandidates([root]))).toEqual([
        { schema: null, table: 'TB_DEL', lines: [21] },
        { schema: null, table: 'TB_INS', lines: [11] },
        { schema: null, table: 'TB_JOINED', lines: [6] },
        { schema: null, table: 'TB_MRG', lines: [26] },
        { schema: null, table: 'TB_SEL', lines: [4] },
        { schema: null, table: 'TB_UPD', lines: [16] },
      ]);
    });

    it('does not read the <update id="..."> element name as UPDATE <table>', async () => {
      const root = await makeProject({
        'src/UpdMapper.xml': [
          '<mapper namespace="egov.upd.UpdMapper">',
          '  <update id="edit" parameterType="UserVO">',
          '    UPDATE TB_UPD',
          '       SET NM = #{nm}',
          '  </update>',
          '</mapper>',
          '',
        ].join('\n'),
      });

      expect(summarize(await scanDatabaseCandidates([root]))).toEqual([
        { schema: null, table: 'TB_UPD', lines: [3] },
      ]);
    });

    it('finds tables in <sql> fragments and keeps scanning past <include refid> tags', async () => {
      const root = await makeProject({
        'src/EmpMapper.xml': [
          '<mapper namespace="egov.emp.EmpMapper">',
          '  <sql id="selectFromEmp">',
          '    FROM COMTNEMPLYRINFO A',
          '    LEFT JOIN COMTNORGNZTINFO B ON A.ORGNZT_ID = B.ORGNZT_ID',
          '  </sql>',
          '  <select id="selectEmpList" resultType="egovMap">',
          '    SELECT A.EMPLYR_ID',
          '    <include refid="selectFromEmp"/>',
          '    <where>',
          '      <if test="searchKeyword != null">',
          "        AND A.USER_NM LIKE '%' || #{searchKeyword} || '%'",
          '      </if>',
          '    </where>',
          '  </select>',
          '  <select id="selectEmpCount" resultType="int">',
          '    SELECT COUNT(*)',
          '    <include refid="egov.emp.EmpMapper.selectFromEmp"></include>',
          '  </select>',
          '  <select id="selectRows" resultType="egovMap">',
          '    SELECT <include refid="cols"/>',
          '      FROM TB_ROWS',
          '  </select>',
          '</mapper>',
          '',
        ].join('\n'),
      });

      expect(summarize(await scanDatabaseCandidates([root]))).toEqual([
        { schema: null, table: 'COMTNEMPLYRINFO', lines: [3] },
        { schema: null, table: 'COMTNORGNZTINFO', lines: [4] },
        { schema: null, table: 'TB_ROWS', lines: [21] },
      ]);
    });

    it('keeps the schema of OWNER.TABLE references and applies the default schema to bare tables', async () => {
      const root = await makeProject({
        'src/HrMapper.xml': [
          '<mapper namespace="egov.hr.HrMapper">',
          '  <select id="selectEmp" resultType="egovMap">',
          '    SELECT A.EMPLYR_ID',
          '      FROM EGOV.COMTNEMPLYRINFO A',
          '      LEFT JOIN',
          '           HR.COMTNORGNZTINFO B',
          '        ON A.ORGNZT_ID = B.ORGNZT_ID',
          '     WHERE 1 = 1',
          '  </select>',
          '  <select id="selectLocal" resultType="egovMap">',
          '    SELECT *',
          '      FROM TB_LOCAL',
          '  </select>',
          '</mapper>',
          '',
        ].join('\n'),
      });

      expect(summarize(await scanDatabaseCandidates([root]))).toEqual([
        { schema: 'EGOV', table: 'COMTNEMPLYRINFO', lines: [4] },
        { schema: 'HR', table: 'COMTNORGNZTINFO', lines: [5] },
        { schema: null, table: 'TB_LOCAL', lines: [12] },
      ]);
      expect(summarize(await scanDatabaseCandidates([root], ['appdb']))).toEqual([
        { schema: 'EGOV', table: 'COMTNEMPLYRINFO', lines: [4] },
        { schema: 'HR', table: 'COMTNORGNZTINFO', lines: [5] },
        { schema: 'appdb', table: 'TB_LOCAL', lines: [12] },
      ]);
    });

    it('finds tables inside CDATA blocks, including ones with < comparisons', async () => {
      const root = await makeProject({
        'src/CdataMapper.xml': [
          '<mapper namespace="egov.cdata.CdataMapper">',
          '  <select id="selectOld" resultType="egovMap">',
          '    <![CDATA[',
          '      SELECT ID',
          '        FROM TB_CDATA',
          '       WHERE REG_DT < SYSDATE - 7',
          '    ]]>',
          '  </select>',
          '  <update id="touch"><![CDATA[',
          '    UPDATE TB_TOUCH',
          '       SET CNT = CNT + 1',
          '     WHERE CNT < 10',
          '  ]]></update>',
          '  <delete id="purge">',
          '    <![CDATA[',
          '    DELETE',
          '      FROM TB_PURGE',
          '     WHERE CNT <= 0',
          '    ]]>',
          '  </delete>',
          '</mapper>',
          '',
        ].join('\n'),
      });

      expect(summarize(await scanDatabaseCandidates([root]))).toEqual([
        { schema: null, table: 'TB_CDATA', lines: [5] },
        { schema: null, table: 'TB_PURGE', lines: [16] },
        { schema: null, table: 'TB_TOUCH', lines: [10] },
      ]);
    });

    it('merges references that differ only by case into one candidate', async () => {
      const root = await makeProject({
        'src/DupMapper.xml': [
          '<mapper namespace="egov.dup.DupMapper">',
          '  <select id="a">',
          '    SELECT *',
          '      FROM Tb_Dup',
          '  </select>',
          '  <select id="b">',
          '    SELECT *',
          '      FROM TB_DUP',
          '  </select>',
          '</mapper>',
          '',
        ].join('\n'),
      });

      expect(summarize(await scanDatabaseCandidates([root]))).toEqual([
        { schema: null, table: 'Tb_Dup', lines: [4, 8] },
      ]);
    });

    it('ignores prose that is outside statement elements', async () => {
      const root = await makeProject({
        'src/DocsMapper.xml': [
          '<mapper namespace="egov.docs.DocsMapper">',
          '  <!-- rows are copied from legacy_rows into the archive -->',
          '  <resultMap id="docMap" type="DocVO">',
          '    <result property="note" column="NOTE"/>',
          '  </resultMap>',
          '  <description>Loaded from the user profile</description>',
          '  <select id="selectNothing">',
          '    SELECT 1',
          '  </select>',
          '  <!-- merged into the main report after the nightly run -->',
          '</mapper>',
          '',
        ].join('\n'),
      });

      expect(await scanDatabaseCandidates([root])).toEqual([]);
    });

    it('still accepts same-line SQL in XML that is not a statement element', async () => {
      const root = await makeProject({
        'config/beans.xml': '<property name="sql" value="SELECT * FROM TB_PROP WHERE ID = ?"/>\n',
      });

      expect(summarize(await scanDatabaseCandidates([root]))).toEqual([
        { schema: null, table: 'TB_PROP', lines: [1] },
      ]);
    });
  });

  describe('non-SQL languages', () => {
    it('does not match prose such as "from the user" in .ts and .java files', async () => {
      const root = await makeProject({
        'src/profile.ts': '// Copies values from the request into the view model\nexport const profile = 1;\n',
        'src/Profile.java': [
          '/**',
          ' * Loads settings from the remote profile and stores them into the cache.',
          ' */',
          'class Profile {}',
          '',
        ].join('\n'),
      });

      expect(await scanDatabaseCandidates([root])).toEqual([]);
    });

    it('keeps requiring a SQL verb on the same line even inside mapper-shaped text', async () => {
      const root = await makeProject({
        'src/Repo.ts': [
          'export const mapper = `<select id="x">',
          '  SELECT *',
          '    FROM TB_TS',
          '</select>`;',
          '',
        ].join('\n'),
        'src/Repo.java': [
          'class Repo {',
          '  static final String MAPPER = """',
          '    <select id="x">',
          '      SELECT *',
          '        FROM TB_JAVA',
          '    </select>""";',
          '}',
          '',
        ].join('\n'),
      });

      expect(await scanDatabaseCandidates([root])).toEqual([]);
    });
  });
});
