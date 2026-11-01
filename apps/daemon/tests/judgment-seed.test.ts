import { describe, expect, it } from 'vitest';
import { seedJudgmentCases, seedJudgmentDataset } from '../src/services/judgment-seed.js';

const vocabulary = (cases: ReturnType<typeof seedJudgmentCases>) => ({
  identifiers: new Set(cases.filter((c) => c.kind === 'field-label').map((c) => c.subject.identifier)),
  resources: new Set(cases.filter((c) => c.kind === 'business-name').map((c) => c.subject.path!.split('/')[3])),
});

describe('SI judgment seed dataset', () => {
  it('is deterministic and keeps the train and held-out vocabularies disjoint', () => {
    expect(seedJudgmentDataset({ split: 'train' })).toBe(seedJudgmentDataset({ split: 'train' }));
    const train = vocabulary(seedJudgmentCases({ split: 'train' }));
    const heldout = vocabulary(seedJudgmentCases({ split: 'heldout' }));
    expect([...train.identifiers].filter((id) => heldout.identifiers.has(id))).toEqual([]);
    expect([...train.resources].filter((r) => heldout.resources.has(r))).toEqual([]);
    expect(heldout.identifiers.size).toBeGreaterThan(20);
    expect(heldout.resources.size).toBeGreaterThan(10);
  });

  it('pairs every positive with negatives, including same-family confusions', () => {
    const cases = seedJudgmentCases({ split: 'all' });
    const created = cases.filter((c) => c.kind === 'field-label' && c.subject.identifier === 'createdAt');
    expect(created.find((c) => c.correct)?.subject.koreanLabel).toBe('생성일시');
    expect(created.filter((c) => !c.correct).map((c) => c.subject.koreanLabel).sort()).toEqual(['삭제일시', '수정일시']);
    const positives = cases.filter((c) => c.correct).length;
    expect(cases.length - positives).toBe(positives * 2);
  });

  it('writes laya-train / laya-evals lines with the evaluated question wording', () => {
    const line = JSON.parse(seedJudgmentDataset({ split: 'heldout', kinds: ['business-name'] }).split('\n')[0]!);
    expect(Object.keys(line)).toEqual(['state', 'questions', 'expected']);
    expect(line.questions.fits.type).toBe('noul');
    expect(typeof line.expected.fits).toBe('boolean');
    expect(seedJudgmentCases({ kinds: ['field-label'] }).every((c) => c.kind === 'field-label')).toBe(true);
  });
});
