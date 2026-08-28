import { afterEach, describe, expect, it } from "vitest";
import { join, resolve } from "node:path";

import { resolveToolPackConfig, WORKSPACE_ROOT } from "../src/config.js";

const savedTelemetryRelayUrl = process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL;
const savedPosthogKey = process.env.POSTHOG_KEY;
const savedPosthogHost = process.env.POSTHOG_HOST;
const savedAmrProfile = process.env.OPEN_DESIGN_AMR_PROFILE;
const savedStoreIdentityName = process.env.MONOFIELD_WINDOWS_STORE_IDENTITY_NAME;
const savedStorePublisher = process.env.MONOFIELD_WINDOWS_STORE_PUBLISHER;
const savedStorePublisherDisplayName = process.env.MONOFIELD_WINDOWS_STORE_PUBLISHER_DISPLAY_NAME;
const savedMonoFieldUpdateMetadataUrl = process.env.MONOFIELD_UPDATE_METADATA_URL;
const savedLegacyUpdateMetadataUrl = process.env.OD_UPDATE_METADATA_URL;

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value == null) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  if (savedTelemetryRelayUrl == null) {
    delete process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL;
  } else {
    process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL = savedTelemetryRelayUrl;
  }
  if (savedPosthogKey == null) {
    delete process.env.POSTHOG_KEY;
  } else {
    process.env.POSTHOG_KEY = savedPosthogKey;
  }
  if (savedPosthogHost == null) {
    delete process.env.POSTHOG_HOST;
  } else {
    process.env.POSTHOG_HOST = savedPosthogHost;
  }
  if (savedAmrProfile == null) {
    delete process.env.OPEN_DESIGN_AMR_PROFILE;
  } else {
    process.env.OPEN_DESIGN_AMR_PROFILE = savedAmrProfile;
  }
  restoreEnvironment("MONOFIELD_WINDOWS_STORE_IDENTITY_NAME", savedStoreIdentityName);
  restoreEnvironment("MONOFIELD_WINDOWS_STORE_PUBLISHER", savedStorePublisher);
  restoreEnvironment("MONOFIELD_WINDOWS_STORE_PUBLISHER_DISPLAY_NAME", savedStorePublisherDisplayName);
  restoreEnvironment("MONOFIELD_UPDATE_METADATA_URL", savedMonoFieldUpdateMetadataUrl);
  restoreEnvironment("OD_UPDATE_METADATA_URL", savedLegacyUpdateMetadataUrl);
});

describe("resolveToolPackConfig update feed", () => {
  it("bakes the public GitHub latest-release feed into stable desktop builds", () => {
    delete process.env.MONOFIELD_UPDATE_METADATA_URL;
    delete process.env.OD_UPDATE_METADATA_URL;
    expect(resolveToolPackConfig("win", { appVersion: "0.11.4" }).updateMetadataUrl).toBe(
      "https://api.github.com/repos/jhy0285/monofield/releases/latest",
    );
    expect(resolveToolPackConfig("win", { appVersion: "0.11.4-beta.1" }).updateMetadataUrl).toBeUndefined();
  });

  it("prefers the MonoField override while retaining the legacy compatibility env", () => {
    process.env.OD_UPDATE_METADATA_URL = "https://legacy.example.test/metadata.json";
    process.env.MONOFIELD_UPDATE_METADATA_URL = "https://updates.example.test/metadata.json";
    expect(resolveToolPackConfig("win", { appVersion: "0.11.4" }).updateMetadataUrl).toBe(
      "https://updates.example.test/metadata.json",
    );
  });
});

describe("resolveToolPackConfig AMR profile", () => {
  it("bakes OPEN_DESIGN_AMR_PROFILE into packaged config when set at build time", () => {
    process.env.OPEN_DESIGN_AMR_PROFILE = "test";
    const config = resolveToolPackConfig("mac", { namespace: "amr-profile-test" });
    expect(config.amrProfile).toBe("test");
  });

  it("rejects unsupported AMR profiles before packaging", () => {
    process.env.OPEN_DESIGN_AMR_PROFILE = "staging";
    expect(() => resolveToolPackConfig("mac")).toThrow(
      /OPEN_DESIGN_AMR_PROFILE must be prod, test, or local/,
    );
  });
});

describe("resolveToolPackConfig Vela CLI requirement", () => {
  it("defaults to optional Vela CLI bundling", () => {
    const config = resolveToolPackConfig("mac", { namespace: "vela-optional-test" });
    expect(config.requireVelaCli).toBe(false);
  });

  it("reads --require-vela-cli from build options", () => {
    const config = resolveToolPackConfig("mac", {
      namespace: "vela-required-test",
      requireVelaCli: true,
    });
    expect(config.requireVelaCli).toBe(true);
  });
});

