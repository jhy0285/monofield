import { afterEach, describe, expect, it } from "vitest";

import {
  normalizePublicOrigin,
  publicUrl,
  requiredPublicOrigin,
} from "../src/storage/common.ts";

const ORIGINAL_PUBLIC_ORIGIN = process.env.RELEASE_PUBLIC_ORIGIN;

afterEach(() => {
  if (ORIGINAL_PUBLIC_ORIGIN == null) {
    delete process.env.RELEASE_PUBLIC_ORIGIN;
  } else {
    process.env.RELEASE_PUBLIC_ORIGIN = ORIGINAL_PUBLIC_ORIGIN;
  }
});

describe("release public origin", () => {
  it("requires an explicitly configured HTTPS origin", () => {
    delete process.env.RELEASE_PUBLIC_ORIGIN;
    expect(() => requiredPublicOrigin()).toThrow("RELEASE_PUBLIC_ORIGIN is required");

    process.env.RELEASE_PUBLIC_ORIGIN = "   ";
    expect(() => requiredPublicOrigin()).toThrow("must be an explicit HTTPS URL");

    process.env.RELEASE_PUBLIC_ORIGIN = "https://releases.corp.example/open-docs/";
    expect(requiredPublicOrigin()).toBe("https://releases.corp.example/open-docs");
  });

  it.each([
    "releases.corp.example/open-docs",
    "http://releases.corp.example/open-docs",
    "https://user:secret@releases.corp.example/open-docs",
    "https://releases.corp.example/open-docs?channel=beta",
    "https://releases.corp.example/open-docs#beta",
  ])("rejects unsafe or ambiguous origin %s", (value) => {
    expect(() => normalizePublicOrigin(value)).toThrow("must be an explicit HTTPS URL");
  });

  it("constructs metadata URLs only beneath the validated origin", () => {
    expect(publicUrl(
      "https://releases.corp.example/open-docs/",
      "/betas/versions/1.2.3-betas.1/",
      "metadata.json",
    )).toBe("https://releases.corp.example/open-docs/betas/versions/1.2.3-betas.1/metadata.json");
  });
});
