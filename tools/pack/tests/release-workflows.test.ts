import { readFile, readdir } from "node:fs/promises";

import { describe, expect, it } from "vitest";

function sectionBetween(content: string, start: string, end: string): string {
  const startIndex = content.indexOf(start);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  const endIndex = content.indexOf(end, startIndex + start.length);
  expect(endIndex).toBeGreaterThan(startIndex);
  return content.slice(startIndex, endIndex);
}

function sectionAfter(content: string, start: string): string {
  const startIndex = content.indexOf(start);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  return content.slice(startIndex);
}

describe("Windows release workflow", () => {
  it("builds verified MonoField artifacts without granting the build job write access", async () => {
    const [workflow, buildScript] = await Promise.all([
      readFile(new URL("../../../.github/workflows/release-windows.yml", import.meta.url), "utf8"),
      readFile(new URL("../../release/scripts/build-platform.ps1", import.meta.url), "utf8"),
    ]);
    const build = sectionBetween(workflow, "  build:\n", "  publish:\n");

    expect(workflow).toContain("name: release-windows");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("release_version:");
    expect(workflow).toContain("signed:");
    expect(workflow).toContain("publish:");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(build).toContain("runs-on: windows-2025");
    expect(build).not.toContain("contents: write");
    expect(build).toContain("uses: actions/checkout@v6.0.2");
    expect(build).toContain("uses: ./.github/actions/setup-workspace");
    expect(build).toContain("tests/resources.test.ts");
    expect(build).toContain("tests/release-workflows.test.ts");
    expect(build).toContain("tests/win-resources.test.ts");
    expect(build).toContain("tests/win-sign.test.ts");
    expect(build).toContain("tests/main/updater.test.ts");
    expect(build).toContain("tools\\release\\scripts\\build-platform.ps1");
    expect(build).toContain("-ReleaseNamespace default");
    expect(build).toContain("-BuildTarget all");
    expect(build).toContain("-SmokeMode full");
    expect(build).toContain("Get-AuthenticodeSignature");
    expect(build).toContain("actions/upload-artifact@v7");
    expect(build).toContain("release-manifest.json");
    expect(build).toContain("build-index.json");
    expect(build).toContain('Join-Path $workRoot "report"');

    expect(buildScript).toContain('"--portable"');
    expect(buildScript).toContain('"--app-version", $ReleaseVersion');
    expect(buildScript).toContain('"--to", $BuildTarget');
    expect(buildScript).toContain("Validate-WinLauncherPayloadArchive");
    expect(buildScript).toContain('Test-JsonString $manifest.entry.executable "entry.executable" "payload/MonoField.exe"');
    expect(buildScript).toContain('cleanup-monofield-local-temp.ps1');
    expect(buildScript).toContain('-StopOrphanTestRunners -MinimumAgeMinutes 5');
    const updateFixtureBuild = sectionBetween(
      buildScript,
      '    Measure-Step "tools-pack win build update fixture" {',
      '    Measure-Step "validate launcher payload update fixture" {',
    );
    expect(updateFixtureBuild).toContain('$updateOutput | Set-Content -LiteralPath $fixtureJsonPath -Encoding utf8');
    expect(updateFixtureBuild).toContain('$localUpdateArtifactPath = [string]$updateBuild.installerPath');
    const scopeBoundary = updateFixtureBuild.indexOf('    }\n    # Measure-Step');
    expect(scopeBoundary).toBeGreaterThanOrEqual(0);
    expect(scopeBoundary).toBeLessThan(
      updateFixtureBuild.indexOf('$localUpdateArtifactPath = [string]$updateBuild.installerPath'),
    );
  });

  it("requires Authenticode signing before publishing updater-compatible GitHub assets", async () => {
    const [workflow, packConfig, updater, site, readme] = await Promise.all([
      readFile(new URL("../../../.github/workflows/release-windows.yml", import.meta.url), "utf8"),
      readFile(new URL("../src/config.ts", import.meta.url), "utf8"),
      readFile(new URL("../../../apps/desktop/src/main/updater.ts", import.meta.url), "utf8"),
      readFile(new URL("../../../apps/monofield-site/index.html", import.meta.url), "utf8"),
      readFile(new URL("../../../README.md", import.meta.url), "utf8"),
    ]);
    const publish = sectionAfter(workflow, "  publish:\n");

    expect(workflow).toContain('throw "public GitHub releases must use signed=true"');
    expect(workflow).toContain('throw "public releases may only be published from jhy0285/monofield"');
    expect(workflow).toContain("secrets.OD_WIN_SIGN_CERT_PFX_BASE64");
    expect(workflow).toContain("secrets.OD_WIN_SIGN_CERT_PASSWORD");
    expect(workflow).toContain("secrets.OD_WIN_SIGN_CERT_SHA1");
    expect(workflow).toContain("Import-PfxCertificate");
    expect(workflow).toContain("MonoField-default-setup.exe");
    expect(workflow).toContain("MonoField-default-payload.7z");
    expect(workflow).toContain("MonoField-default-portable.zip");
    expect(workflow).toContain('name = "latest.yml"');
    expect(workflow).toContain('Join-Path $assetsRoot "SHA256SUMS.txt"');

    expect(publish).toContain("if: ${{ inputs.publish }}");
    expect(publish).toContain("permissions:\n      contents: write");
    expect(publish).toContain("uses: actions/download-artifact@v8");
    expect(publish).toContain("sha256sum --check --strict SHA256SUMS.txt");
    expect(publish).toContain('test "$(find "$assets" -maxdepth 1 -type f | wc -l)" -eq 5');
    expect(publish).toContain(".signed == true");
    expect(publish).toContain("gh release create");
    expect(publish).toContain('gh api "repos/$RELEASE_REPOSITORY/commits/$tag"');
    expect(publish).toContain("refusing to publish $tag because it points to $tag_commit instead of $RELEASE_COMMIT");
    expect(publish).toContain("--target \"$RELEASE_COMMIT\"");
    expect(publish).toContain("gh release upload");
    expect(publish).toContain("gh release edit");
    expect(publish).toContain("--draft=false --latest");
    expect(publish).toContain("refusing to replace an existing published release or a draft for another commit");

    expect(packConfig).toContain(
      'const DEFAULT_STABLE_UPDATE_METADATA_URL = "https://api.github.com/repos/jhy0285/monofield/releases/latest"',
    );
    expect(updater).toContain("/** Convert GitHub's public latest-release response into MonoField's updater contract. */");
    expect(updater).toContain('name.endsWith("setup.exe")');
    expect(updater).toContain('name.includes("payload") && name.endsWith(".7z")');
    expect(site).toContain("/releases/latest/download/MonoField-default-setup.exe");
    expect(readme).toContain("/releases/latest/download/MonoField-default-setup.exe");
    expect(readme).toContain("/releases/latest/download/MonoField-default-portable.zip");
  });

  it("does not retain assertions for the removed Open Design release lanes", async () => {
    const workflowNames = await readdir(new URL("../../../.github/workflows", import.meta.url));
    const publicReleaseWorkflows = workflowNames.filter((name) => name.startsWith("release-"));

    expect(publicReleaseWorkflows).toEqual(["release-windows.yml"]);
    for (const removed of [
      "release-beta.yml",
      "release-beta-s.yml",
      "release-preview.yml",
      "release-prerelease.yml",
      "release-stable.yml",
    ]) {
      expect(workflowNames).not.toContain(removed);
    }
  });
});
