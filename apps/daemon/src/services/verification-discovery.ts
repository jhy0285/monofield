import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { VerificationCheck } from '@open-design/contracts';

export function verificationScriptNeedsManualSelection(script: string | null): boolean {
  return /(?:--watch(?:\b|[=A-Z])|--fix\b|--write\b|\bvitest\s*$)/.test(script ?? '');
}

const exists = async (target: string) => stat(target).then(() => true).catch(() => false);
export async function discoverVerificationChecks(cwd: string): Promise<VerificationCheck[]> {
  const checks: VerificationCheck[] = [];
  const manifest = join(cwd, 'package.json');
  if (await exists(manifest)) {
    if ((await stat(manifest)).size > 512 * 1024) throw new Error('package.json exceeds 512 KiB');
    const pkg = JSON.parse(await readFile(manifest, 'utf8')) as { scripts?: Record<string, unknown>; packageManager?: string };
    let manager = pkg.packageManager?.match(/^(npm|pnpm|yarn|bun)@/)?.[1];
    if (!manager) {
      manager = await exists(join(cwd, 'pnpm-lock.yaml')) ? 'pnpm'
        : await exists(join(cwd, 'yarn.lock')) ? 'yarn'
          : await exists(join(cwd, 'bun.lock')) || await exists(join(cwd, 'bun.lockb')) ? 'bun' : 'npm';
    }
    for (const [name, kind] of [['test', 'test'], ['test:unit', 'test'], ['typecheck', 'types'], ['check:types', 'types'], ['lint', 'lint'], ['build', 'build']] as const) {
      const script = pkg.scripts?.[name];
      if (typeof script !== 'string' || !script.trim()) continue;
      if (script.length > 8_000) throw new Error(`Verification script ${name} exceeds 8000 characters`);
      checks.push({ id: `node:${name}`, label: name, kind, command: manager, args: ['run', name], source: 'package.json', script,
        recommended: (name !== 'test:unit' || !pkg.scripts?.test) && name !== 'build' && !verificationScriptNeedsManualSelection(script) });
    }
  }
  if (await exists(join(cwd, 'Cargo.toml'))) checks.push({ id: 'rust:test', label: 'cargo test', kind: 'test', command: 'cargo', args: ['test', '--locked'], source: 'Cargo.toml', script: null, recommended: true });
  if (await exists(join(cwd, 'go.mod'))) checks.push({ id: 'go:test', label: 'go test', kind: 'test', command: 'go', args: ['test', './...'], source: 'go.mod', script: null, recommended: true });
  return checks;
}
