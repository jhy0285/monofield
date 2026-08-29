import {
  verifyDesktopCredentialVaultRequest,
  type DesktopCredentialVaultCommand,
  type DesktopCredentialVaultRequest,
} from "@open-design/sidecar-proto";

/**
 * Authenticates daemon-to-Desktop vault traffic with the same ephemeral,
 * per-Desktop-process secret used by the folder-import gate. A successful
 * nonce is accepted once only, which prevents another local process from
 * replaying a captured request against the predictable sidecar socket.
 */
export class CredentialVaultRequestAuthorizer {
  private readonly consumedNonces = new Map<string, number>();

  constructor(private readonly secret: Buffer) {}

  private pruneExpired(now: number): void {
    for (const [nonce, expiresAt] of this.consumedNonces) {
      if (expiresAt <= now) this.consumedNonces.delete(nonce);
    }
  }

  authorize(request: DesktopCredentialVaultRequest, now = Date.now()): DesktopCredentialVaultCommand {
    if (request.action === "available") return request;
    this.pruneExpired(now);
    const verification = verifyDesktopCredentialVaultRequest(this.secret, request, now);
    if (!verification.ok) {
      throw new Error("credential vault request authorization failed");
    }
    if (this.consumedNonces.has(verification.nonce)) {
      throw new Error("credential vault request authorization failed");
    }
    this.consumedNonces.set(verification.nonce, verification.expiresAt);
    return verification.command;
  }
}
