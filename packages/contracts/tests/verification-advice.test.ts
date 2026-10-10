import { describe, expect, it } from 'vitest';
import { buildVerificationAdviceRequest, verificationManualReview } from '../src/api/verification-advice.js';
import type { VerificationCheck } from '../src/api/verification.js';

const checks: VerificationCheck[] = [{ id: 'node:test', label: 'test', kind: 'test', command: 'npm',
  args: ['run', 'test'], source: 'package.json', script: 'PRIVATE_SCRIPT_TOKEN', recommended: true }];
describe('closed verification fan-out contract', () => {
  it('asks priority and candidate relevance in one request without source, commands or scripts', () => {
    const request = buildVerificationAdviceRequest('Fix checkout totals', checks, 'local-model');
    expect(Object.keys(request.questions)).toEqual(['priority', 'fit_C1']);
    expect(request.questions.priority).toMatchObject({ type: 'choice', criteria: { C1: expect.any(String), NONE: expect.any(String) } });
    expect(request.questions.fit_C1).toMatchObject({ type: 'noul' });
    expect(JSON.stringify(request)).not.toContain('PRIVATE_SCRIPT_TOKEN');
    expect(JSON.stringify(request)).not.toContain('"command"');
    expect(JSON.stringify(request)).not.toContain('"args"');
  });
  it.each(['애플 클론 화면을 반응형으로 수정', 'Adjust UI button layout', 'Improve keyboard accessibility'])('adds observed browser review reminders for %s', request => {
    expect(verificationManualReview(request)).toEqual(['browser', 'keyboard', 'responsive', 'contrast']);
  });
  it('does not add visual review to a plain backend brief', () => {
    expect(verificationManualReview('Correct database transaction rollback')).toEqual([]);
  });
});
