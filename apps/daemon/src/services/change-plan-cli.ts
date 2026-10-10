import { readFile, stat } from 'node:fs/promises';

/** The CLI uses the same planner API as the document editor, never a private graph implementation. */
export async function runChangePlanCli(flags: Record<string, unknown>, base: string): Promise<void> {
  async function input(file: string): Promise<string> {
    if (file !== '-') {
      if ((await stat(file)).size > 64 * 1024) throw new Error('Plan input exceeds 64 KiB');
      return readFile(file, 'utf8');
    }
    const chunks: Buffer[] = []; let size = 0;
    for await (const value of process.stdin) {
      const chunk = Buffer.from(value); size += chunk.length;
      if (size > 64 * 1024) throw new Error('Plan input exceeds 64 KiB');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  if (['inputs-file', 'prompt-file', 'simulate-file'].filter(key => flags[key] === '-').length > 1) throw new Error('Only one input may use stdin');
  const body = {
    ...(typeof flags['inputs-file'] === 'string' ? { inputFiles: JSON.parse(await input(flags['inputs-file'])) } : {}),
    ...(typeof flags['rules-file'] === 'string' ? { rulesFile: flags['rules-file'] } : {}),
    ...(typeof flags['simulate-file'] === 'string' ? { simulateNodeIds: JSON.parse(await input(flags['simulate-file'])) } : {}),
    ...(typeof flags['prompt-file'] === 'string' ? { request: await input(flags['prompt-file']) } : {}),
  };
  const response = await fetch(`${base}/api/projects/${encodeURIComponent(String(flags.project))}/documents/plan`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json() as { error?: { message?: string } };
  if (!response.ok) throw new Error(result?.error?.message ?? `Planner HTTP ${response.status}`);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
