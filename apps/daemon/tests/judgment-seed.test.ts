import { describe, expect, it } from 'vitest';
import { SEED_GENERIC_HELDOUT, SEED_GENERIC_TRAIN, seedJudgmentCases, seedJudgmentDataset } from '../src/services/judgment-seed.js';

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

  it('teaches short generic identifiers, in the train split only for the ones held out of it', () => {
    const labels = (split: 'train' | 'heldout', identifier: string, correct: boolean) =>
      seedJudgmentCases({ split }).filter((c) => c.kind === 'field-label' && c.subject.identifier === identifier && c.correct === correct).map((c) => c.subject.koreanLabel);
    expect(labels('train', 'name', true)).toEqual(expect.arrayContaining(['이름', '회원명']));
    expect(labels('train', 'id', true)).toEqual([]);
    expect(labels('heldout', 'id', true).sort()).toEqual(['ID', '아이디', '주문 ID', '회원 ID'].sort());
    expect(labels('heldout', 'status', false)).not.toContain('상태');
    expect(labels('heldout', 'name', true)).toEqual([]);
  });

  it('never labels a generic identifier wrongly with a label it is also given as right, and has no duplicate lines', () => {
    for (const split of ['train', 'heldout', 'all'] as const) {
      const cases = seedJudgmentCases({ split, kinds: ['field-label'] });
      const keys = cases.map((c) => `${c.subject.identifier}\u0000${c.subject.koreanLabel}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
    for (const [identifier, correct, wrong] of [...SEED_GENERIC_TRAIN, ...SEED_GENERIC_HELDOUT]) {
      expect(wrong.filter((label) => correct.includes(label)), identifier).toEqual([]);
      expect(wrong.length, identifier).toBeGreaterThanOrEqual(2);
    }
    const ids = [...SEED_GENERIC_TRAIN, ...SEED_GENERIC_HELDOUT].map(([identifier]) => identifier);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('writes laya-train / laya-evals lines with the evaluated question wording', () => {
    const line = JSON.parse(seedJudgmentDataset({ split: 'heldout', kinds: ['business-name'] }).split('\n')[0]!);
    expect(Object.keys(line)).toEqual(['state', 'questions', 'expected']);
    expect(line.questions.fits.type).toBe('noul');
    expect(typeof line.expected.fits).toBe('boolean');
    expect(seedJudgmentCases({ kinds: ['field-label'] }).every((c) => c.kind === 'field-label')).toBe(true);
  });
});
