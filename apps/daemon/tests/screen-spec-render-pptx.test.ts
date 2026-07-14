import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { ScreenSpecDocument } from '@open-design/contracts';
import { parseScreenSpecDocument } from '@open-design/contracts';
import {
  ScreenSpecRenderError,
  renderScreenSpecPptx,
} from '../src/doc-renderers/screen-spec/render-pptx.js';

// 1x1 red PNG.
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function sampleDocument(): ScreenSpecDocument {
  const parsed = parseScreenSpecDocument({
    schemaVersion: 1,
    kind: 'screen-spec',
    name: '역무자동화 화면명세',
    screens: [
      {
        id: 'SCR-LOGIN-001',
        pageTitle: '로그인',
        screenName: '역할 선택 로그인',
        screenPath: '/login',
        overview: '역무원이 역할을 선택하고 로그인하는 화면.',
        levels: ['역무자동화', '공통', '로그인'],
        companyName: '그리스 OSE',
        author: '홍길동',
        date: '2026-07-07',
        version: '1.0',
        imageDataUrl: TINY_PNG,
        callouts: [
          { no: 1, label: '역할 목록', description: '역할 카드를 선택한다.', position: { x: 0.2, y: 0.3 } },
          { no: 2, label: '로그인 버튼', description: '선택한 역할로 로그인한다.', position: { x: 0.7, y: 0.8 } },
        ],
        calloutRelations: [{ fromNo: 1, toNo: 2, label: '선택 후 이동', lineMode: 'orthogonal' }],
        checkpoints: ['비밀번호 5회 오류 시 잠금 처리'],
      },
      {
        id: 'SCR-MAIN-001',
        screenName: '대시보드',
        callouts: [],
        calloutRelations: [],
        checkpoints: [],
      },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.doc;
}

async function slideXml(buffer: Buffer, slideNo: number): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file(`ppt/slides/slide${slideNo}.xml`)!.async('string');
}

describe('renderScreenSpecPptx', () => {
  it('renders one slide per screen with metadata, markers, description, and checkpoints', async () => {
    const result = await renderScreenSpecPptx(sampleDocument());
    expect(result.screenCount).toBe(2);

    const slide1 = await slideXml(result.buffer, 1);
    expect(slide1).toContain('화면ID/명');
    expect(slide1).toContain('SCR-LOGIN-001');
    expect(slide1).toContain('역할 목록');
    expect(slide1).toContain('로그인 버튼');
    expect(slide1).toContain('Check Point');
    expect(slide1).toContain('비밀번호 5회 오류 시 잠금 처리');
    expect(slide1).toContain('그리스 OSE');

    const slide2 = await slideXml(result.buffer, 2);
    expect(slide2).toContain('SCREEN IMAGE PLACEHOLDER'); // second screen has no image
    expect(slide2).toContain('대시보드');
  });

  it('strips the tailEnd/headEnd "none" artifacts that break desktop PowerPoint', async () => {
    const result = await renderScreenSpecPptx(sampleDocument());
    const slide1 = await slideXml(result.buffer, 1);
    expect(slide1).not.toContain('<a:tailEnd type="none"');
    expect(slide1).not.toContain('<a:headEnd type="none"');
    // The relation arrow keeps its real arrowhead.
    expect(slide1).toContain('<a:tailEnd type="triangle"');
  });

  it('refuses documents whose relations reference missing callouts', async () => {
    const doc = sampleDocument();
    doc.screens[0]!.calloutRelations.push({ fromNo: 1, toNo: 99 });
    await expect(renderScreenSpecPptx(doc)).rejects.toThrow(ScreenSpecRenderError);
  });

  it('is deterministic at the slide-content level', async () => {
    const [a, b] = await Promise.all([
      renderScreenSpecPptx(sampleDocument()),
      renderScreenSpecPptx(sampleDocument()),
    ]);
    expect(await slideXml(a.buffer, 1)).toBe(await slideXml(b.buffer, 1));
    expect(await slideXml(a.buffer, 2)).toBe(await slideXml(b.buffer, 2));
  });
});
