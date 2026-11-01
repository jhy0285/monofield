import { writeFile } from 'node:fs/promises';

const USAGE = `Usage:
  monofield judge check     --project <id> --input <spec.interface-spec.json> [--kinds field-label,business-name] [--allow-hosted] [--json]
  monofield judge feedback  --kind field-label --identifier <id> --label <한글명> --correct yes|no [--probability 0.42] [--json]
  monofield judge feedback  --kind business-name --method POST --path /api/v1/orders --name <업무명> --correct yes|no [--probability 0.9] [--json]
  monofield judge scorecard [--json]
  monofield judge policy    --kind <field-label|business-name> --apply|--observe [--json]
  monofield judge export    [--kind <kind>] [--seed train|heldout|all] [--out <file.jsonl>]

A System One model (TypeSafe JEV or a local Laya server, configured with
"monofield jev configure") checks the Korean field labels and business names
of an interface specification. Rules run first; the model is asked the rest.
Every model+question pair starts in observe mode: answers are shown, never
flagged. Label items with "feedback", read the "scorecard", and "policy
--apply" the suggested thresholds once the labels support them. "export" writes
the labels as laya-train / laya-evals JSONL; "export --seed train" writes the
built-in SI seed set instead ("--seed heldout" uses fields and resources the
train split never contains), for training a local judge with laya-train.`;

export async function runJudgeCli(args: string[], helpers: {
  baseUrl: (flags: Record<string, unknown>) => Promise<string>;
  parseFlags: (args: string[], options: { string: Set<string>; boolean: Set<string> }) => Record<string, unknown>;
  positionalArgs: (args: string[], stringFlags: Set<string>) => string[];
}): Promise<void> {
  const strings = new Set(['daemon-url', 'project', 'input', 'kinds', 'kind', 'identifier', 'label', 'method', 'path', 'name', 'correct', 'probability', 'out', 'seed']);
  const flags = helpers.parseFlags(args, { string: strings, boolean: new Set(['json', 'help', 'allow-hosted', 'apply', 'observe']) });
  const [command] = helpers.positionalArgs(args, strings);
  if (flags.help || !command || !['check', 'feedback', 'scorecard', 'policy', 'export'].includes(command)) {
    console.log(USAGE);
    if (!flags.help) throw new Error('Unknown judge command.');
    return;
  }
  const base = (await helpers.baseUrl(flags)).replace(/\/$/, '');
  const call = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${base}${path}`, init);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(payload.error?.message ?? `Judge HTTP ${response.status}`);
    }
    return response;
  };
  const json = (body: unknown) => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

  if (command === 'check') {
    if (typeof flags.project !== 'string' || typeof flags.input !== 'string') throw new Error('check requires --project and --input.');
    const kinds = typeof flags.kinds === 'string' ? flags.kinds.split(',').map((k) => k.trim()).filter(Boolean) : undefined;
    const result = await (await call(`/api/projects/${encodeURIComponent(flags.project)}/judgments/check`, { method: 'POST',
      ...json({ inputFile: flags.input, ...(kinds ? { kinds } : {}), ...(flags['allow-hosted'] ? { allowHosted: true } : {}) }) })).json() as {
      summary: { total: number; pass: number; review: number; flag: number }; modelStatus: string; model: string;
      items: Array<{ verdict: string; kind: string; subject: Record<string, string>; probability: number | null; reason?: string }>;
    };
    if (flags.json) { print(result); return; }
    console.log(`${result.model} (${result.modelStatus}): ${result.summary.flag} flag · ${result.summary.review} review · ${result.summary.pass} pass of ${result.summary.total}`);
    for (const item of result.items.filter((i) => i.verdict !== 'pass')) {
      const what = item.kind === 'field-label' ? `${item.subject.identifier} → ${item.subject.koreanLabel}` : `${item.subject.method} ${item.subject.path} → ${item.subject.businessName}`;
      console.log(`  ${item.verdict.padEnd(6)} ${item.probability === null ? '  -  ' : item.probability.toFixed(2)} ${what}${item.reason ? `  (${item.reason})` : ''}`);
    }
    return;
  }
  if (command === 'feedback') {
    const kind = flags.kind;
    if (kind !== 'field-label' && kind !== 'business-name') throw new Error('feedback requires --kind field-label or business-name.');
    if (flags.correct !== 'yes' && flags.correct !== 'no') throw new Error('feedback requires --correct yes or no.');
    const status = await (await call('/api/jev/status')).json() as { config: { backend: string; model: string } };
    const subject = kind === 'field-label'
      ? { identifier: flags.identifier, koreanLabel: flags.label ?? '' }
      : { method: flags.method, path: flags.path, businessName: flags.name ?? '' };
    const probability = typeof flags.probability === 'string' ? Number(flags.probability) : null;
    print(await (await call('/api/judgments/feedback', { method: 'POST', ...json({ kind, subject, correct: flags.correct === 'yes', probability,
      backend: status.config.backend, model: status.config.model }) })).json());
    return;
  }
  if (command === 'scorecard') { print(await (await call('/api/judgments/scorecard')).json()); return; }
  if (command === 'policy') {
    if (Boolean(flags.apply) === Boolean(flags.observe)) throw new Error('policy requires exactly one of --apply or --observe.');
    print(await (await call('/api/judgments/policy', { method: 'PUT', ...json({ kind: flags.kind, mode: flags.apply ? 'active' : 'observe' }) })).json());
    return;
  }
  const query = new URLSearchParams();
  if (typeof flags.kind === 'string') query.set('kind', flags.kind);
  if (typeof flags.seed === 'string') query.set('seed', flags.seed);
  const text = await (await call(`/api/judgments/dataset${query.size ? `?${query}` : ''}`)).text();
  if (typeof flags.out === 'string') {
    await writeFile(flags.out, text, 'utf8');
    print({ out: flags.out, lines: text ? text.trimEnd().split('\n').length : 0 });
  } else process.stdout.write(text);
}
