import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { VerificationCheck } from '@open-design/contracts';
import { discoverDevelopmentProjects, resolveDevelopmentProjectRoot } from '../development-projects.js';

export function verificationScriptNeedsManualSelection(script: string | null): boolean {
  return /(?:--watch(?:\b|[=A-Z])|--fix\b|--write\b|\bvitest\s*$)/.test(script ?? '');
}

const exists = async (target: string) => stat(target).then(() => true).catch(() => false);
async function discoverModuleChecks(cwd: string): Promise<VerificationCheck[]> {
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
  if (await exists(join(cwd, 'pom.xml'))) {
    const wrapper = process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw';
    const command = await exists(join(cwd, wrapper)) ? `./${wrapper}` : 'mvn';
    for (const [id, goal, kind, recommended] of [
      ['test', 'test', 'test', true], ['compile', 'test-compile', 'types', true], ['package', 'package', 'build', false],
    ] as const) checks.push({ id: `java:maven-${id}`, label: `Maven ${goal}`, kind, command,
      args: ['-B', '-ntp', goal], source: 'pom.xml', script: null, recommended });
    checks.push({id:'java:maven-prepare',label:'Prepare Maven dependencies',kind:'build',command,args:['-B','-ntp','dependency:go-offline'],source:'pom.xml',script:null,recommended:false});
  }
  return checks;
}

/** A root with checks stays authoritative. Manifest-less split workspaces expose their discovered modules. */
export async function discoverVerificationChecks(cwd: string): Promise<VerificationCheck[]> {
  const own = await discoverModuleChecks(cwd);
  if (own.length) return own;
  const projects = await discoverDevelopmentProjects(cwd, true);
  if (projects.length > 32) throw new Error('Select a smaller workspace with at most 32 verification modules');
  const checks: VerificationCheck[] = [];
  for (const project of projects) {
    if (project.path === '.') continue;
    const module = await resolveDevelopmentProjectRoot(cwd, project.path);
    for (const check of await discoverModuleChecks(module.root)) checks.push({ ...check,
      id: `${project.path}::${check.id}`, label: `${project.label} · ${check.label}`,
      source: `${project.path}/${check.source}`, projectPath: project.path });
  }
  return checks;
}
