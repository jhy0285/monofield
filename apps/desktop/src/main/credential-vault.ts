import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";

import {
  type DesktopCredentialVaultCommand,
  type DesktopCredentialVaultResult,
} from "@open-design/sidecar-proto";
import { app, safeStorage } from "electron";

const STORAGE_FILE = "credential-vault.v1.enc";

type StoredDocument = {
  version: 1;
  entries: Record<string, string>;
};

export interface CredentialVaultOptions {
  platform?: NodeJS.Platform;
}

function storagePath(): string {
  return join(app.getPath("userData"), STORAGE_FILE);
}

function safeVaultError(error: unknown): Error {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT") return new Error("credential vault was not found");
  return new Error("OS credential vault could not be read");
}

async function renameVaultAtomically(temporary: string, file: string): Promise<void> {
  const retryDelays = process.platform === "win32" ? [10, 25, 50, 100] : [];
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(temporary, file);
      return;
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= retryDelays.length || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) {
        throw error;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, retryDelays[attempt]));
    }
  }
}

export function credentialVaultEncryptionAvailable(platform: NodeJS.Platform = process.platform): boolean {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (platform !== "linux") return true;

    // Electron's Linux basic_text backend encrypts with a fixed, public key.
    // Treat only OS credential-store-backed implementations as a usable vault.
    const backend = safeStorage.getSelectedStorageBackend();
    return backend === "gnome_libsecret"
      || backend === "kwallet"
      || backend === "kwallet5"
      || backend === "kwallet6";
  } catch {
    return false;
  }
}

export class CredentialVault {
  private mutationQueue: Promise<void> = Promise.resolve();
  private cachedDocument: StoredDocument | null = null;
  private loadPromise: Promise<StoredDocument> | null = null;
  private readonly platform: NodeJS.Platform;

  constructor(options: CredentialVaultOptions = {}) {
    this.platform = options.platform ?? process.platform;
  }

  private assertEncryptionAvailable(): void {
    if (!credentialVaultEncryptionAvailable(this.platform)) {
      throw new Error("OS credential encryption is unavailable");
    }
  }

  private async readFromDisk(): Promise<StoredDocument> {
    this.assertEncryptionAvailable();
    try {
      const encrypted = await fs.readFile(storagePath());
      const plaintext = safeStorage.decryptString(encrypted);
      const document = JSON.parse(plaintext) as StoredDocument;
      if (document.version !== 1 || document.entries == null || typeof document.entries !== "object" || Array.isArray(document.entries)) {
        throw new Error("invalid credential vault");
      }
      return { version: 1, entries: { ...document.entries } };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, entries: {} };
      throw safeVaultError(error);
    }
  }

  private async read(): Promise<StoredDocument> {
    this.assertEncryptionAvailable();
    if (this.cachedDocument) return this.cachedDocument;
    if (!this.loadPromise) {
      this.loadPromise = this.readFromDisk()
        .then((document) => {
          this.cachedDocument = document;
          return document;
        })
        .finally(() => {
          this.loadPromise = null;
        });
    }
    return await this.loadPromise;
  }

  private async write(document: StoredDocument): Promise<void> {
    this.assertEncryptionAvailable();
    const file = storagePath();
    const temporary = `${file}.${randomUUID()}.tmp`;
    const directory = app.getPath("userData");
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.chmod(directory, 0o700).catch(() => undefined);
    try {
      await fs.writeFile(temporary, safeStorage.encryptString(JSON.stringify(document)), { mode: 0o600 });
      await renameVaultAtomically(temporary, file);
      await fs.chmod(file, 0o600).catch(() => undefined);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.mutationQueue.catch(() => undefined).then(operation);
    this.mutationQueue = task.then(() => undefined, () => undefined);
    return await task;
  }

  async execute(request: DesktopCredentialVaultCommand): Promise<DesktopCredentialVaultResult> {
    if (request.action === "available") {
      return { action: "available", available: credentialVaultEncryptionAvailable(this.platform) };
    }
    if (request.action === "get") {
      const document = await this.read();
      return { action: "get", value: document.entries[request.key] ?? null };
    }
    if (request.action === "set") {
      return await this.mutate(async () => {
        const document = await this.read();
        const updated: StoredDocument = {
          version: 1,
          entries: { ...document.entries, [request.key]: request.value },
        };
        await this.write(updated);
        this.cachedDocument = updated;
        return { action: "set", stored: true };
      });
    }
    return await this.mutate(async () => {
      const document = await this.read();
      const deleted = Object.prototype.hasOwnProperty.call(document.entries, request.key);
      if (deleted) {
        const entries = { ...document.entries };
        delete entries[request.key];
        const updated: StoredDocument = { version: 1, entries };
        await this.write(updated);
        this.cachedDocument = updated;
      }
      return { action: "delete", deleted };
    });
  }
}
