import type { InterfaceSpecDocument } from '../docs/interface-spec.js';
import type { JevConfig, JevQuestion } from './jev.js';

/**
 * Judgment checks: a System One model (TypeSafe JEV or a local Laya server)
 * answers narrow yes/no questions about items an AI agent wrote into an
 * interface specification, the "verify the extractions of any other AI" use
 * the providers document. Cheap deterministic rules run first, in code.
 *
 * Adoption is staged as both providers recommend: a model+question pair starts
 * in `observe` mode, where its opinion is shown but never flags an item. The
 * reviewer's "correct"/"incorrect" labels build a scorecard, and only an
 * explicitly applied policy (`active`) turns probabilities into flags.
 */
export type JudgmentKind = 'field-label' | 'business-name';
export const JUDGMENT_KINDS: readonly JudgmentKind[] = ['field-label', 'business-name'];

/** pass: the model agrees; review: uncertain or observe mode; flag: the model or a rule disagrees. */
export type JudgmentVerdict = 'pass' | 'review' | 'flag';
export type JudgmentMode = 'observe' | 'active';

export interface JudgmentSubject {
  /** field-label */
  identifier?: string;
  koreanLabel?: string;
  /** business-name */
  method?: string;
  path?: string;
  businessName?: string;
}

export interface JudgmentItem {
  /** Stable within a document: kind, endpoint and field path. */
  id: string;
  kind: JudgmentKind;
  endpoint: { method: string; path: string; interfaceId: string };
  field?: { side: 'request' | 'response'; path: string };
  subject: JudgmentSubject;
  verdict: JudgmentVerdict;
  source: 'rule' | 'model' | 'none';
  /** Probability that the item is correct (the noul "yes"), when a model answered. */
  probability: number | null;
  /** A short machine reason for rule verdicts or skipped model calls. */
  reason?: 'empty' | 'untranslated' | 'model-unavailable' | 'model-timeout' | 'observe' | 'uncertain' | 'agrees' | 'disagrees';
}

export interface JudgmentPolicy {
  /** Probability at or above which the item passes. */
  passAt: number;
  /** Probability at or below which the item is flagged. */
  flagAt: number;
}
/** TypeSafe's documented starting point for noul answers: 0.7 for yes, 0.3 for no. */
export const DEFAULT_JUDGMENT_POLICY: JudgmentPolicy = { passAt: 0.7, flagAt: 0.3 };

export interface JudgmentPolicyEntry extends JudgmentPolicy {
  kind: JudgmentKind;
  backend: JevConfig['backend'];
  model: string;
  mode: JudgmentMode;
  appliedAt: string | null;
  /** The labelled evidence the policy was chosen from. */
  basedOnLabels: number;
}

export interface JudgmentCheckRequest {
  inputFile: string;
  kinds?: JudgmentKind[];
  /** Hosted JEV receives identifiers, labels and paths; the caller must allow it explicitly. */
  allowHosted?: boolean;
}

export interface JudgmentCheckResponse {
  ok: true;
  inputFile: string;
  contentSha256: string;
  backend: JevConfig['backend'];
  model: string;
  /** Whether the System One backend answered; every other state leaves model items for review. */
  modelStatus: 'answered' | 'unavailable' | 'timeout' | 'hosted-not-allowed' | 'not-needed';
  policies: Record<JudgmentKind, JudgmentPolicyEntry>;
  items: JudgmentItem[];
  summary: { total: number; pass: number; review: number; flag: number };
  elapsedMs: number;
  modelCalls: number;
  advisory: true;
}

export interface JudgmentFeedbackRequest {
  kind: JudgmentKind;
  subject: JudgmentSubject;
  /** The reviewer's ground truth: is the item correct as written? */
  correct: boolean;
  /** What the model said when the reviewer decided, so the scorecard can compare. */
  probability: number | null;
  backend: JevConfig['backend'];
  model: string;
  projectId?: string;
  inputFile?: string;
}

export interface JudgmentLabel extends JudgmentFeedbackRequest {
  at: string;
}

export interface JudgmentScore {
  kind: JudgmentKind;
  backend: JevConfig['backend'];
  model: string;
  labels: number;
  /** Labels the model answered (with a probability). */
  answered: number;
  correctItems: number;
  incorrectItems: number;
  /** Rank quality of the probability (0.5 is chance), null without both classes. */
  auc: number | null;
  /** At the current policy. */
  current: JudgmentPolicyOutcome;
  /** The policy suggested from the labels, null below the minimum evidence. */
  suggested: (JudgmentPolicy & JudgmentPolicyOutcome) | null;
  mode: JudgmentMode;
}

