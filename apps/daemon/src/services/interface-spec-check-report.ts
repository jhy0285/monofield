import {
  INTERFACE_SPEC_CHANGE_LABELS,
  INTERFACE_SPEC_LEVEL_LABELS,
  type InterfaceSpecChangeLevel,
  type InterfaceSpecCompatibilityChange,
  type InterfaceSpecReportLanguage,
} from '@open-design/contracts';
import type { CodeComparison } from './document-rescan.js';

export type CheckFailOn = 'breaking' | 'warning' | 'never';
export type CheckReportFormat = 'text' | 'markdown' | 'json';

const MAX_ROWS = 200;

/** Whether the comparison passes the gate: `breaking` fails on breaking changes only, `warning` on those too. */
export function checkPasses(comparison: CodeComparison, failOn: CheckFailOn): boolean {
  if (failOn === 'never') return true;
  const { counts } = comparison.report;
  return counts.breaking === 0 && (failOn === 'breaking' || counts.warning === 0);
}

function detail(change: InterfaceSpecCompatibilityChange, code: (text: string) => string): string {
  const values = change.before !== undefined || change.after !== undefined
    ? `${change.before ?? '—'} → ${change.after ?? '—'}` : '';
  return [change.field ? code(change.field) : '', values].filter(Boolean).join(' ');
}

/** One line a person can read in a log: counts first, so the verdict is visible without scrolling. */
export function checkSummaryLine(comparison: CodeComparison, lang: InterfaceSpecReportLanguage): string {
  const { counts, level } = comparison.report;
  if (level === 'none') return lang === 'ko' ? 'API 계약 변경 없음' : 'No API contract change';
  return lang === 'ko'
    ? `호환성 깨짐 ${counts.breaking} · 확인 필요 ${counts.warning} · 추가 변경 ${counts.info}`
    : `${counts.breaking} breaking · ${counts.warning} to review · ${counts.info} additive`;
}

function scope(comparison: CodeComparison, lang: InterfaceSpecReportLanguage, code: (text: string) => string): string {
  const base = code(comparison.baseRevision.slice(0, 7));
  const { before, after } = comparison.endpoints;
  return lang === 'ko' ? `기준 ${base} · API ${before} → ${after}개` : `base ${base} · ${before} → ${after} APIs`;
}

const LEVELS: InterfaceSpecChangeLevel[] = ['breaking', 'warning', 'info'];

export function renderCheckReport(
  comparison: CodeComparison,
  options: { format: CheckReportFormat; lang: InterfaceSpecReportLanguage; failOn: CheckFailOn },
): string {
  const { format, lang, failOn } = options;
  const { report } = comparison;
  if (format === 'json') {
    return `${JSON.stringify({
      passed: checkPasses(comparison, failOn), failOn, base: comparison.baseRevision, level: report.level,
      counts: report.counts, endpoints: comparison.endpoints, changes: report.changes,
    }, null, 2)}\n`;
  }
  const changes = LEVELS.flatMap((level) => report.changes.filter((change) => change.level === level));
  const shown = changes.slice(0, MAX_ROWS);
  const more = changes.length - shown.length;
  const moreLine = more > 0 ? (lang === 'ko' ? `…외 ${more}건` : `…and ${more} more`) : '';
  if (format === 'markdown') {
    const tick = (text: string) => `\`${text.replaceAll('`', "'")}\``;
    const cell = (text: string) => text.replaceAll('|', '\\|').replaceAll('\n', ' ');
    const lines = [
      lang === 'ko' ? '## API 변경 검사' : '## API change check',
      '',
      `**${checkSummaryLine(comparison, lang)}** · ${scope(comparison, lang, tick)}`,
    ];
    if (shown.length) {
      lines.push('', lang === 'ko' ? '| 등급 | API | 변경 | 내용 |' : '| Level | API | Change | Detail |', '| --- | --- | --- | --- |');
      for (const change of shown) {
        lines.push(`| ${INTERFACE_SPEC_LEVEL_LABELS[change.level][lang]} | ${cell(tick(change.route))} | ${INTERFACE_SPEC_CHANGE_LABELS[change.code][lang]} | ${cell(detail(change, tick))} |`);
      }
      if (moreLine) lines.push('', moreLine);
    }
    lines.push('', lang === 'ko'
      ? '기준 커밋과 지금 코드를 같은 스캐너로 읽어 호출하는 쪽에서 보이는 차이만 비교했습니다.'
      : 'The code at the base commit and now was read with the same scanner; only differences a caller can see are listed.');
    return `${lines.join('\n')}\n`;
  }
  const plain = (text: string) => text;
  const lines = [
    `${lang === 'ko' ? 'API 변경 검사' : 'API change check'} (${scope(comparison, lang, plain)})`,
    checkSummaryLine(comparison, lang),
    ...shown.map((change) => [
      `[${INTERFACE_SPEC_LEVEL_LABELS[change.level][lang]}] ${change.route}`, INTERFACE_SPEC_CHANGE_LABELS[change.code][lang], detail(change, plain),
    ].filter(Boolean).join(' · ')),
    ...(moreLine ? [moreLine] : []),
  ];
  return `${lines.join('\n')}\n`;
}
