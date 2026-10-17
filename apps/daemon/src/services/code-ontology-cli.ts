import { readFile, stat } from 'node:fs/promises';

export async function runCodeOntologyCli(flags: Record<string, unknown>, base: string, operation: 'build' | 'plan' | 'context' = 'build'): Promise<void> {
  async function input(file: string): Promise<string> {
    if (file !== '-') {
      if ((await stat(file)).size > 32 * 1024) throw new Error('Ontology CLI input exceeds 32 KiB');
      return readFile(file, 'utf8');
    }
    const chunks: Buffer[] = []; let size = 0;
    for await (const value of process.stdin) {
      const chunk = Buffer.from(value); size += chunk.length;
      if (size > 32 * 1024) throw new Error('Ontology CLI input exceeds 32 KiB'); chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  if (['documents-file', 'inputs-file', 'prompt-file', 'focus-file', 'simulate-file'].filter(name => flags[name] === '-').length > 1) throw new Error('Only one input may use stdin');
  if (flags['simulate-file'] !== undefined && operation !== 'plan') throw new Error('Source simulation is available through docs plan-code');
  const body = {
    ...(typeof flags['project-path'] === 'string' ? { projectPath: flags['project-path'] } : {}),
    ...(typeof flags['documents-file'] === 'string' ? { businessFiles: JSON.parse(await input(flags['documents-file'])) } : {}),
    ...(typeof flags['prompt-file'] === 'string' ? { request: await input(flags['prompt-file']) } : {}),
    ...(typeof flags['inputs-file'] === 'string' ? { inputFiles: JSON.parse(await input(flags['inputs-file'])) } : {}),
    ...(typeof flags['rules-file'] === 'string' ? { rulesFile: flags['rules-file'] } : {}),
    ...(typeof flags['simulate-file'] === 'string' ? { simulateFiles: JSON.parse(await input(flags['simulate-file'])) } : {}),
    ...(flags['max-bytes'] !== undefined ? { maxBytes: Number(flags['max-bytes']) } : {}),
    ...(flags['local-judge'] === true ? { localJudge: true } : {}),
    ...(typeof flags['focus-file'] === 'string' ? { focusNodeIds: JSON.parse(await input(flags['focus-file'])) } : {}),
    ...(typeof flags['evidence-mode'] === 'string' ? { evidenceMode: flags['evidence-mode'] } : {}),
  };
  const response = await fetch(`${base}/api/projects/${encodeURIComponent(String(flags.project))}/ontology/${operation}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json() as { error?: { message?: string } };
  if (!response.ok) throw new Error(result.error?.message ?? `Ontology HTTP ${response.status}`);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
