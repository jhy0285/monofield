import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_JUDGMENT_POLICY,
  JUDGMENT_KINDS,
  JUDGMENT_MIN_LABELS_FOR_POLICY,
  JUDGMENT_TARGET_FLAG_PRECISION,
  judgmentAuc,
  judgmentDatasetLine,
  judgmentItemsFromDocument,
  judgmentPolicyOutcome,
  judgmentQuestion,
  judgmentQuestionId,
  judgmentRuleVerdict,
  judgmentState,
  judgmentVerdict,
  suggestJudgmentPolicy,
  type InterfaceSpecDocument,
  type JevConfig,
  type JudgmentCheckResponse,
  type JudgmentItem,
  type JudgmentKind,
  type JudgmentLabel,
  type JudgmentPolicyEntry,
  type JudgmentScore,
  type JudgmentScorecard,
  type JudgmentSubject,
} from '@open-design/contracts';
import { evaluateJevStates, JevError, readJevConfig } from '../integrations/jev.js';

/** Judgment state lives under the daemon data root: labels are the reviewer's ground truth. */
const dir = (dataDir: string) => path.join(dataDir, 'judgments');
const labelsFile = (dataDir: string) => path.join(dir(dataDir), 'labels.jsonl');
const policiesFile = (dataDir: string) => path.join(dir(dataDir), 'policies.json');
const MAX_ITEMS = 600;
const MAX_TEXT = 200;
const fail = (message: string): never => { throw new JevError('INVALID_REQUEST', message); };

type PolicyStore = Record<string, JudgmentPolicyEntry>;
const policyKey = (kind: JudgmentKind, backend: string, model: string) => `${kind}\u0000${backend}\u0000${model}`;

export async function readJudgmentPolicies(dataDir: string): Promise<PolicyStore> {
  try {
    const raw = JSON.parse(await readFile(policiesFile(dataDir), 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw as PolicyStore;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

/** A pair with no applied policy observes: its probabilities are shown, never turned into flags. */
export function policyFor(store: PolicyStore, kind: JudgmentKind, backend: JevConfig['backend'], model: string): JudgmentPolicyEntry {
  return store[policyKey(kind, backend, model)]
    ?? { kind, backend, model, mode: 'observe', ...DEFAULT_JUDGMENT_POLICY, appliedAt: null, basedOnLabels: 0 };
}

async function writeAtomic(file: string, text: string) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, text, { mode: 0o600 });
  await rename(tmp, file);
}

function cleanText(value: unknown, name: string, required = false): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || value.length > MAX_TEXT || (required && !value.trim())) return fail(`${name} must be text of at most ${MAX_TEXT} characters.`);
  return value;
}

export function validateJudgmentSubject(kind: JudgmentKind, value: unknown): JudgmentSubject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('subject is required.');
  const v = value as Record<string, unknown>;
  if (kind === 'field-label') {
    return { identifier: cleanText(v.identifier, 'identifier', true)!, koreanLabel: cleanText(v.koreanLabel ?? '', 'koreanLabel')! };
  }
  return { method: cleanText(v.method, 'method', true)!.toUpperCase(), path: cleanText(v.path, 'path', true)!, businessName: cleanText(v.businessName ?? '', 'businessName')! };
}

export function validateJudgmentKinds(value: unknown): JudgmentKind[] {
  if (value === undefined) return [...JUDGMENT_KINDS];
  if (!Array.isArray(value) || !value.length || value.some((k) => !JUDGMENT_KINDS.includes(k as JudgmentKind))) return fail(`kinds must list ${JUDGMENT_KINDS.join(', ')}.`);
  return [...new Set(value as JudgmentKind[])];
}

/**
 * Runs the judgment check over one interface specification. Rules decide what
 * code can decide; the configured System One backend is asked the rest in one
 * batch per kind. A failing or slow model never fails the check: its items stay
 * for review and the response says why.
 */
