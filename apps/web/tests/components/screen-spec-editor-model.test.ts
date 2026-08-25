import { describe, expect, it } from 'vitest';
import { applyScreenSpecCommand } from '../../src/components/screen-spec/editor-model';
import type { ScreenSpecScreen } from '@open-design/contracts';

function screen(): ScreenSpecScreen {
  return {
    id: 'SCR-001', pageTitle: '', screenName: '로그인', screenPath: '/login', overview: '', levels: [], companyName: '', author: '', date: '', version: '1.0',
    callouts: [
      { no: 1, label: '버튼', description: '로그인', position: { x: 0.2, y: 0.3 } },
      { no: 2, label: '팝업', description: '오류', position: { x: 0.7, y: 0.6 } },
    ],
    calloutRelations: [{ fromNo: 1, toNo: 2 }],
    visualSettings: { markerSizePx: 24, relationLineWidthPx: 2, canvasHeightPx: 520 },
    checkpoints: [],
  };
}

describe('screen-spec quick commands', () => {
  it('updates a description and adds a checkpoint', () => {
    const updated = applyScreenSpecCommand(screen(), '1번 설명을 로그인 요청 전송으로 바꿔줘');
    expect(updated.ok).toBe(true);
    expect(updated.screen.callouts[0]?.description).toBe('로그인 요청 전송');
    const checkpoint = applyScreenSpecCommand(updated.screen, '체크포인트에 5회 실패 시 잠금 추가해줘');
    expect(checkpoint.ok).toBe(true);
    expect(checkpoint.screen.checkpoints).toEqual(['5회 실패 시 잠금']);
  });

  it('deletes and renumbers markers and relations safely', () => {
    const result = applyScreenSpecCommand(screen(), '1번 마커 삭제해줘');
    expect(result.ok).toBe(true);
    expect(result.screen.callouts.map((callout) => callout.no)).toEqual([1]);
    expect(result.screen.calloutRelations).toEqual([]);
  });

  it('does not guess unsupported or missing targets', () => {
    expect(applyScreenSpecCommand(screen(), '9번 마커 삭제해줘').ok).toBe(false);
    expect(applyScreenSpecCommand(screen(), '알아서 예쁘게 바꿔줘').screen).toEqual(screen());
  });
});