describe("resolveToolPackConfig win build target", () => {
  it("accepts the portable zip target and rejects unsupported values", () => {
    expect(resolveToolPackConfig("win", { to: "zip" }).to).toBe("zip");
    expect(resolveToolPackConfig("win", { to: "all" }).to).toBe("all");
    expect(resolveToolPackConfig("win", { to: "nsis" }).to).toBe("nsis");
    expect(() => resolveToolPackConfig("win", { to: "dmg" })).toThrow(/unsupported win --to target: dmg/);
  });

  it("requires the exact Partner Center identity for Store builds", () => {
    delete process.env.MONOFIELD_WINDOWS_STORE_IDENTITY_NAME;
    delete process.env.MONOFIELD_WINDOWS_STORE_PUBLISHER;
    delete process.env.MONOFIELD_WINDOWS_STORE_PUBLISHER_DISPLAY_NAME;
    expect(() => resolveToolPackConfig("win", { to: "store" })).toThrow(
      /MONOFIELD_WINDOWS_STORE_IDENTITY_NAME is required/,
    );

    process.env.MONOFIELD_WINDOWS_STORE_IDENTITY_NAME = "12345MonoField.Desktop";
    process.env.MONOFIELD_WINDOWS_STORE_PUBLISHER = "CN=01234567-89ab-cdef-0123-456789abcdef";
    process.env.MONOFIELD_WINDOWS_STORE_PUBLISHER_DISPLAY_NAME = "MonoField contributors";
    expect(resolveToolPackConfig("win", { to: "store" })).toMatchObject({
      to: "store",
      windowsStoreIdentity: {
        identityName: "12345MonoField.Desktop",
        publisher: "CN=01234567-89ab-cdef-0123-456789abcdef",
        publisherDisplayName: "MonoField contributors",
      },
    });
  });
});

describe("resolveToolPackConfig cache root", () => {
  it("keeps the default cache outside custom tools-pack roots", () => {
    const config = resolveToolPackConfig("win", {
      dir: "C:\\odqa-release-4ch",
      namespace: "cache-root-test",
    });

    expect(config.roots.toolPackRoot).toBe(resolve("C:\\odqa-release-4ch"));
    expect(config.roots.cacheRoot).toBe(resolve(join(WORKSPACE_ROOT, ".tmp", "tools-pack", "cache")));
  });

  it("uses an explicit cache-dir when supplied", () => {
    const config = resolveToolPackConfig("win", {
      cacheDir: "C:\\odqa-tools-pack-cache",
      dir: "C:\\odqa-release-4ch",
      namespace: "cache-root-test",
    });

    expect(config.roots.toolPackRoot).toBe(resolve("C:\\odqa-release-4ch"));
    expect(config.roots.cacheRoot).toBe(resolve("C:\\odqa-tools-pack-cache"));
  });
});

describe("resolveToolPackConfig namespace defaults", () => {
  it("keeps ordinary local builds on the default namespace", () => {
    expect(resolveToolPackConfig("mac").namespace).toBe("default");
    expect(resolveToolPackConfig("win", { appVersion: "0.8.0" }).namespace).toBe("default");
  });

  it("defaults prerelease mac builds to their release channel namespace", () => {
    expect(resolveToolPackConfig("mac", { appVersion: "0.8.0-beta.4" }).namespace).toBe("release-beta");
    expect(resolveToolPackConfig("mac", { appVersion: "0.8.0-preview.4" }).namespace).toBe("release-preview");
    expect(resolveToolPackConfig("mac", { appVersion: "0.8.0-prerelease.4" }).namespace).toBe("release-prerelease");
  });

  it("defaults prerelease non-mac builds to platform-specific release channel namespaces", () => {
    expect(resolveToolPackConfig("win", { appVersion: "0.8.0-beta.4" }).namespace).toBe("release-beta-win");
    expect(resolveToolPackConfig("linux", { appVersion: "0.8.0-preview.4" }).namespace).toBe("release-preview-linux");
    expect(resolveToolPackConfig("win", { appVersion: "0.8.0-prerelease.4" }).namespace).toBe("release-prerelease-win");
  });

  it("keeps an explicit namespace ahead of the prerelease channel default", () => {
    expect(resolveToolPackConfig("mac", { appVersion: "0.8.0-beta.4", namespace: "custom-beta" }).namespace).toBe(
      "custom-beta",
    );
  });
});

describe("resolveToolPackConfig telemetry relay", () => {
  it("ignores legacy telemetry relay env for packaged config", () => {
    process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL = "https://telemetry.open-design.ai/api/langfuse//";
    expect(() => resolveToolPackConfig("mac", { namespace: "telemetry-test" })).not.toThrow();
  });

  it("does not validate ignored telemetry relay URLs", () => {
    process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL = "not-a-url";
    expect(() => resolveToolPackConfig("mac")).not.toThrow();
  });
});

describe("resolveToolPackConfig PostHog analytics", () => {
  it("ignores legacy analytics env for packaged config", () => {
    process.env.POSTHOG_KEY = "phc_test_abc123";
    process.env.POSTHOG_HOST = "https://us.i.posthog.com";
    expect(() => resolveToolPackConfig("mac", { namespace: "analytics-test" })).not.toThrow();
  });

  it("does not validate ignored legacy analytics env", () => {
    process.env.POSTHOG_KEY = "phc_test abc";
    process.env.POSTHOG_HOST = "not-a-url";
    expect(() => resolveToolPackConfig("mac")).not.toThrow();
  });
});