export interface JudgmentPolicyOutcome {
  /** Share of labelled items that would be passed or flagged (not left for review). */
  coverage: number;
  /** Share of decided items whose verdict matched the reviewer (pass on correct, flag on incorrect). */
  accuracy: number | null;
  /** Flags that were actually incorrect items, over all flags. */
  flagPrecision: number | null;
  /** Incorrect items the policy caught, over all incorrect items. */
  flagRecall: number | null;
}

export interface JudgmentScorecard {
  scores: JudgmentScore[];
  minLabelsForPolicy: number;
  targetFlagPrecision: number;
}

export const JUDGMENT_MIN_LABELS_FOR_POLICY = 20;
export const JUDGMENT_TARGET_FLAG_PRECISION = 0.8;

const FIELD_LABEL_INSTRUCTIONS = 'Does the Korean field label mean the same thing as the English identifier? Answer yes only if a Korean developer would accept this label for this field.';
const BUSINESS_NAME_INSTRUCTIONS = 'Does the Korean business name correctly describe what this HTTP endpoint does?';

/** One question per kind. The wording is part of the trained and evaluated contract; change it with a new evaluation. */
export function judgmentQuestion(kind: JudgmentKind): Record<string, JevQuestion> {
  return kind === 'field-label'
    ? { match: { type: 'noul', instructions: FIELD_LABEL_INSTRUCTIONS } }
    : { fits: { type: 'noul', instructions: BUSINESS_NAME_INSTRUCTIONS } };
}
export function judgmentQuestionId(kind: JudgmentKind): 'match' | 'fits' {
  return kind === 'field-label' ? 'match' : 'fits';
}

/** The state the model sees for one item. Only the subject, never source code or file paths. */
export function judgmentState(kind: JudgmentKind, subject: JudgmentSubject): Record<string, string> {
  return kind === 'field-label'
    ? { identifier: subject.identifier ?? '', korean_label: subject.koreanLabel ?? '' }
    : { method: subject.method ?? '', path: subject.path ?? '', business_name: subject.businessName ?? '' };
}

const HANGUL = /[가-힣]/;
/** "member Id", "memberId", "MEMBER_ID": the identifier split or copied, not translated. */
export function looksUntranslated(identifier: string, label: string): boolean {
  if (HANGUL.test(label)) return false;
  const squash = (value: string) => value.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return squash(label) === squash(identifier) || /^[A-Za-z0-9 _-]+$/.test(label.trim());
}

/** Rules decide what code can decide exactly; the model is asked only the rest. */
export function judgmentRuleVerdict(kind: JudgmentKind, subject: JudgmentSubject): NonNullable<JudgmentItem['reason']> | null {
  if (kind === 'field-label') {
    const label = (subject.koreanLabel ?? '').trim();
    if (!label) return 'empty';
    if (looksUntranslated(subject.identifier ?? '', label)) return 'untranslated';
    return null;
  }
  return (subject.businessName ?? '').trim() ? null : 'empty';
}

export function judgmentItemsFromDocument(doc: InterfaceSpecDocument, kinds: readonly JudgmentKind[] = JUDGMENT_KINDS): Omit<JudgmentItem, 'verdict' | 'source' | 'probability'>[] {
  const items: Omit<JudgmentItem, 'verdict' | 'source' | 'probability'>[] = [];
  const seen = new Set<string>();
  for (const endpoint of doc.endpoints) {
    const ref = { method: endpoint.method.toUpperCase(), path: endpoint.path, interfaceId: endpoint.interfaceId };
    const endpointKey = `${ref.method} ${ref.path}`;
    if (kinds.includes('business-name')) {
      items.push({ id: `business-name:${endpointKey}`, kind: 'business-name', endpoint: ref,
        subject: { method: ref.method, path: ref.path, businessName: endpoint.interfaceName } });
    }
    if (!kinds.includes('field-label')) continue;
    for (const side of ['request', 'response'] as const) {
      for (const field of side === 'request' ? endpoint.requestFields : endpoint.responseFields) {
        const fieldPath = field.path ?? field.nameEn;
        const id = `field-label:${endpointKey}:${side}:${fieldPath}`;
        if (seen.has(id)) continue;
        seen.add(id);
        items.push({ id, kind: 'field-label', endpoint: ref, field: { side, path: fieldPath },
          subject: { identifier: field.nameEn, koreanLabel: field.nameKo } });
      }
    }
  }
  return items;
}

