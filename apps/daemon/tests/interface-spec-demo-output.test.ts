import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseInterfaceSpecDocument } from '@open-design/contracts';
import { renderInterfaceSpecXlsx } from '../src/doc-renderers/interface-spec/render-xlsx.js';

/**
 * Writes a human-inspectable demo workbook so style parity with the legacy
 * aapserver form can be eyeballed in Excel. Kept as a test so it stays green
 * and reproducible; the artifact lands under the repo-local output/ dir.
 */
describe('interface-spec demo workbook', () => {
  it('writes output/interface-spec-demo.xlsx', async () => {
    const parsed = parseInterfaceSpecDocument({
      schemaVersion: 1,
      kind: 'interface-spec',
      cover: {
        brand: '스마트 인프라 구축사업',
        docName: 'SWD-PP12-APS',
        version: '1.0',
        department: '스마트교통2팀',
      },
      source: { codebaseName: 'aapserver', language: 'java', framework: 'spring-boot' },
      endpoints: [
        {
          method: 'GET',
          path: '/api/v1/stations/{stationId}/status',
          interfaceName: '역사 상태 조회',
          moduleName: 'com.metro.station',
          serviceName: 'StationStatusService',
          handlerName: 'getStationStatus',
          sourceFile: 'StationController.java',
          authRequired: true,
          responseType: 'StationStatusDto',
          responseFields: [
            { nameEn: 'stationId', nameKo: '역사 ID', dataType: 'Long', required: 'Y' },
            { nameEn: 'devices', nameKo: '장비 목록', dataType: 'List<DeviceDto>', required: 'Y', path: 'devices' },
            { nameEn: 'deviceId', nameKo: '장비 ID', dataType: 'String', required: 'Y', path: 'devices.deviceId', parentPath: 'devices', depth: 1 },
            { nameEn: 'online', nameKo: '온라인 여부', dataType: 'Boolean', required: 'Y', path: 'devices.online', parentPath: 'devices', depth: 1 },
          ],
        },
        {
          method: 'POST',
          path: '/api/v1/fares/recalculate',
          interfaceName: '운임 재계산 요청',
          moduleName: 'com.metro.fare',
          serviceName: 'FareService',
          handlerName: 'recalculate',
          sourceFile: 'FareController.java',
          authRequired: true,
          requestFields: [
            { nameEn: 'fromDate', nameKo: '시작일', dataType: 'Date', required: 'Y', minSize: '10', maxSize: '10' },
            { nameEn: 'toDate', nameKo: '종료일', dataType: 'Date', required: 'Y', minSize: '10', maxSize: '10' },
            { nameEn: 'lineCodes', nameKo: '노선 코드 목록', dataType: 'List<String>', required: 'N' },
          ],
          responseType: 'Long',
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = await renderInterfaceSpecXlsx(parsed.doc);
    const outDir = join(__dirname, '..', '..', '..', 'output');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'interface-spec-demo.xlsx'), result.buffer);
    expect(result.sheetTitles).toContain('역사 상태 조회');
  });
});