export async function runJudgmentCheck(dataDir: string, input: {
  doc: InterfaceSpecDocument; inputFile: string; contentSha256: string; kinds?: unknown; allowHosted?: unknown; signal?: AbortSignal;
  evaluate?: typeof evaluateJevStates; timeoutMs?: number;
}): Promise<JudgmentCheckResponse> {
  const started = performance.now();
  const kinds = validateJudgmentKinds(input.kinds);
  if (input.allowHosted !== undefined && typeof input.allowHosted !== 'boolean') fail('allowHosted must be true or false.');
  const config = await readJevConfig(dataDir);
  const store = await readJudgmentPolicies(dataDir);
  const policies = Object.fromEntries(JUDGMENT_KINDS.map((kind) => [kind, policyFor(store, kind, config.backend, config.model)])) as Record<JudgmentKind, JudgmentPolicyEntry>;
  const base = judgmentItemsFromDocument(input.doc, kinds);
  if (base.length > MAX_ITEMS) fail(`The document has ${base.length} items to judge; the limit is ${MAX_ITEMS}. Judge one kind at a time.`);

  const items: JudgmentItem[] = base.map((item) => {
    const rule = judgmentRuleVerdict(item.kind, item.subject);
    return rule ? { ...item, verdict: 'flag', source: 'rule', probability: null, reason: rule }
      : { ...item, verdict: 'review', source: 'none', probability: null };
  });
  const pending = items.filter((item) => item.source === 'none');
  let modelStatus: JudgmentCheckResponse['modelStatus'] = pending.length ? 'answered' : 'not-needed';
  let modelCalls = 0;
  if (pending.length && config.backend === 'typesafe' && input.allowHosted !== true) {
    modelStatus = 'hosted-not-allowed';
  } else if (pending.length) {
    const timeoutMs = input.timeoutMs ?? 60_000;
    try {
      for (const kind of kinds) {
        const group = pending.filter((item) => item.kind === kind);
        if (!group.length) continue;
        // The same field often appears on several endpoints: ask each distinct state once.
        const keys = group.map((item) => JSON.stringify(judgmentState(kind, item.subject)));
        const unique = [...new Set(keys)];
        const evaluation = await (input.evaluate ?? evaluateJevStates)(dataDir, {
          model: config.model, questions: judgmentQuestion(kind),
          states: unique.map((key) => JSON.parse(key) as Record<string, string>),
        }, { config, timeoutMs, ...(input.signal ? { signal: input.signal } : {}) });
        modelCalls += evaluation.calls;
        const qid = judgmentQuestionId(kind);
        group.forEach((item, index) => {
          const answer = evaluation.results[unique.indexOf(keys[index]!)]?.answers[qid];
          if (answer?.type !== 'noul') return;
          item.probability = Math.round(answer.noul * 10000) / 10000;
          item.source = 'model';
          const decided = judgmentVerdict(item.probability, policies[kind], policies[kind].mode);
          item.verdict = decided.verdict; item.reason = decided.reason;
        });
      }
    } catch (error) {
      const timeout = error instanceof JevError && error.code === 'TIMEOUT';
      modelStatus = timeout ? 'timeout' : 'unavailable';
      for (const item of pending) if (item.source === 'none') item.reason = timeout ? 'model-timeout' : 'model-unavailable';
    }
  }
  const order: Record<JudgmentItem['verdict'], number> = { flag: 0, review: 1, pass: 2 };
  items.sort((a, b) => order[a.verdict] - order[b.verdict] || (a.probability ?? -1) - (b.probability ?? -1));
  const summary = { total: items.length, pass: 0, review: 0, flag: 0 };
  for (const item of items) summary[item.verdict]++;
  return { ok: true, inputFile: input.inputFile, contentSha256: input.contentSha256, backend: config.backend, model: config.model,
    modelStatus, policies, items, summary, elapsedMs: Math.round(performance.now() - started), modelCalls, advisory: true };
}

export async function recordJudgmentFeedback(dataDir: string, value: unknown): Promise<JudgmentLabel> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('Feedback is required.');
  const v = value as Record<string, unknown>;
  if (!JUDGMENT_KINDS.includes(v.kind as JudgmentKind)) return fail('kind is invalid.');
  const kind = v.kind as JudgmentKind;
  if (typeof v.correct !== 'boolean') return fail('correct must be true or false.');
  if (v.probability !== null && (typeof v.probability !== 'number' || !Number.isFinite(v.probability) || v.probability < 0 || v.probability > 1)) return fail('probability must be null or between 0 and 1.');
  if (!['typesafe', 'local'].includes(String(v.backend))) return fail('backend is invalid.');
  const label: JudgmentLabel = {
    kind, subject: validateJudgmentSubject(kind, v.subject), correct: v.correct, probability: v.probability as number | null,
    backend: v.backend as JevConfig['backend'], model: cleanText(v.model, 'model', true)!,
    ...(typeof v.projectId === 'string' && v.projectId.length <= 200 ? { projectId: v.projectId } : {}),
    ...(typeof v.inputFile === 'string' && v.inputFile.length <= 1024 ? { inputFile: v.inputFile } : {}),
    at: new Date().toISOString(),
  };
  await mkdir(dir(dataDir), { recursive: true, mode: 0o700 });
  await appendFile(labelsFile(dataDir), `${JSON.stringify(label)}\n`, { mode: 0o600 });
  return label;
}

