import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  renderDesignTokensJson,
  renderTailwindV4Css,
  type DerivedDesignTokenBinding,
  type DerivedDesignTokenReport,
} from "../packages/contracts/src/design-systems/derived-token-outputs.ts";

type DesignSystemManifest = {
  files?: {
    tokens?: string;
    designTokens?: string;
    tailwind?: string;
  };
  sourceFiles?: {
    report?: string;
  };
};

const repoRoot = path.resolve(import.meta.dirname, "..");
const designSystemsRoot = path.join(repoRoot, "design-systems");

function rootTokenNames(css: string): string[] {
  const names = new Set<string>();
  const rootPattern = /:root(?!\[)\s*\{([\s\S]*?)\}/g;
  let rootMatch: RegExpExecArray | null;
  while ((rootMatch = rootPattern.exec(css)) !== null) {
    for (const match of rootMatch[1]!.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) {
      names.add(match[1]!);
    }
  }
  return [...names];
}

function parseReport(raw: string, filePath: string): DerivedDesignTokenReport & {
  tokens: DerivedDesignTokenBinding[];
} {
  const report = JSON.parse(raw) as Partial<DerivedDesignTokenReport> & {
    tokens?: DerivedDesignTokenBinding[];
  };
  if (
    typeof report.generatedAt !== "string" ||
    report.summary == null ||
    typeof report.summary !== "object" ||
    !Array.isArray(report.tokens)
  ) {
    throw new Error(`invalid derived token report: ${filePath}`);
  }
  return {
    generatedAt: report.generatedAt,
    summary: report.summary,
    tokens: report.tokens,
  };
}

async function generateForDirectory(directory: string): Promise<boolean> {
  const manifestPath = path.join(directory, "manifest.json");
  const manifestRaw = await readFile(manifestPath, "utf8").catch(() => null);
  if (manifestRaw == null) return false;
  const manifest = JSON.parse(manifestRaw) as DesignSystemManifest;
  const tokensPath = manifest.files?.tokens;
  const designTokensPath = manifest.files?.designTokens;
  const tailwindPath = manifest.files?.tailwind;
  const reportPath = manifest.sourceFiles?.report;
  if (tokensPath == null || designTokensPath == null || tailwindPath == null || reportPath == null) {
    return false;
  }

  const [tokensCss, reportRaw] = await Promise.all([
    readFile(path.join(directory, tokensPath), "utf8"),
    readFile(path.join(directory, reportPath), "utf8"),
  ]);
  const report = parseReport(reportRaw, path.join(directory, reportPath));
  await Promise.all([
    writeFile(
      path.join(directory, designTokensPath),
      renderDesignTokensJson({ bindings: report.tokens, report }),
      "utf8",
    ),
    writeFile(
      path.join(directory, tailwindPath),
      renderTailwindV4Css(rootTokenNames(tokensCss).map((name) => ({ name }))),
      "utf8",
    ),
  ]);
  return true;
}

let generated = 0;
for (const entry of await readdir(designSystemsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === "_schema") continue;
  if (await generateForDirectory(path.join(designSystemsRoot, entry.name))) {
    generated += 1;
  }
}

console.log(`Regenerated derived token outputs for ${generated} design systems.`);
