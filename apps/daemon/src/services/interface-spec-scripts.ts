import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveProcessResourcesPath } from '../daemon-paths.js';

const SCANNER = 'scan_spring.py';
const RELATIVE = path.join('plugins', '_official', 'interface-spec', 'scripts');

/**
 * Where the bundled interface-spec scanners live, for commands that run without the daemon (`monofield docs scan`,
 * `monofield docs check`). Order: an explicit folder, `MONOFIELD_INTERFACE_SPEC_SCRIPTS_DIR`, the packaged app's
 * resources, then the nearest checkout above this file. Returns null when none holds the scanner.
 */
export async function resolveInterfaceSpecScriptsDir(explicit?: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const candidates: string[] = [];
  if (explicit) candidates.push(path.resolve(explicit));
  if (env.MONOFIELD_INTERFACE_SPEC_SCRIPTS_DIR) candidates.push(path.resolve(env.MONOFIELD_INTERFACE_SPEC_SCRIPTS_DIR));
  const resourceRoot = env.MONOFIELD_RESOURCE_ROOT ?? env.OD_RESOURCE_ROOT;
  if (resourceRoot) candidates.push(path.join(path.resolve(resourceRoot), RELATIVE));
  const resources = resolveProcessResourcesPath();
  if (resources) candidates.push(path.join(resources, 'open-design', RELATIVE), path.join(resources, RELATIVE));
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 10; depth += 1) {
    candidates.push(path.join(dir, RELATIVE));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const candidate of candidates) {
    try {
      await access(path.join(candidate, SCANNER));
      return candidate;
    } catch { /* try the next place */ }
  }
  return null;
}
