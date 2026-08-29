import { createHash } from "node:crypto";

import {
  authorizeDesktopCredentialVaultCommand,
  createDesktopImportTokenSignature,
} from "@open-design/sidecar-proto";
import { describe, expect, it } from "vitest";

import { CredentialVaultRequestAuthorizer } from "../../src/main/credential-vault-auth.js";

describe("CredentialVaultRequestAuthorizer", () => {
  const secret = Buffer.from("credential-vault-authorizer-test-secret");
  const now = Date.parse("2026-08-29T00:00:00.000Z");

  it("accepts one valid request and rejects a replay", () => {
    const request = authorizeDesktopCredentialVaultCommand(
      secret,
      { action: "get", key: "mcp:test:server" },
      {
        expiresAt: new Date(now + 10_000).toISOString(),
        nonce: "0123456789abcdef0123456789abcdef",
      },
    );
    const authorizer = new CredentialVaultRequestAuthorizer(secret);
    expect(authorizer.authorize(request, now)).toEqual({ action: "get", key: "mcp:test:server" });
    expect(() => authorizer.authorize(request, now + 1)).toThrow(/authorization failed/i);
  });

  it("rejects a request signed by another Desktop process", () => {
    const request = authorizeDesktopCredentialVaultCommand(
      Buffer.from("another-desktop-process-secret"),
      { action: "delete", key: "mcp:test:server" },
      {
        expiresAt: new Date(now + 10_000).toISOString(),
        nonce: "fedcba9876543210fedcba9876543210",
      },
    );
    expect(() => new CredentialVaultRequestAuthorizer(secret).authorize(request, now))
      .toThrow(/authorization failed/i);
  });

  it("allows the non-secret availability probe without authorization", () => {
    expect(new CredentialVaultRequestAuthorizer(secret).authorize({ action: "available" }, now))
      .toEqual({ action: "available" });
  });

  it("does not accept an import-token HMAC as a vault authorization", () => {
    const key = "mcp:test:server";
    const nonce = "importtokenforgery0123456789abcdef";
    const expiresAt = new Date(now + 10_000).toISOString();
    const emptyValueHash = createHash("sha256").update("").digest("base64url");
    const chosenBaseDir = [
      "monofield-desktop-credential-vault-v1",
      "get",
      key,
      emptyValueHash,
    ].join("\n");
    expect(() => createDesktopImportTokenSignature(secret, chosenBaseDir, {
      exp: expiresAt,
      nonce,
    })).toThrow(/control characters/i);
    const signature = createDesktopImportTokenSignature(secret, "C:/work/project", {
      exp: expiresAt,
      nonce,
    });
    const forged = {
      action: "get" as const,
      authorization: { expiresAt, nonce, signature },
      key,
    };
    expect(() => new CredentialVaultRequestAuthorizer(secret).authorize(forged, now))
      .toThrow(/authorization failed/i);
  });
});
