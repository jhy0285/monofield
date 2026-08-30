import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const e2eRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = dirname(e2eRoot);
const workflowsRoot = join(workspaceRoot, ".github", "workflows");
const ciWorkflowPath = join(workflowsRoot, "ci.yml");
const releaseWorkflowPath = join(workflowsRoot, "release-windows.yml");
const buildPlatformPath = join(workspaceRoot, "tools", "release", "scripts", "build-platform.ps1");
const releaseSmokePath = join(e2eRoot, "scripts", "release-smoke.ts");
const winSmokePath = join(e2eRoot, "specs", "win.spec.ts");
const packConfigPath = join(workspaceRoot, "tools", "pack", "src", "config.ts");
const packResourcesPath = join(workspaceRoot, "tools", "pack", "src", "resources.ts");
const updaterPath = join(workspaceRoot, "apps", "desktop", "src", "main", "updater.ts");
const sitePath = join(workspaceRoot, "apps", "monofield-site", "index.html");
const readmePath = join(workspaceRoot, "README.md");

function sectionBetween(content: string, start: string, end: string): string {
  const startIndex = content.indexOf(start);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  const endIndex = content.indexOf(end, startIndex + start.length);
  expect(endIndex).toBeGreaterThan(startIndex);
  return content.slice(startIndex, endIndex);
}

