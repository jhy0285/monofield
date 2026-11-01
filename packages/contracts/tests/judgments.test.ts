import { describe, expect, it } from 'vitest';
import {
  judgmentAuc,
  judgmentDatasetLine,
  judgmentPolicyOutcome,
  judgmentRuleVerdict,
  judgmentVerdict,
  looksUntranslated,
  suggestJudgmentPolicy,
} from '../src/api/judgments';

describe('judgment rules', () => {
  it('flags empty and untranslated labels without a model', () => {
    expect(judgmentRuleVerdict('field-label', { identifier: 'memberId', koreanLabel: '' })).toBe('empty');
    expect(judgmentRuleVerdict('field-label', { identifier: 'memberId', koreanLabel: 'member Id' })).toBe('untranslated');
    expect(judgmentRuleVerdict('field-label', { identifier: 'memberId', koreanLabel: 'MEMBER_ID' })).toBe('untranslated');
    expect(judgmentRuleVerdict('field-label', { identifier: 'memberId', koreanLabel: '회원 ID' })).toBeNull();
    expect(judgmentRuleVerdict('business-name', { method: 'GET', path: '/a', businessName: ' ' })).toBe('empty');
    expect(looksUntranslated('useYn', '사용 여부')).toBe(false);
  });

  it('never flags in observe mode and applies the bands in active mode', () => {
    const policy = { passAt: 0.7, flagAt: 0.3 };
    expect(judgmentVerdict(0.01, policy, 'observe')).toEqual({ verdict: 'review', reason: 'observe' });
    expect(judgmentVerdict(0.01, policy, 'active')).toEqual({ verdict: 'flag', reason: 'disagrees' });
    expect(judgmentVerdict(0.5, policy, 'active')).toEqual({ verdict: 'review', reason: 'uncertain' });
    expect(judgmentVerdict(0.7, policy, 'active')).toEqual({ verdict: 'pass', reason: 'agrees' });
  });
});

describe('judgment policy from labels', () => {
  const separable = [
    ...Array.from({ length: 15 }, (_, i) => ({ correct: true, probability: 0.8 + i / 100 })),
    ...Array.from({ length: 10 }, (_, i) => ({ correct: false, probability: 0.05 + i / 100 })),
  ];
  it('suggests a flag band whose flags are mostly incorrect items', () => {
    const suggested = suggestJudgmentPolicy(separable)!;
    expect(suggested.flagAt).toBeLessThan(suggested.passAt);
    // The widest band that still meets the 0.8 flag-precision target: every incorrect item is caught.
    expect(suggested.flagPrecision!).toBeGreaterThanOrEqual(0.8);
    expect(suggested.flagRecall).toBe(1);
    expect(judgmentAuc(separable)).toBe(1);
  });

  it('suggests nothing below the evidence minimum, without both classes, or for a model at chance', () => {
    expect(suggestJudgmentPolicy(separable.slice(0, 10))).toBeNull();
    expect(suggestJudgmentPolicy(separable.filter((l) => l.correct).concat(separable.filter((l) => l.correct)))).toBeNull();
    // A confidently wrong model: incorrect items scored high, correct ones low.
    const inverted = separable.map((l) => ({ ...l, correct: !l.correct }));
    expect(suggestJudgmentPolicy(inverted)).toBeNull();
    expect(judgmentAuc(inverted)).toBe(0);
  });

  it('measures coverage, accuracy, flag precision and recall at a policy', () => {
    const outcome = judgmentPolicyOutcome([
      { correct: true, probability: 0.9 }, { correct: false, probability: 0.9 },
      { correct: false, probability: 0.1 }, { correct: true, probability: 0.5 },
    ], { passAt: 0.7, flagAt: 0.3 });
    expect(outcome).toEqual({ coverage: 0.75, accuracy: 2 / 3, flagPrecision: 1, flagRecall: 0.5 });
  });

  it('writes the laya-train / laya-evals line shape', () => {
    expect(JSON.parse(judgmentDatasetLine({ kind: 'business-name', subject: { method: 'POST', path: '/api/v1/orders', businessName: '주문 등록' }, correct: true })))
      .toEqual({ state: { method: 'POST', path: '/api/v1/orders', business_name: '주문 등록' },
        questions: { fits: { type: 'noul', instructions: expect.any(String) } }, expected: { fits: true } });
  });
});
