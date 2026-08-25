import fs from 'node:fs';
import path from 'node:path';

export const MONOFIELD_PLUGIN_MANIFEST = 'monofield.json';
export const LEGACY_PLUGIN_MANIFEST = 'open-design.json';

export function resolveExistingPluginManifest(folder: string): string | null {
  const canonical = path.join(folder, MONOFIELD_PLUGIN_MANIFEST);
  if (fs.existsSync(canonical)) return canonical;
  const legacy = path.join(folder, LEGACY_PLUGIN_MANIFEST);
  return fs.existsSync(legacy) ? legacy : null;
}
