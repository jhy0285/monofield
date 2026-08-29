import { readFileSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

function resolveToolsPackRoot(startDir: string): string {
  const maxDepth = 6;
  let current = startDir;

  for (let depth = 0; depth < maxDepth; depth += 1) {
    try {
      const raw = readFileSync(join(current, "package.json"), "utf8");
      const parsed = JSON.parse(raw) as { name?: unknown };
      if (parsed.name === "@open-design/tools-pack") {
        return current;
      }
    } catch {
      // Keep walking until we find the tools-pack package root.
    }

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(`tools-pack: unable to resolve package root from ${startDir}`);
}

export const toolsPackRoot = resolveToolsPackRoot(dirname(fileURLToPath(import.meta.url)));
export const resourcesRoot = join(toolsPackRoot, "resources");

export const macResources = {
  entitlements: join(resourcesRoot, "mac", "entitlements.mac.plist"),
  entitlementsInherit: join(resourcesRoot, "mac", "entitlements.mac.inherit.plist"),
  icon: join(resourcesRoot, "mac", "icon.icns"),
  iconPng: join(resourcesRoot, "mac", "icon.png"),
  notarizeHook: join(resourcesRoot, "mac", "notarize.cjs"),
  webStandaloneAfterPackHook: join(resourcesRoot, "web-standalone-after-pack.cjs"),
} as const;

export const winResources = {
  appxAssets: join(resourcesRoot, "win", "appx"),
  icon: join(resourcesRoot, "win", "icon.ico"),
  sevenZipDll: join(resourcesRoot, "win", "7zip", "7z.dll"),
  sevenZipExe: join(resourcesRoot, "win", "7zip", "7z.exe"),
  webStandaloneAfterPackHook: join(resourcesRoot, "web-standalone-after-pack.cjs"),
} as const;

export const linuxResources = {
  icon: join(resourcesRoot, "linux", "icon.png"),
  desktopTemplate: join(resourcesRoot, "linux", "open-design.desktop.template"),
} as const;

const BUNDLED_RESOURCE_TREES = [
  { from: "skills", to: "skills" },
  // After the skills/design-templates split (specs/current/skills-and-design-templates.md)
  // the rendering catalogue lives under its own root and the daemon
  // resolves it via DESIGN_TEMPLATES_DIR. Bundle it like any other
  // first-class resource so packaged builds carry the full template set.
  { from: "design-templates", to: "design-templates" },
  { from: "design-systems", to: "design-systems" },
  { from: "craft", to: "craft" },
  { from: join("plugins", "_official"), to: join("plugins", "_official") },
  { from: join("plugins", "registry"), to: join("plugins", "registry") },
  { from: join("assets", "frames"), to: "frames" },
  { from: join("assets", "community-pets"), to: "community-pets" },
  { from: "prompt-templates", to: "prompt-templates" },
  // Baked plugin-preview manifest. The gallery's pre-rendered hover-pan clips
  // live on R2; the daemon needs this checked-in manifest to map each plugin to
  // its clip (it serves clips from R2 when the files aren't on disk, which is the
  // packaged case). Without it the packaged daemon reads an empty manifest and the
  // gallery falls back to live, GPU-expensive iframes instead of the baked clips.
  { from: join("data", "plugin-previews"), to: join("data", "plugin-previews") },
] as const;

const BUNDLED_LEGAL_FILES = [
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_NOTICES.md",
] as const;

// Resource trees intentionally include runtime Markdown (SKILL.md, DESIGN.md,
// and linked references) and runnable examples used by the template/plugin
// catalogues. Only strip directory classes and file types that are exclusively
// development or generated baggage in these trees.
const DEVELOPMENT_ONLY_RESOURCE_DIRECTORIES = new Set([
  "__snapshots__",
  "__tests__",
  "__pycache__",
  "coverage",
  "docs",
  "fixtures",
  "logs",
  "screenshots",
  "snapshots",
  "spec",
  "specs",
  "test",
  "tests",
]);

const DEVELOPMENT_ONLY_RESOURCE_EXTENSIONS = new Set([".log", ".map", ".pyc", ".pyo"]);

const DEVELOPMENT_ONLY_RESOURCE_FILE_NAMES = new Set([
  ".clawscan-allow",
  ".ds_store",
  ".gitignore",
  "agents.md",
  "thumbs.db",
]);

export function shouldBundleRuntimeResource(sourceRoot: string, sourcePath: string): boolean {
  const relativePath = relative(sourceRoot, sourcePath);
  if (relativePath.length === 0) return true;

  const segments = relativePath.split(/[\\/]+/).map((segment) => segment.toLowerCase());
  if (segments.some((segment) => DEVELOPMENT_ONLY_RESOURCE_DIRECTORIES.has(segment))) {
    return false;
  }

  const fileName = basename(sourcePath).toLowerCase();
  if (DEVELOPMENT_ONLY_RESOURCE_FILE_NAMES.has(fileName)) return false;
  // A catalogue root README documents this repository's source tree. Nested
  // READMEs remain available because individual templates can use them as
  // runtime instructions or example content.
  if (segments.length === 1 && /^readme(?:\..+)?\.md$/.test(fileName)) return false;

  return !DEVELOPMENT_ONLY_RESOURCE_EXTENSIONS.has(extname(fileName));
}

export async function copyBundledResourceTrees({
  workspaceRoot,
  resourceRoot,
}: {
  workspaceRoot: string;
  resourceRoot: string;
}): Promise<void> {
  await mkdir(resourceRoot, { recursive: true });

  for (const entry of BUNDLED_RESOURCE_TREES) {
    const sourceRoot = join(workspaceRoot, entry.from);
    await cp(sourceRoot, join(resourceRoot, entry.to), {
      filter: (sourcePath) => shouldBundleRuntimeResource(sourceRoot, sourcePath),
      recursive: true,
    });
  }

  // Keep the distribution's license, fork attribution, and bundled-component
  // notices beside the runtime resources on every packaged platform. These are
  // required release inputs: a missing notice must fail packaging rather than
  // silently produce an incomplete distribution.
  for (const fileName of BUNDLED_LEGAL_FILES) {
    await cp(join(workspaceRoot, fileName), join(resourceRoot, fileName));
  }
}
