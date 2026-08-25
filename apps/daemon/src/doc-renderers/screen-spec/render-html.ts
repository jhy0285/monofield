import type {
  ScreenSpecCallout,
  ScreenSpecDocument,
  ScreenSpecScreen,
} from '@open-design/contracts';
import { validateScreenSpecDocument } from '@open-design/contracts';

/**
 * HTML preview of a screen-spec document — the in-panel "이 화면명세서가 이렇게
 * 나온다" view and the visual basis for the structured editor. Mirrors the PPTX
 * renderer's content: metadata table, the screen image with numbered red
 * callout markers overlaid, relation lines, the Description table, and the
 * Check Point box.
 *
 * Callout positions are already normalized (0..1), so they map directly to
 * CSS percentages — no slide-coordinate math needed. Content parity with the
 * PPTX comes from reading the same fields; only presentation differs.
 */

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function calloutById(screen: ScreenSpecScreen, no: number): ScreenSpecCallout | undefined {
  return screen.callouts.find((c) => c.no === no);
}

function markerLayer(screen: ScreenSpecScreen): string {
  const size = screen.visualSettings.markerSizePx;
  const markers = screen.callouts
    .map(
      (c) => `<div class="marker" style="left:${(c.position.x * 100).toFixed(2)}%;top:${(c.position.y * 100).toFixed(2)}%;width:${size}px;height:${size}px;margin-left:${-size / 2}px;margin-top:${-size / 2}px;font-size:${Math.max(10, Math.round(size * 0.5))}px;">${c.no}</div>`,
    )
    .join('');

  // Relation lines drawn on a 0..100 viewBox SVG so endpoints track the
  // percentage-positioned markers regardless of rendered image size.
  const lines = screen.calloutRelations
    .map((rel) => {
      const from = calloutById(screen, rel.fromNo);
      const to = calloutById(screen, rel.toNo);
      if (!from || !to || from.no === to.no) return '';
      const x1 = (from.position.x * 100).toFixed(2);
      const y1 = (from.position.y * 100).toFixed(2);
      const x2 = (to.position.x * 100).toFixed(2);
      const y2 = (to.position.y * 100).toFixed(2);
      if ((rel.lineMode ?? 'straight') === 'orthogonal') {
        const midY = ((from.position.y + to.position.y) / 2 * 100).toFixed(2);
        return `<polyline points="${x1},${y1} ${x1},${midY} ${x2},${midY} ${x2},${y2}" class="rel" marker-end="url(#arrow)" />`;
      }
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="rel" marker-end="url(#arrow)" />`;
    })
    .join('');

  const svg = lines
    ? `<svg class="rel-layer" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#D92D20"/></marker></defs>${lines}</svg>`
    : '';

  return svg + markers;
}

function imageBlock(screen: ScreenSpecScreen): string {
  if (screen.imageDataUrl) {
    return `<div class="screen-canvas"><img src="${esc(screen.imageDataUrl)}" alt="${esc(screen.screenName)}" />${markerLayer(screen)}</div>`;
  }
  return `<div class="screen-canvas placeholder"><div class="ph-grid"></div><div class="ph-label">SCREEN IMAGE PLACEHOLDER</div><div class="ph-name">${esc(screen.screenName || 'Untitled screen')}</div>${markerLayer(screen)}</div>`;
}

function levelRows(levels: string[]): string {
  const list = levels.length > 0 ? levels : [''];
  return list.map((lv, i) => `<tr><th>Level ${i + 1}</th><td>${esc(lv || '-')}</td></tr>`).join('');
}

function metadataTable(screen: ScreenSpecScreen): string {
  return `<table class="meta">
    ${levelRows(screen.levels)}
    <tr><th>화면ID/명</th><td>${esc(screen.id || '-')} / ${esc(screen.screenName || '-')}</td></tr>
    <tr><th>개요</th><td>${esc(screen.overview || '-')}</td></tr>
    <tr><th>Screen Path</th><td>${esc(screen.screenPath || '-')}</td></tr>
    <tr><th>Version / Date</th><td>${esc(screen.version || '-')} / ${esc(screen.date || '-')}</td></tr>
  </table>`;
}

function descriptionTable(screen: ScreenSpecScreen): string {
  const rows = screen.callouts.length
    ? screen.callouts
        .map(
          (c) => `<tr><td class="num">${c.no}</td><td>${esc(c.label || '-')}</td><td>${esc(c.description || '-')}</td></tr>`,
        )
        .join('')
    : `<tr><td colspan="3" class="empty">(콜아웃 없음)</td></tr>`;
  return `<table class="desc"><thead><tr><th>No</th><th>Label</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function checkpointBox(screen: ScreenSpecScreen): string {
  const items = screen.checkpoints.length
    ? screen.checkpoints.map((c) => `<li>${esc(c)}</li>`).join('')
    : `<li class="empty">No checkpoints registered.</li>`;
  return `<div class="checkpoint"><div class="cp-title">Check Point</div><ul>${items}</ul></div>`;
}

function screenSection(screen: ScreenSpecScreen, index: number): string {
  return `<section class="screen" id="scr-${index}">
    <h3>${esc(screen.pageTitle || screen.screenName || screen.id)} <span class="sid">${esc(screen.id)}</span></h3>
    ${metadataTable(screen)}
    <div class="body">
      <div class="left">${imageBlock(screen)}</div>
      <div class="right">
        <div class="desc-title">Description</div>
        ${descriptionTable(screen)}
        ${checkpointBox(screen)}
      </div>
    </div>
    <div class="footer">${esc(screen.companyName || 'MonoField')} · Ver ${esc(screen.version || '-')}</div>
  </section>`;
}

export function renderScreenSpecHtml(doc: ScreenSpecDocument): string {
  const issues = validateScreenSpecDocument(doc);
  const fatal = issues.filter((i) => i.severity === 'fatal');
  const banner = fatal.length
    ? `<div class="banner">⚠ ${esc(fatal.length)}건의 치명적 문제 — export 전 수정 필요: ${esc(fatal.map((i) => i.message).join(' / '))}</div>`
    : '';

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>${esc(doc.name)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: "Malgun Gothic", system-ui, sans-serif; margin: 0; padding: 24px; background: #faf9f7; color: #1a1916; }
  .banner { background: #fdecea; border: 1px solid #f5c6c2; color: #9c2a25; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; font-size: 13px; }
  h2.doc { text-align: center; font-size: 22px; margin: 8px 0 24px; }
  h3 { font-size: 15px; margin: 8px 0; }
  h3 .sid { color: #b45a3b; font-weight: 600; font-size: 12px; margin-left: 8px; }
  table { border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #d9dee7; padding: 4px 8px; text-align: left; vertical-align: top; }
  table.meta { width: 100%; margin-bottom: 12px; }
  table.meta th { background: #f1f3f6; width: 120px; white-space: nowrap; }
  .body { display: grid; grid-template-columns: 1.4fr 1fr; gap: 16px; align-items: start; }
  .screen-canvas { position: relative; border: 1px solid #d9dee7; background: #f7f8fa; overflow: hidden; }
  .screen-canvas img { display: block; width: 100%; height: auto; }
  .screen-canvas.placeholder { min-height: 280px; }
  .ph-grid { position: absolute; inset: 0; background-image: linear-gradient(#eef1f5 1px, transparent 1px), linear-gradient(90deg, #eef1f5 1px, transparent 1px); background-size: 32px 32px; }
  .ph-label { position: absolute; top: 14px; left: 16px; font-size: 10px; font-weight: 700; color: #b42318; }
  .ph-name { position: absolute; top: 34px; left: 16px; font-size: 18px; font-weight: 700; }
  .marker { position: absolute; background: #D92D20; color: #fff; border: 1.5px solid #fff; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; box-shadow: 0 1px 3px rgba(0,0,0,.3); z-index: 2; }
  .rel-layer { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 1; pointer-events: none; }
  .rel { stroke: #D92D20; stroke-width: 0.5; fill: none; vector-effect: non-scaling-stroke; }
  .desc-title, .cp-title { font-weight: 700; font-size: 13px; margin: 0 0 6px; }
  table.desc { width: 100%; }
  table.desc thead th { background: #30343a; color: #fff; text-align: center; }
  table.desc .num { text-align: center; color: #b42318; font-weight: 700; }
  .checkpoint { margin-top: 14px; border: 1px solid #d9dee7; }
  .checkpoint .cp-title { background: #30343a; color: #fff; padding: 5px 10px; margin: 0; }
  .checkpoint ul { margin: 8px 0; padding-left: 24px; font-size: 12px; }
  .empty { color: #989590; text-align: center; }
  .footer { margin-top: 10px; padding-top: 6px; border-top: 1px solid #d9dee7; font-size: 11px; color: #68707c; display: flex; justify-content: space-between; }
  .screen { border-top: 1px dashed #c9d0da; padding-top: 16px; margin-top: 24px; }
  .screen:first-of-type { border-top: none; }
</style></head><body>
${banner}
<h2 class="doc">${esc(doc.name)}</h2>
${doc.screens.map((s, i) => screenSection(s, i)).join('\n')}
</body></html>`;
}
