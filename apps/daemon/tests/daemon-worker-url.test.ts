import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { DAEMON_WORKER_DIR_ENV, daemonWorkerUrl } from '../src/daemon-paths.js';

describe('daemonWorkerUrl', () => {
  const beside = new URL('./ontology/worker.js', import.meta.url);

  it('keeps the worker beside the module that starts it in the daemon build', () => {
    expect(daemonWorkerUrl('ontology-worker', beside, {})).toBe(beside);
    expect(daemonWorkerUrl('ontology-worker', beside, { [DAEMON_WORKER_DIR_ENV]: '  ' })).toBe(beside);
  });

  it('uses the bundled worker file when the bundle names its worker folder', () => {
    const folder = path.resolve('bundle', 'daemon');
    const url = daemonWorkerUrl('java-source-worker', beside, { [DAEMON_WORKER_DIR_ENV]: folder });
    expect(fileURLToPath(url)).toBe(path.join(folder, 'java-source-worker.mjs'));
  });
});
