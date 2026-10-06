import { describe, expect, it } from 'vitest';
import { completedAnswer, summarizeSamples, type Sample } from '../../lib/token-benchmark/scoring.js';
import { providerUsage } from '../../lib/token-benchmark/usage.js';

describe('real Codex answer scoring', () => {
  it('separates progress from the final answer without discarding the transcript', () => {
    expect(completedAnswer(['I’ll read totals.ts.', '\nsumValues']))
      .toEqual({ answer: 'sumValues', transcript: 'I’ll read totals.ts.\n\nsumValues' });
  });

  it('scores the final answer even when an earlier message mentioned the expected answer', () => {
    expect(completedAnswer(['Maybe sumValues.', 'wrongFunction']).answer).toBe('wrongFunction');
    expect(completedAnswer([]).answer).toBe('');
  });

  function sample(lane: 'direct' | 'monofield', task: string, correct = true): Sample {
    return { pair: 0, lane, task, elapsedMs: 1, usage: providerUsage({ input_tokens: 100, cached_input_tokens: 50, output_tokens: 5 }),
      answer: 'answer', transcript: 'progress\nanswer', correct, formatCompliant: false };
  }
  const tasks = ['first', 'resume', 'review'];
  const complete = () => tasks.flatMap(task => [sample('direct', task), sample('monofield', task)]);

  it('compares complete correct pairs and reports output format separately', () => {
    const result = summarizeSamples(complete(), 1);
    expect(result.completePairs).toBe(1);
    expect(result.comparison?.input).toMatchObject({ direct: 300, monofield: 300, difference: 0 });
    expect(result.quality.direct).toMatchObject({ correct: 3, formatCompliant: 0 });
  });

  it('also compares only pairs satisfying both final-answer and full-output format requirements', () => {
    const samples = complete();
    expect(summarizeSamples(samples, 1).formatComparison).toBeNull();
    samples.forEach(sample => { sample.formatCompliant = true; });
    expect(summarizeSamples(samples, 1).formatCompletePairs).toBe(1);
    expect(summarizeSamples(samples, 1).formatComparison?.input).toMatchObject({ direct: 300, monofield: 300 });
  });

  it('keeps quality failures visible and excludes their pair from token comparisons', () => {
    const samples = complete();
    samples[0]!.correct = false;
    const result = summarizeSamples(samples, 1);
    expect(result.completePairs).toBe(0);
    expect(result.comparison).toBeNull();
    expect(result.quality.direct).toMatchObject({ completed: 3, correct: 2 });
  });

  it('does not compare incomplete or duplicate task sets', () => {
    expect(summarizeSamples(complete().slice(1), 1).comparison).toBeNull();
    const duplicates = complete();
    duplicates.find(sample => sample.lane === 'direct' && sample.task === 'review')!.task = 'first';
    expect(summarizeSamples(duplicates, 1).comparison).toBeNull();
  });
});
