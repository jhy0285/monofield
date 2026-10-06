import type { Usage } from './usage.js';

export type Lane = 'direct' | 'monofield';
export type Sample = {
  pair: number; lane: Lane; task: string; elapsedMs: number; usage: Usage;
  answer: string; transcript: string; correct: boolean; formatCompliant: boolean;
  promptContext?: unknown; sessionId?: string;
};

/** Codex emits whole completed messages; progress messages precede the final answer. */
export function completedAnswer(messages: string[]): { answer: string; transcript: string } {
  return { answer: messages.at(-1)?.trim() ?? '', transcript: messages.join('\n').trim() };
}

export function summarizeSamples(samples: Sample[], pairs: number) {
  const tasks = ['first', 'resume', 'review'];
  const complete = Array.from({ length: pairs }, (_, pair) => ({ pair,
    direct: samples.filter(sample => sample.pair === pair && sample.lane === 'direct'),
    monofield: samples.filter(sample => sample.pair === pair && sample.lane === 'monofield'),
  })).filter(pair => ['direct', 'monofield'].every(lane => {
    const laneSamples = pair[lane as Lane];
    return laneSamples.length === tasks.length && tasks.every(task => laneSamples.some(s => s.task === task))
      && laneSamples.every(sample => sample.correct);
  }));
  const compare = (selected: typeof complete) => selected.length ? Object.fromEntries(
    (['input', 'cached', 'uncached', 'output', 'total'] as const).map(key => {
      const total = (lane: Lane) => selected.reduce((sum, pair) =>
        sum + pair[lane].reduce((n, sample) => n + sample.usage[key], 0), 0);
      const direct = total('direct'), monofield = total('monofield');
      return [key, { direct, monofield, difference: monofield - direct,
        changePercent: direct ? 100 * (monofield - direct) / direct : null }];
    })) : null;
  const quality = Object.fromEntries((['direct', 'monofield'] as const).map(lane => {
    const completed = samples.filter(sample => sample.lane === lane);
    const correct = completed.filter(sample => sample.correct).length;
    const formatCompliant = completed.filter(sample => sample.formatCompliant).length;
    return [lane, { completed: completed.length, correct, accuracy: completed.length ? correct / completed.length : null,
      formatCompliant, formatAccuracy: completed.length ? formatCompliant / completed.length : null }];
  }));
  const formatComplete = complete.filter(pair => [...pair.direct, ...pair.monofield].every(sample => sample.formatCompliant));
  return { completePairs: complete.length, comparison: compare(complete), quality,
    formatCompletePairs: formatComplete.length, formatComparison: compare(formatComplete) };
}
