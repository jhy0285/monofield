import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { testAgentConnection } from '../../src/connectionTest.js';
import { AGENT_DEFS } from '../../src/runtimes/registry.js';
import { agentBinEnvKey } from '../../src/runtimes/executables.js';

const fixture = fileURLToPath(new URL('../fixtures/protocol-contract-cli.ts', import.meta.url));
let root: string;
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'monofield-protocol-contract-'));
  vi.stubEnv('OD_AGENT_TEST_TIMEOUT_MS', '5000');
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

// A subprocess fixture exercises real resolution, spawn, stdin/file/argv,
// handshake and parser wiring for every registered adapter. This does not
// prove the live vendor's current response schema or account permissions.
describe.skipIf(process.platform === 'win32')('all agent connection protocol contracts', () => {
  for (const def of AGENT_DEFS) {
    const cases: Array<boolean | 'structured-auth' | 'final-frame'> = [false, true];
    if (def.id === 'qoder') cases.push('structured-auth', 'final-frame');
    for (const failure of cases) {
      const rejected = failure === true || failure === 'structured-auth';
      const label = typeof failure === 'string' ? failure : rejected ? 'exit-zero auth failure stays a failure' : 'prompt reaches protocol and reply reaches connection result';
      test(`${def.id}: ${label}`, async () => {
        const key = agentBinEnvKey(def.id);
        expect(key).toBeTruthy();
        const stem = path.join(root, `${def.id}-${failure}`);
        const configFile = stem + '.json';
        const bin = stem + '.sh';
        const marker = stem + '.received.json';
        await writeFile(configFile, JSON.stringify({
          id: def.id, parser: def.eventParser ?? def.id, format: def.streamFormat,
          transport: def.promptViaFile ? 'file' : def.promptViaStdin ? def.promptInputFormat ?? 'stdin' : 'argv',
          marker, failure,
        }));
        await writeFile(bin, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fixture)} ${quote(configFile)} "$@"\n`);
        await chmod(bin, 0o755);
        const result = await testAgentConnection({ agentId: def.id, agentCliEnv: { [def.id]: { [key!]: bin } } });
        if (rejected) {
          expect(result, JSON.stringify(result)).toMatchObject({ ok: false, kind: 'agent_auth_required' });
        } else {
          expect(result, JSON.stringify(result)).toMatchObject({ ok: true, kind: 'success', sample: 'ok', agentName: def.name });
          const received = JSON.parse(await readFile(marker, 'utf8'));
          expect(received.prompt).toBe('Reply with only: ok');
          expect(path.basename(received.cwd)).toMatch(/^od-conn-test-/);
        }
      });
    }
  }
});