/** Turns a model probability into a verdict under a policy and mode. */
export function judgmentVerdict(probability: number, policy: JudgmentPolicy, mode: JudgmentMode): { verdict: JudgmentVerdict; reason: NonNullable<JudgmentItem['reason']> } {
  if (mode === 'observe') return { verdict: 'review', reason: 'observe' };
  if (probability >= policy.passAt) return { verdict: 'pass', reason: 'agrees' };
  if (probability <= policy.flagAt) return { verdict: 'flag', reason: 'disagrees' };
  return { verdict: 'review', reason: 'uncertain' };
}

export function judgmentPolicyOutcome(labels: Array<{ correct: boolean; probability: number }>, policy: JudgmentPolicy): JudgmentPolicyOutcome {
  let passed = 0, flagged = 0, right = 0, flaggedIncorrect = 0;
  const incorrect = labels.filter((label) => !label.correct).length;
  for (const label of labels) {
    if (label.probability >= policy.passAt) { passed++; if (label.correct) right++; }
    else if (label.probability <= policy.flagAt) { flagged++; if (!label.correct) { right++; flaggedIncorrect++; } }
  }
  const decided = passed + flagged;
  return {
    coverage: labels.length ? decided / labels.length : 0,
    accuracy: decided ? right / decided : null,
    flagPrecision: flagged ? flaggedIncorrect / flagged : null,
    flagRecall: incorrect ? flaggedIncorrect / incorrect : null,
  };
}

export function judgmentAuc(labels: Array<{ correct: boolean; probability: number }>): number | null {
  const pos = labels.filter((l) => l.correct).map((l) => l.probability);
  const neg = labels.filter((l) => !l.correct).map((l) => l.probability);
  if (!pos.length || !neg.length) return null;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

/**
 * Suggests a policy from labels: the widest flag band whose flags are at least
 * `targetFlagPrecision` incorrect items, and the narrowest pass band whose
 * passes are at least as accurate. Returns null below the evidence minimum or
 * when no flag band reaches the target, which keeps the pair in observe mode.
 */
export function suggestJudgmentPolicy(labels: Array<{ correct: boolean; probability: number }>,
  options: { minLabels?: number; targetFlagPrecision?: number } = {}): (JudgmentPolicy & JudgmentPolicyOutcome) | null {
  const minLabels = options.minLabels ?? JUDGMENT_MIN_LABELS_FOR_POLICY;
  const target = options.targetFlagPrecision ?? JUDGMENT_TARGET_FLAG_PRECISION;
  if (labels.length < minLabels || !labels.some((l) => !l.correct) || !labels.some((l) => l.correct)) return null;
  const grid = Array.from({ length: 19 }, (_, i) => Math.round((0.05 + i * 0.05) * 100) / 100);
  let flagAt: number | null = null;
  for (const t of grid) {
    const flagged = labels.filter((l) => l.probability <= t);
    if (flagged.length < 3) continue;
    if (flagged.filter((l) => !l.correct).length / flagged.length >= target) flagAt = t;
  }
  if (flagAt === null) return null;
  let passAt: number | null = null;
  for (const t of [...grid].reverse()) {
    if (t <= flagAt) break;
    const passed = labels.filter((l) => l.probability >= t);
    if (passed.length < 3) continue;
    if (passed.filter((l) => l.correct).length / passed.length >= target) passAt = t;
  }
  const policy = { flagAt, passAt: passAt ?? 1.01 };
  return { ...policy, ...judgmentPolicyOutcome(labels, policy) };
}

/** One laya-train / laya-evals JSONL line: the same file trains a checkpoint and evaluates it. */
export function judgmentDatasetLine(label: Pick<JudgmentLabel, 'kind' | 'subject' | 'correct'>): string {
  const question = judgmentQuestion(label.kind);
  return JSON.stringify({ state: judgmentState(label.kind, label.subject), questions: question,
    expected: { [judgmentQuestionId(label.kind)]: label.correct } });
}
