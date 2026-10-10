import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JevRequest, VerificationCheck, VerificationSource } from '@open-design/contracts';
import { writeJevConfig } from '../src/integrations/jev.js';
import { suggestVerification } from '../src/services/verification-advice.js';

const checks: VerificationCheck[] = [{ id: 'node:test', label: 'test', kind: 'test', command: 'npm',
  args: ['run', 'test'], source: 'package.json', script: 'node --test PRIVATE_SOURCE', recommended: true }];
const source: VerificationSource = { scope: 'git-visible-worktree', head: null, digest: 'digest', fileCount: 1, reason: null };
describe('verification advisor through the real local provider transport (fixture, not model quality)', () => {
  let server: Server, data: string, received: JevRequest[], invalid: boolean;
  beforeEach(async () => {
    data = await mkdtemp(join(tmpdir(), 'mf-advice-provider-')); received = []; invalid = false;
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const request = JSON.parse(Buffer.concat(chunks).toString('utf8')) as JevRequest; received.push(request);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ model: 'fixture', usage: { input_tokens: 87, output_tokens: 0 }, answers: {
        priority: { type: 'choice', choice: invalid ? 'C99' : 'C1', confidence: 0.96, probabilities: { C1: 0.96, NONE: 0.04 } },
        fit_C1: { type: 'noul', noul: 0.94 },
      } }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No fixture port');
    await writeJevConfig(data, { backend: 'local', model: 'fixture', localBaseUrl: `http://127.0.0.1:${address.port}` });
  });
  afterEach(async () => {
    server?.closeAllConnections();
    if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    if (data) await rm(data, { recursive: true, force: true });
  });
  const suggest = () => suggestVerification(data, 'cwd', '.', { request: 'Verify a corrected subtotal', mode: 'model' },
    { discover: async () => checks, source: async () => source });
  it('uses the configured backend, sends one closed request and reports the transport response usage', async () => {
    const result = await suggest();
    expect(received).toHaveLength(1);
    expect(Object.keys(received[0]!.questions)).toEqual(['priority', 'fit_C1']);
    expect(received[0]!.model).toBe('fixture');
    expect(JSON.stringify(received)).not.toContain('PRIVATE_SOURCE');
    expect(result).toMatchObject({ reason: 'model', priorityCheckId: 'node:test', usage: { input_tokens: 87, output_tokens: 0 } });
  });
  it('rejects an unregistered provider choice at protocol validation and offers defaults', async () => {
    invalid = true; const result = await suggest();
    expect(received).toHaveLength(1);
    expect(result).toMatchObject({ reason: 'provider-unavailable', suggestedCheckIds: ['node:test'], priorityCheckId: null, usage: null });
  });
});