export async function readJudgmentLabels(dataDir: string): Promise<JudgmentLabel[]> {
  let text: string;
  try { text = await readFile(labelsFile(dataDir), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const latest = new Map<string, JudgmentLabel>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const label = JSON.parse(line) as JudgmentLabel;
      if (!JUDGMENT_KINDS.includes(label.kind)) continue;
      // The latest decision about the same subject under the same model wins.
      latest.set(JSON.stringify([label.kind, label.backend, label.model, judgmentState(label.kind, label.subject)]), label);
    } catch { /* a torn line is skipped */ }
  }
  return [...latest.values()];
}

export async function judgmentScorecard(dataDir: string): Promise<JudgmentScorecard> {
  const [labels, store, config] = await Promise.all([readJudgmentLabels(dataDir), readJudgmentPolicies(dataDir), readJevConfig(dataDir)]);
  const groups = new Map<string, JudgmentLabel[]>();
  for (const label of labels) {
    const key = policyKey(label.kind, label.backend, label.model);
    groups.set(key, [...(groups.get(key) ?? []), label]);
  }
  for (const kind of JUDGMENT_KINDS) {
    const key = policyKey(kind, config.backend, config.model);
    if (!groups.has(key)) groups.set(key, []);
  }
  const scores: JudgmentScore[] = [...groups.entries()].map(([key, group]) => {
    const [kind, backend, model] = key.split('\u0000') as [JudgmentKind, JevConfig['backend'], string];
    const answered = group.filter((l) => typeof l.probability === 'number') as Array<JudgmentLabel & { probability: number }>;
    const pairs = answered.map((l) => ({ correct: l.correct, probability: l.probability }));
    const policy = policyFor(store, kind, backend, model);
    return { kind, backend, model, labels: group.length, answered: answered.length,
      correctItems: group.filter((l) => l.correct).length, incorrectItems: group.filter((l) => !l.correct).length,
      auc: judgmentAuc(pairs), current: judgmentPolicyOutcome(pairs, policy), suggested: suggestJudgmentPolicy(pairs), mode: policy.mode };
  });
  scores.sort((a, b) => a.kind.localeCompare(b.kind) || a.model.localeCompare(b.model));
  return { scores, minLabelsForPolicy: JUDGMENT_MIN_LABELS_FOR_POLICY, targetFlagPrecision: JUDGMENT_TARGET_FLAG_PRECISION };
}

/**
 * Applies the suggested policy for the current backend and model, or returns
 * the pair to observe mode. Applying requires a suggestion: thresholds come
 * from the reviewer's labels, never from a default.
 */
export async function setJudgmentPolicy(dataDir: string, value: unknown): Promise<JudgmentPolicyEntry> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('A policy request is required.');
  const v = value as Record<string, unknown>;
  if (!JUDGMENT_KINDS.includes(v.kind as JudgmentKind)) return fail('kind is invalid.');
  if (v.mode !== 'observe' && v.mode !== 'active') return fail('mode must be observe or active.');
  const kind = v.kind as JudgmentKind;
  const config = await readJevConfig(dataDir);
  const store = await readJudgmentPolicies(dataDir);
  let entry: JudgmentPolicyEntry;
  if (v.mode === 'observe') {
    entry = { ...policyFor(store, kind, config.backend, config.model), mode: 'observe', appliedAt: new Date().toISOString() };
  } else {
    const score = (await judgmentScorecard(dataDir)).scores.find((s) => s.kind === kind && s.backend === config.backend && s.model === config.model);
    if (!score?.suggested) return fail(`Not enough labelled evidence to apply a policy for ${kind} on ${config.model}. Label at least ${JUDGMENT_MIN_LABELS_FOR_POLICY} items, including incorrect ones, until a suggestion appears.`);
    entry = { kind, backend: config.backend, model: config.model, mode: 'active', passAt: score.suggested.passAt, flagAt: score.suggested.flagAt,
      appliedAt: new Date().toISOString(), basedOnLabels: score.answered };
  }
  store[policyKey(kind, config.backend, config.model)] = entry;
  await writeAtomic(policiesFile(dataDir), JSON.stringify(store, null, 2));
  return entry;
}

/** The labels as laya-train / laya-evals JSONL: the reviewer's decisions train and evaluate a local judge. */
export async function exportJudgmentDataset(dataDir: string, kind?: unknown): Promise<string> {
  if (kind !== undefined && !JUDGMENT_KINDS.includes(kind as JudgmentKind)) fail('kind is invalid.');
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const label of await readJudgmentLabels(dataDir)) {
    if (kind && label.kind !== kind) continue;
    const line = judgmentDatasetLine(label);
    if (seen.has(line)) continue;
    seen.add(line); lines.push(line);
  }
  return lines.length ? `${lines.join('\n')}\n` : '';
}
