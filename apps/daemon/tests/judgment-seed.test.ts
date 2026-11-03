import { describe, expect, it } from 'vitest';
import {
  ABBREVIATION_HELDOUT_PREFIXES,
  SEED_ABBREVIATION_HELDOUT,
  SEED_ABBREVIATION_TRAIN,
  SEED_GENERIC_HELDOUT,
  SEED_GENERIC_TRAIN,
  seedJudgmentCases,
  seedJudgmentDataset,
} from '../src/services/judgment-seed.js';

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

  it('generates legacy-style abbreviations from stems, in all three spellings, with an unseen stem held out whole', () => {
    expect(SEED_ABBREVIATION_TRAIN.length).toBeGreaterThanOrEqual(60);
    expect(SEED_ABBREVIATION_HELDOUT.length).toBeGreaterThanOrEqual(25);
    const stem = (identifier: string) => identifier.toLowerCase().replace(/_/g, '').replace(/(nm|cd|no|id|stts|typ|tel|addr|dt|dtm|amt|cnt|qty|rsn|ctnt)$/, '');
    const trainStems = new Set(SEED_ABBREVIATION_TRAIN.map((c) => stem(c.identifier)));
    const heldoutStems = new Set(SEED_ABBREVIATION_HELDOUT.map((c) => stem(c.identifier)));
    for (const prefix of ABBREVIATION_HELDOUT_PREFIXES) {
      expect(heldoutStems.has(prefix), prefix).toBe(true);
      expect(trainStems.has(prefix), `${prefix} must not be trained`).toBe(false);
    }
    // The other stems are trained on and also appear held out in a new combination.
    expect([...heldoutStems].filter((s) => trainStems.has(s)).length).toBeGreaterThanOrEqual(8);
    const all = [...SEED_ABBREVIATION_TRAIN, ...SEED_ABBREVIATION_HELDOUT].map((c) => c.identifier);
    expect(all.some((id) => /^[a-z]+[A-Z][a-z]+$/.test(id))).toBe(true);
    expect(all.some((id) => /^[a-z]+_[a-z]+$/.test(id))).toBe(true);
    expect(all.some((id) => /^[A-Z]+_[A-Z]+$/.test(id))).toBe(true);
  });

  it('labels abbreviations by their stems and gives each two wrong labels of another meaning', () => {
    const cases = seedJudgmentCases({ split: 'all', kinds: ['field-label'] });
    const labelsOf = (identifier: string) => cases.filter((c) => c.subject.identifier === identifier);
    const find = (flat: string) => [...SEED_ABBREVIATION_TRAIN, ...SEED_ABBREVIATION_HELDOUT].find((c) => c.identifier.toLowerCase().replace(/_/g, '') === flat);
    expect(find('custcd')?.label).toBe('고객 코드');
    expect(find('regid')).toBeUndefined(); // already a generic train identifier, so skipped here
    expect(find('regdtm')?.label).toBe('등록일시');
    expect(find('apprnm')?.label).toBe('승인자명');
    for (const entry of [...SEED_ABBREVIATION_TRAIN, ...SEED_ABBREVIATION_HELDOUT]) {
      const rows = labelsOf(entry.identifier);
      expect(rows.filter((c) => c.correct).map((c) => c.subject.koreanLabel), entry.identifier).toEqual([entry.label]);
      const wrong = rows.filter((c) => !c.correct).map((c) => c.subject.koreanLabel!);
      expect(wrong, entry.identifier).toHaveLength(2);
      expect(new Set(wrong).size).toBe(2);
      expect(wrong).not.toContain(entry.label);
    }
    // Neither near-synonym pair is used as a "wrong" label: a date vs a date-time, a customer vs a member.
    expect(labelsOf(find('cncldt')?.identifier ?? '').some((c) => !c.correct && c.subject.koreanLabel === '취소일시')).toBe(false);
    expect(cases.some((c) => !c.correct && c.subject.identifier?.toLowerCase().startsWith('cust') && c.subject.koreanLabel?.startsWith('회원'))).toBe(false);
  });

  it('writes laya-train / laya-evals lines with the evaluated question wording', () => {
    const line = JSON.parse(seedJudgmentDataset({ split: 'heldout', kinds: ['business-name'] }).split('\n')[0]!);
    expect(Object.keys(line)).toEqual(['state', 'questions', 'expected']);
    expect(line.questions.fits.type).toBe('noul');
    expect(typeof line.expected.fits).toBe('boolean');
    expect(seedJudgmentCases({ kinds: ['field-label'] }).every((c) => c.kind === 'field-label')).toBe(true);
  });
});