describe("packaged smoke workflow", () => {
  it("[P2] follows the current MonoField workflow inventory", async () => {
    const workflowNames = (await readdir(workflowsRoot))
      .filter((name) => name.endsWith(".yml"))
      .sort();

    expect(workflowNames).toEqual([
      "ci.yml",
      "docker-image.yml",
      "release-windows.yml",
      "visual-baseline.yml",
    ]);
    expect(workflowNames.filter((name) => name.startsWith("release-"))).toEqual([
      "release-windows.yml",
    ]);
  });

  it("[P2] keeps install smoke out of CI while validating launcher payload code", async () => {
    const workflow = await readFile(ciWorkflowPath, "utf8");
    const job = sectionBetween(
      workflow,
      "  windows_tools_pack_payload_tests:",
      "  web_workspace_tests:",
    );
    const validate = sectionBetween(
      workflow,
      "  validate:",
      '          if [ -n "$failures" ]; then',
    );

    expect(workflow).not.toContain("packaged_smoke_");
    expect(workflow).not.toContain("OD_PACKAGED_E2E_");
    expect(job).toContain("runs-on: windows-latest");
    expect(job).toContain("needs.scopes.outputs.run_windows_tools_pack_payload_tests == 'true'");
    expect(job).toContain(
      "pnpm --filter @open-design/tools-pack exec vitest run tests/launcher-payload.test.ts",
    );
    expect(validate).toContain("windows_tools_pack_payload_tests");
  });

  it("[P2] keeps public release writes behind version, repository, and signing gates", async () => {
    const workflow = await readFile(releaseWorkflowPath, "utf8");
    const build = sectionBetween(workflow, "  build:\n", "  publish:\n");
    const publish = workflow.slice(workflow.indexOf("  publish:\n"));

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("release_version:");
    expect(workflow).toContain("signed:");
    expect(workflow).toContain("publish:");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(build).not.toContain("contents: write");
    expect(workflow).toContain("public GitHub releases must use signed=true");
    expect(workflow).toContain("public releases may only be published from jhy0285/monofield");
    for (const packageJson of [
      "package.json",
      "apps/desktop/package.json",
      "apps/packaged/package.json",
      "tools/pack/package.json",
      "tools/release/package.json",
    ]) {
      expect(workflow).toContain(`"${packageJson}"`);
    }
    expect(workflow).toContain("secrets.OD_WIN_SIGN_CERT_PFX_BASE64");
    expect(workflow).toContain("secrets.OD_WIN_SIGN_CERT_PASSWORD");
    expect(workflow).toContain("secrets.OD_WIN_SIGN_CERT_SHA1");
    expect(workflow).toContain("Import-PfxCertificate");
    expect(workflow).toContain("Get-AuthenticodeSignature");
    expect(publish).toContain("permissions:\n      contents: write");
    expect(publish).toContain(".signed == true");
  });

  it("[P2] builds all canonical Windows artifacts and preserves smoke evidence", async () => {
    const [workflow, buildPlatform, releaseSmoke] = await Promise.all([
      readFile(releaseWorkflowPath, "utf8"),
      readFile(buildPlatformPath, "utf8"),
      readFile(releaseSmokePath, "utf8"),
    ]);

    expect(workflow).toContain("-ReleaseNamespace default");
    expect(workflow).toContain("-SmokeMode full");
    expect(workflow).toContain("-BuildTarget all");
    expect(workflow).toContain("build-index.json");
    expect(workflow).toContain('Join-Path $workRoot "report"');
    expect(workflow).toContain("actions/upload-artifact@v7");
    expect(workflow).toContain("actions/download-artifact@v8");

    expect(buildPlatform).toContain('"--portable"');
    expect(buildPlatform).toContain('"--app-version", $ReleaseVersion');
    expect(buildPlatform).toContain('"--to", $BuildTarget');
    expect(buildPlatform).toContain("Validate-WinLauncherPayloadArchive");
    expect(buildPlatform).toContain(
      'Test-JsonString $manifest.entry.executable "entry.executable" "payload/MonoField.exe"',
    );
    expect(buildPlatform).toContain('$SmokeMode -eq "full"');
    expect(buildPlatform).toContain('Measure-Step "build tools-serve updater fixture"');
    expect(buildPlatform).toContain('"pnpm.cmd", "--filter", "@open-design/tools-serve", "build"');
    expect(buildPlatform.indexOf('Measure-Step "build tools-serve updater fixture"'))
      .toBeLessThan(buildPlatform.indexOf('Measure-Step "tools-pack win build"'));
    expect(buildPlatform).toContain('"windows-tools-pack-update-build.json"');
    expect(buildPlatform).toContain('OD_PACKAGED_E2E_WIN_UPDATE_FIXTURE = "tools-serve"');
    expect(buildPlatform).toContain(
      '"pnpm.cmd", "exec", "tsx", "scripts/release-smoke.ts", "win", "specs/win.spec.ts"',
    );
    expect(buildPlatform).toContain('cleanup-monofield-release-history.ps1');
    expect(buildPlatform).toContain('$buildSucceeded = $true');
    expect(buildPlatform).toContain('-KeepLatest 1');

    expect(releaseSmoke).toContain("await report.json('manifest.json'");
    expect(releaseSmoke).toContain("saveRequiredSource(report, 'tools-pack.json'");
    expect(releaseSmoke).toContain("await report.save('vitest.log'");
    expect(releaseSmoke).toContain("await report.json('suite-result.json'");
  });

  it("[P2] retains install, health, payload-update, and cleanup coverage", async () => {
    const smoke = await readFile(winSmokePath, "utf8");

    expect(smoke).toContain("winDescribe('packaged windows runtime smoke'");
    expect(smoke).toContain(
      "installs, starts, inspects with eval and screenshot, stops, and uninstalls the built windows artifact",
    );
    expect(smoke).toContain("runToolsPackJson<WinInstallResult>('install')");
    expect(smoke).toContain("runToolsPackJson<WinStartResult>('start')");
    expect(smoke).toContain("waitForHealthyDesktop()");
    expect(smoke).toContain("startToolsServeUpdaterFixture");
    expect(smoke).toContain("runPayloadUpdateAcceptance");
    expect(smoke).toContain("expect(downloadedInspect.update.artifact?.type).toBe('payload')");
    expect(smoke).toContain("assertLauncherPointer");
    expect(smoke).toContain("runToolsPackJson<WinUninstallResult>('uninstall'");
    expect(smoke).toContain("productNamespaceRootExists).toBe(false)");
    expect(smoke).toContain("await report.saveSummary");
  });

  it("[P2] aligns GitHub assets with the site and stable updater contract", async () => {
    const [workflow, packConfig, updater, site, readme] = await Promise.all([
      readFile(releaseWorkflowPath, "utf8"),
      readFile(packConfigPath, "utf8"),
      readFile(updaterPath, "utf8"),
      readFile(sitePath, "utf8"),
      readFile(readmePath, "utf8"),
    ]);

    for (const asset of [
      "MonoField-default-setup.exe",
      "MonoField-default-payload.7z",
      "MonoField-default-portable.zip",
      "latest.yml",
      "SHA256SUMS.txt",
    ]) {
      expect(workflow).toContain(asset);
    }
    expect(workflow).toContain("sha256sum --check --strict SHA256SUMS.txt");
    expect(workflow).toContain("gh release create");
    expect(workflow).toContain("gh release upload");
    expect(workflow).toContain("gh release edit");
    expect(workflow).toContain("--draft=false --latest");
    expect(workflow).toContain('gh api "repos/$RELEASE_REPOSITORY/commits/$tag"');

    expect(packConfig).toContain(
      'const DEFAULT_STABLE_UPDATE_METADATA_URL = "https://api.github.com/repos/jhy0285/monofield/releases/latest"',
    );
    expect(updater).toContain("Convert GitHub's public latest-release response into MonoField's updater contract");
    expect(updater).toContain('name.endsWith("setup.exe")');
    expect(updater).toContain('name.includes("payload") && name.endsWith(".7z")');
    expect(site).toContain("/releases/latest/download/MonoField-default-setup.exe");
    expect(readme).toContain("/releases/latest/download/MonoField-default-setup.exe");
    expect(readme).toContain("/releases/latest/download/MonoField-default-portable.zip");
  });

  it("[P2] keeps runtime examples while excluding development-only resource baggage", async () => {
    const resources = await readFile(packResourcesPath, "utf8");

    expect(resources).toContain("shouldBundleRuntimeResource");
    for (const excluded of [
      '"__pycache__"',
      '"__tests__"',
      '"docs"',
      '"fixtures"',
      '"screenshots"',
      '"tests"',
      '".log"',
      '".map"',
      '".pyc"',
      '"agents.md"',
    ]) {
      expect(resources).toContain(excluded);
    }
    expect(resources).toContain("runnable examples used by the template/plugin");
    expect(resources).not.toMatch(/DEVELOPMENT_ONLY_RESOURCE_DIRECTORIES[\s\S]*?"examples"/);
  });
});
