import { describe, expect, it } from "vitest";

import { releaseAppVersionArgs, resolvePackagedWinInstallIdentity } from "@/vitest/packaged-win-identity";

describe("packaged windows smoke identity", () => {
  it("[P2] lets a prerelease version override the stable release namespace", () => {
    expect(resolvePackagedWinInstallIdentity({
      namespace: "release-stable-win",
      releaseVersion: "0.8.0-prerelease.2",
    })).toEqual({
      displayName: "MonoField Prerelease",
      namespaceToken: "release-stable-win",
      registryKeyName: "MonoField-release-stable-win",
    });
    expect(releaseAppVersionArgs("0.8.0-prerelease.2")).toEqual(["--app-version", "0.8.0-prerelease.2"]);
  });

  it("[P2] keeps stable release namespaces on the canonical display identity", () => {
    expect(resolvePackagedWinInstallIdentity({
      namespace: "release-stable-win",
      releaseVersion: "0.8.0",
    })).toEqual({
      displayName: "MonoField",
      namespaceToken: "release-stable-win",
      registryKeyName: "MonoField-release-stable-win",
    });
    expect(resolvePackagedWinInstallIdentity({
      namespace: "default",
      releaseVersion: undefined,
    })).toEqual({
      displayName: "MonoField",
      namespaceToken: "default",
      registryKeyName: "MonoField-default",
    });
  });

  it("[P2] matches first-class preview and beta release identities", () => {
    expect(resolvePackagedWinInstallIdentity({
      namespace: "release-stable-win",
      releaseVersion: "0.8.0-preview.1",
    }).displayName).toBe("MonoField Preview");
    expect(resolvePackagedWinInstallIdentity({
      namespace: "release-beta-win",
      releaseVersion: undefined,
    }).displayName).toBe("MonoField Beta");
  });

  it("[P2] keeps ad hoc namespaces isolated from release channel identities", () => {
    expect(resolvePackagedWinInstallIdentity({
      namespace: "beta-local-flow",
      releaseVersion: undefined,
    })).toEqual({
      displayName: "MonoField beta-local-flow",
      namespaceToken: "beta-local-flow",
      registryKeyName: "MonoField-beta-local-flow",
    });
    expect(releaseAppVersionArgs("   ")).toEqual([]);
  });
});
