import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { CodeOntologyResponse } from '@open-design/contracts';
import type { OntologyJob } from './ontology/build.js';

const active = new Set<string>();
export async function buildCodeOntology(dataDir: string, projectId: string, root: string, projectPath: string,
  businessFiles: string[], request: string, signal?: AbortSignal): Promise<CodeOntologyResponse> {
  const key = createHash('sha256').update(projectId + '\0' + projectPath).digest('hex');
  if (active.has(key) || active.size >= 2) throw Object.assign(new Error('Ontology analysis is already running, or both analysis slots are busy'), { status: 409 });
  active.add(key);
  const started = performance.now();
  const directory = path.join(dataDir, 'ontology'), cacheFile = path.join(directory, key + '.json');
  try {
    const result = await new Promise<CodeOntologyResponse>((resolve, reject) => {
      const worker = new Worker(new URL('./ontology/worker.js', import.meta.url), { workerData: { root, projectPath, businessFiles, request, cacheFile } satisfies OntologyJob,
        resourceLimits: { maxOldGenerationSizeMb: 256 } });
      let settled = false;
      const finish = async (error?: Error, value?: CodeOntologyResponse) => {
        if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
        await worker.terminate().catch(() => undefined); if (error) reject(error); else resolve(value!);
      };
      const abort = () => finish(Object.assign(new Error('Ontology analysis cancelled'), { status: 499 }));
      const timer = setTimeout(() => finish(Object.assign(new Error('Ontology exceeded its 30-second deadline; select a narrower module'), { status: 408 })), 30000);
      worker.on('error', error => finish(error));
      worker.on('exit', code => { if (!settled) finish(new Error(`Ontology worker stopped before completing (${code})`)); });
      worker.on('message', (message: { result?: CodeOntologyResponse; error?: string; status?: number }) => message.result ? finish(undefined, message.result) : finish(Object.assign(new Error(message.error ?? 'Ontology analysis failed'), { status: message.status ?? 400 })));
      signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    });
    if (signal?.aborted) throw Object.assign(new Error('Ontology analysis cancelled'), { status: 499 });
    result.elapsedMs = Math.round(performance.now() - started);
    const content = JSON.stringify(result);
    if (Buffer.byteLength(content) > 10 * 1024 * 1024) throw new Error('Ontology artifact exceeds 10 MiB; select a narrower module');
    await mkdir(directory, { recursive: true });
    const temp = cacheFile + '.' + randomUUID() + '.tmp';
    await writeFile(temp, content, { mode: 0o600 }); await rename(temp, cacheFile);
    return result;
  } finally { active.delete(key); }
}
