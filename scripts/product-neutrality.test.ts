import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  collectProductNeutralityViolationsFromSource,
  isProductNeutralityCheckedPath,
} from "./guard.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("product-neutrality check rejects named orchestrator examples on public surfaces", () => {
  const violations = collectProductNeutralityViolationsFromSource(
    "packages/contracts/src/api/chat.ts",
    "Run-scoped tool bundle supplied by an orchestrator such as Acme.",
    [],
  );

  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.lineNumber, 1);
});

test("product-neutrality check covers web App Router public copy", () => {
  assert.equal(isProductNeutralityCheckedPath("apps/web/app/page.tsx"), true);

  const violations = collectProductNeutralityViolationsFromSource(
    "apps/web/app/page.tsx",
    "This page mentions an orchestrator such as Acme.",
    [],
  );

  assert.equal(violations.length, 1);
});

test("product-neutrality check supports local forbidden terms without committing them", () => {
  const violations = collectProductNeutralityViolationsFromSource(
    "docs/example.md",
    "This private deployment name should not ship.",
    ["private deployment"],
  );

  assert.equal(violations.length, 1);
});

test("product-neutrality check ignores out-of-scope paths", () => {
  assert.equal(isProductNeutralityCheckedPath("tmp/scratch.md"), false);
  assert.deepEqual(
    collectProductNeutralityViolationsFromSource(
      "tmp/scratch.md",
      "A scratch note can mention an orchestrator such as Acme.",
      [],
    ),
    [],
  );
});

test("public source instructions expose only the MonoField command boundary", () => {
  const readme = readRepoFile("README.md");
  const quickstart = readRepoFile("QUICKSTART.md");
  const packagedReadme = readRepoFile("apps/packaged/README.md");
  assert.doesNotMatch(readme, /@open-design|open-docs|`od(?:\s|`)|\bOD_[A-Z_]+/u);
  assert.doesNotMatch(quickstart, /@open-design|open-docs|`od(?:\s|`)|\bOD_[A-Z_]+/u);
  assert.doesNotMatch(packagedReadme, /@open-design|open-docs|`od(?:\s|`)|\bOD_[A-Z_]+/u);
  assert.match(readme, /pnpm build:web/u);
  assert.match(readme, /pnpm dev:desktop/u);
  assert.match(readme, /`monofield`/u);
});

test("only canonical public extension schemas are published", () => {
  assert.equal(existsSync(path.join(repoRoot, "docs/schemas/monofield.plugin.v1.json")), true);
  assert.equal(existsSync(path.join(repoRoot, "docs/schemas/monofield.marketplace.v1.json")), true);
  assert.equal(existsSync(path.join(repoRoot, "docs/schemas/open-design.plugin.v1.json")), false);
  assert.equal(existsSync(path.join(repoRoot, "docs/schemas/open-design.marketplace.v1.json")), false);
});

test("public routes and environment names prefer MonoField", () => {
  const routeSource = readRepoFile("apps/daemon/src/routes/monofield-public-metadata.ts");
  const originSource = readRepoFile("apps/daemon/src/origin-validation.ts");
  const installationSource = readRepoFile("apps/daemon/src/installation.ts");

  assert.doesNotMatch(routeSource, /\/api\/github\/open-docs|\/api\/community\/discord/u);
  assert.match(routeSource, /\/api\/github\/monofield/u);
  assert.match(originSource, /MONOFIELD_ALLOWED_ORIGINS/u);
  assert.match(installationSource, /MONOFIELD_INSTALLATION_DIR/u);
});

test("the root package publishes only the monofield executable", () => {
  const packageJson = JSON.parse(readRepoFile("package.json")) as {
    bin?: Record<string, string>;
  };
  assert.deepEqual(packageJson.bin, {
    monofield: "./apps/daemon/bin/monofield.mjs",
  });
});

test("settings generates the canonical MonoField MCP server name", () => {
  const settingsSource = readRepoFile("apps/web/src/components/SettingsDialog.tsx");
  assert.doesNotMatch(settingsSource, /["']open-docs["']/u);
  assert.match(settingsSource, /["']monofield["']/u);
});

test("new plugin authoring uses only the MonoField public contract", () => {
  const scaffold = readRepoFile("apps/daemon/src/plugins/scaffold.ts");
  const authoring = readRepoFile("apps/web/src/components/home-hero/plugin-authoring.ts");
  const schema = JSON.parse(readRepoFile("docs/schemas/monofield.plugin.v1.json")) as {
    $id?: string;
    properties?: Record<string, unknown>;
  };

  assert.match(scaffold, /monofield\.json/u);
  assert.match(scaffold, /monofield:/u);
  assert.doesNotMatch(scaffold, /['"`]od:/u);
  assert.doesNotMatch(authoring, /open-design\.json|`od(?:\s|`)/u);
  assert.match(schema.$id ?? "", /jhy0285\/monofield/u);
  assert.ok(schema.properties?.monofield);
  assert.equal(schema.properties?.od, undefined);
});
