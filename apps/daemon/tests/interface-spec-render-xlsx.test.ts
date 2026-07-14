import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { InterfaceSpecDocument } from '@open-design/contracts';
import { parseInterfaceSpecDocument } from '@open-design/contracts';
import {
  InterfaceSpecRenderError,
  renderInterfaceSpecXlsx,
} from '../src/doc-renderers/interface-spec/render-xlsx.js';

function sampleDocument(): InterfaceSpecDocument {
  const parsed = parseInterfaceSpecDocument({
    schemaVersion: 1,
    kind: 'interface-spec',
    cover: {
      brand: '스마트 인프라 구축사업',
      docName: 'SWD-PP12-APS',
      version: '1.0',
      department: '스마트교통2팀',
    },
    source: {
      codebaseName: 'aapserver',
      language: 'java',
      framework: 'spring-boot',
      collector: 'agent',
    },
    // Bearer-token API so the Authorization/Bearer assertions below stay
    // meaningful; session-cookie/custom/none are covered in the auth-scheme block.
    auth: { type: 'bearer' },
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/users/{userId}',
        interfaceName: '사용자 상세 조회',
        moduleName: 'com.example.user',
        serviceName: 'UserService',
        handlerName: 'getUser',
        sourceFile: 'UserController.java',
        authRequired: true,
        responseType: 'UserDto',
        requestFields: [],
        responseFields: [
          { nameEn: 'user', nameKo: '사용자', dataType: 'UserDto', required: 'Y', path: 'user', depth: 0 },
          {
            nameEn: 'userId',
            nameKo: '사용자 ID',
            dataType: 'Long',
            required: 'Y',
            path: 'user.userId',
            parentPath: 'user',
            depth: 1,
          },
        ],
      },
      {
        method: 'POST',
        path: '/api/v1/users',
        interfaceId: 'USERS-007',
        interfaceName: '사용자 등록',
        requestFields: [
          { nameEn: 'name', nameKo: '이름', dataType: 'String', required: 'Y', minSize: '1', maxSize: '50' },
          { nameEn: 'tags', nameKo: '태그', dataType: 'List<String>', required: 'N' },
        ],
        responseFields: [],
      },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.doc;
}

async function readBack(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

describe('renderInterfaceSpecXlsx', () => {
  it('renders the aapserver workbook shape: cover, list, generated, one detail sheet per endpoint', async () => {
    const result = await renderInterfaceSpecXlsx(sampleDocument());
    expect(result.endpointCount).toBe(2);
    expect(result.sheetTitles.slice(0, 3)).toEqual(['문서표지', '인터페이스 목록', '인터페이스 목록(Generated)']);
    expect(result.sheetTitles).toHaveLength(5);

    const wb = await readBack(result.buffer);
    const cover = wb.getWorksheet('문서표지')!;
    expect(cover.getCell('Q4').value).toBe('스마트 인프라 구축사업');
    expect(cover.getCell('O7').value).toBe('인터페이스 명세서');
    expect(cover.getCell('O9').value).toBe('SWD-PP12-APS');
    expect(cover.getCell('Q10').value).toBe('1.0');
    expect(cover.getCell('N17').value).toBe('관리부서 : 스마트교통2팀');
  });

  it('fills the list sheet with sorted endpoints, hyperlinks, and auto interface ids', async () => {
    const result = await renderInterfaceSpecXlsx(sampleDocument());
    const wb = await readBack(result.buffer);
    const list = wb.getWorksheet('인터페이스 목록')!;

    // GET sorts before POST.
    expect(list.getCell('A6').value).toBe(1);
    // Auto id continues after the explicit USERS-007 seeds the domain counter.
    expect(list.getCell('C6').value).toBe('USERS-008');
    const nameCell = list.getCell('D6');
    expect(String((nameCell.value as { text?: string }).text ?? nameCell.value)).toBe('사용자 상세 조회');

    // Explicit interfaceId is respected on row 7.
    expect(list.getCell('C7').value).toBe('USERS-007');
    const urlCell = list.getCell('F7');
    expect(String((urlCell.value as { text?: string }).text ?? urlCell.value)).toBe('[POST] /api/v1/users');
  });

  it('writes detail sheets with REQUEST/Response sections, auth row, hierarchy numbers, and JSON samples', async () => {
    const result = await renderInterfaceSpecXlsx(sampleDocument());
    const wb = await readBack(result.buffer);
    const detail = wb.getWorksheet('사용자 상세 조회')!;

    expect(detail.getCell('A4').value).toBe('인터페이스 명세서');
    expect(detail.getCell('B6').value).toBe('USERS-008');
    expect(detail.getCell('B8').value).toBe('[GET] /api/v1/users/{userId}');
    expect(detail.getCell('A10').value).toBe('REQUEST');
    expect(detail.getCell('B11').value).toBe('영문명');

    // authRequired → Authorization row at data start.
    expect(detail.getCell('B12').value).toBe('Authorization');
    expect(detail.getCell('C12').value).toBe('인증 헤더');

    // Response title = max(minTitleRow 14, auth row 12 + empty request 13 + gap 2 = 15).
    expect(detail.getCell('A15').value).toBe('Response');
    expect(detail.getCell('B17').value).toBe('resultCode');
    expect(detail.getCell('D19').value).toBe('UserDto'); // result row uses endpoint responseType
    expect(detail.getCell('A20').value).toBe('3-1'); // user under result(3)
    expect(detail.getCell('A21').value).toBe('3-1-1'); // user.userId under user

    // JSON sample blocks exist with request/response titles.
    const values: string[] = [];
    detail.eachRow((row) => {
      const v = row.getCell(1).value;
      if (typeof v === 'string') values.push(v);
    });
    expect(values).toContain('요청 예시 데이터');
    expect(values).toContain('응답 예시 데이터');
    const jsonBlocks = values.filter((v) => v.trimStart().startsWith('{'));
    expect(jsonBlocks).toHaveLength(2); // request + response samples
    expect(jsonBlocks[0]).toContain('"Authorization": "Bearer sample"');
    expect(jsonBlocks[1]).toContain('"resultCode": 0');
  });

  it('writes minSize/maxSize into the reserved detail columns', async () => {
    const result = await renderInterfaceSpecXlsx(sampleDocument());
    const wb = await readBack(result.buffer);
    const detail = wb.getWorksheet('사용자 등록')!;
    expect(detail.getCell('B12').value).toBe('name');
    expect(detail.getCell('E12').value).toBe('1');
    expect(detail.getCell('F12').value).toBe('50');
  });

  it('is deterministic: same document → byte-identical central content', async () => {
    const [a, b] = await Promise.all([
      renderInterfaceSpecXlsx(sampleDocument()),
      renderInterfaceSpecXlsx(sampleDocument()),
    ]);
    const [wbA, wbB] = await Promise.all([readBack(a.buffer), readBack(b.buffer)]);
    expect(wbA.worksheets.map((w) => w.name)).toEqual(wbB.worksheets.map((w) => w.name));
    const cellsOf = (wb: ExcelJS.Workbook) => {
      const out: unknown[] = [];
      for (const ws of wb.worksheets) {
        ws.eachRow((row, rowNo) => {
          row.eachCell((cell, colNo) => out.push([ws.name, rowNo, colNo, cell.value]));
        });
      }
      return out;
    };
    expect(cellsOf(wbA)).toEqual(cellsOf(wbB));
  });

  it('stores sheet links as internal locations, never as external relationships', async () => {
    // Regression: exceljs writes hyperlinks as TargetMode="External" rels with
    // a "#'Sheet'!A1" target, which viewers (한셀 등) block as untrusted
    // external links. The renderer must rewrite them to openpyxl-style
    // location-only internal links.
    const result = await renderInterfaceSpecXlsx(sampleDocument());
    const zip = await JSZip.loadAsync(result.buffer);
    const entries = Object.keys(zip.files);

    const sheetXml = (
      await Promise.all(
        entries
          .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
          .map((n) => zip.file(n)!.async('string')),
      )
    ).join('\n');
    expect(sheetXml).toContain('<hyperlink');
    expect(sheetXml).not.toContain('location="#');
    expect(/<hyperlink\b[^>]*r:id=/.test(sheetXml)).toBe(false);

    const relsXml = (
      await Promise.all(
        entries
          .filter((n) => /^xl\/worksheets\/_rels\/.+\.rels$/.test(n))
          .map((n) => zip.file(n)!.async('string')),
      )
    ).join('\n');
    expect(relsXml).not.toContain('relationships/hyperlink');
    expect(relsXml).not.toContain('TargetMode="External"');
  });

  it('refuses documents with fatal duplicate endpoint keys', async () => {
    const doc = sampleDocument();
    doc.endpoints.push({ ...doc.endpoints[0]! });
    await expect(renderInterfaceSpecXlsx(doc)).rejects.toThrow(InterfaceSpecRenderError);
  });

  it('renders verbatim request/response examples (e.g. from a live probe) instead of type samples', async () => {
    const parsed = parseInterfaceSpecDocument({
      schemaVersion: 1,
      kind: 'interface-spec',
      source: { codebaseName: 'aapserver' },
      endpoints: [
        {
          method: 'GET',
          path: '/api/v1/admin/code-group/all',
          interfaceName: '전체 공통 코드 그룹 목록 조회',
          responseFields: [
            { nameEn: 'comnGrpCdId', nameKo: '공통 그룹 코드', dataType: 'String', required: 'Y' },
          ],
          requestExample: { query: { useYn: 'Y' } },
          responseExample: {
            resultCd: 200,
            resultMsg: 'success',
            result: [{ comnGrpCdId: 'ABNR_FARE_REASN_CD', comnGrpCdEnNm: 'Abnormal Fare Reason Code' }],
          },
        },
      ],
    });
    if (!parsed.ok) throw new Error(parsed.error);
    const result = await renderInterfaceSpecXlsx(parsed.doc);
    const wb = await readBack(result.buffer);
    const detail = wb.getWorksheet('전체 공통 코드 그룹 목록 조회')!;
    const values: string[] = [];
    detail.eachRow((row) => {
      const v = row.getCell(1).value;
      if (typeof v === 'string') values.push(v);
    });
    const jsonBlocks = values.filter((v) => v.trimStart().startsWith('{'));
    expect(jsonBlocks).toHaveLength(2);
    // Verbatim: real envelope (resultCd/200/success), not the synthetic resultCode:0/SUCCESS.
    expect(jsonBlocks[1]).toContain('"resultCd": 200');
    expect(jsonBlocks[1]).toContain('ABNR_FARE_REASN_CD');
    expect(jsonBlocks[1]).not.toContain('"resultCode": 0');
    expect(jsonBlocks[0]).toContain('"useYn": "Y"');
  });
});

describe('renderInterfaceSpecXlsx style override', () => {
  it('applies fills/border/font overrides while defaults stay intact elsewhere', async () => {
    const styled = await renderInterfaceSpecXlsx(sampleDocument(), {
      style: {
        fills: { header: 'FF112233', listHeader: 'FF445566' },
        borderColor: 'FF999999',
        fonts: { title: { name: 'Pretendard', color: 'FFAA0000' } },
      },
    });
    const wb = await readBack(styled.buffer);
    const list = wb.getWorksheet('인터페이스 목록')!;
    const headerCell = list.getCell('A5');
    expect((headerCell.fill as { fgColor?: { argb?: string } }).fgColor?.argb).toBe('FF445566');
    expect(headerCell.border?.top?.color?.argb).toBe('FF999999');

    const detail = wb.getWorksheet('사용자 상세 조회')!;
    expect(detail.getCell('A4').font?.name).toBe('Pretendard');
    expect(detail.getCell('A4').font?.color?.argb).toBe('FFAA0000');
    // Unoverridden font keeps the aapserver default.
    expect(detail.getCell('B12').font?.name).toBe('Malgun Gothic');
  });

  it('no override → identical output to default rendering', async () => {
    const [plain, empty] = await Promise.all([
      renderInterfaceSpecXlsx(sampleDocument()),
      renderInterfaceSpecXlsx(sampleDocument(), { style: {} }),
    ]);
    const [a, b] = await Promise.all([readBack(plain.buffer), readBack(empty.buffer)]);
    expect(a.getWorksheet('인터페이스 목록')!.getCell('A5').fill).toEqual(
      b.getWorksheet('인터페이스 목록')!.getCell('A5').fill,
    );
  });
});

describe('renderInterfaceSpecXlsx auth scheme (no more hardcoded Bearer)', () => {
  function docWithAuth(auth: unknown, endpointAuth?: unknown): InterfaceSpecDocument {
    const parsed = parseInterfaceSpecDocument({
      schemaVersion: 1,
      kind: 'interface-spec',
      source: { codebaseName: 'svc' },
      ...(auth ? { auth } : {}),
      endpoints: [
        {
          method: 'GET',
          path: '/api/v1/admin/authority/{athrSeq}',
          interfaceName: '권한 상세 조회',
          authRequired: true,
          ...(endpointAuth ? { auth: endpointAuth } : {}),
          responseFields: [{ nameEn: 'ok', nameKo: '성공', dataType: 'Boolean', required: 'Y' }],
        },
      ],
    });
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.doc;
  }

  async function authRowOf(doc: InterfaceSpecDocument) {
    const result = await renderInterfaceSpecXlsx(doc);
    const wb = await readBack(result.buffer);
    const detail = wb.getWorksheet('권한 상세 조회')!;
    // REQUEST data starts at row 12; auth row is the first request row.
    return {
      nameEn: detail.getCell('B12').value,
      nameKo: detail.getCell('C12').value,
      note: detail.getCell('H12').value,
    };
  }

  it('renders a session-cookie row (sid) instead of Bearer — the aopserver case', async () => {
    const row = await authRowOf(
      docWithAuth({ type: 'session-cookie', name: 'sid', description: '세션 쿠키' }),
    );
    expect(row.nameEn).toBe('Cookie');
    expect(row.nameKo).toBe('세션 쿠키');
    expect(String(row.note)).toContain('sid=');
    expect(String(row.note)).not.toContain('Bearer');
  });

  it('renders a bearer row only when the scheme says bearer', async () => {
    const row = await authRowOf(docWithAuth({ type: 'bearer' }));
    expect(row.nameEn).toBe('Authorization');
    expect(String(row.note)).toBe('Bearer {accessToken}');
  });

  it('renders a custom header row (X-Session-Id)', async () => {
    const row = await authRowOf(
      docWithAuth({ type: 'custom', location: 'header', name: 'X-Session-Id', description: '세션 헤더' }),
    );
    expect(row.nameEn).toBe('X-Session-Id');
    expect(row.nameKo).toBe('세션 헤더');
    expect(String(row.note)).not.toContain('Bearer');
  });

  it('endpoint-level auth overrides the document default', async () => {
    const row = await authRowOf(
      docWithAuth({ type: 'session-cookie', name: 'sid' }, { type: 'bearer' }),
    );
    expect(row.nameEn).toBe('Authorization');
  });

  it('authRequired with no scheme anywhere → honest "미지정" row, never a fabricated Bearer', async () => {
    const row = await authRowOf(docWithAuth(undefined));
    expect(String(row.note)).not.toContain('Bearer');
    expect(String(row.nameKo)).toContain('인증');
  });

  it('type "none" suppresses the auth row entirely', async () => {
    const doc = docWithAuth({ type: 'none' });
    const result = await renderInterfaceSpecXlsx(doc);
    const wb = await readBack(result.buffer);
    const detail = wb.getWorksheet('권한 상세 조회')!;
    // With no auth row, the first request row (12) is empty (endpoint has no request fields).
    expect(detail.getCell('B12').value).toBeFalsy();
  });
});
