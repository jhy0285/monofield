import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import JSZip from "jszip";
import { EnvHttpProxyAgent, fetch } from "undici";

export const JAVA_TOOLS_VERSION = "redhat.java-1.56.0";
const SHA256 =
  "3c6a821d7612eb879fa40280b6c585342eec82d6b1b3e8dcfe4d0395e0624343";
const DOWNLOAD =
  "https://open-vsx.org/api/redhat/java/1.56.0/file/redhat.java-1.56.0.vsix";
const installs = new Map<string, Promise<string>>();
export const javaToolsDirectory = (dataRoot: string) =>
  path.join(dataRoot, "java-tools", JAVA_TOOLS_VERSION);
export async function javaToolsInstalled(dataRoot: string) {
  try {
    return (
      JSON.parse(
        await readFile(
          path.join(javaToolsDirectory(dataRoot), "installation.json"),
          "utf8",
        ),
      ).sha256 === SHA256
    );
  } catch {
    return false;
  }
}
/** Explicit setup only. Fixed public artifact, digest verified before extraction; no package changes. */
export async function installJavaTools(dataRoot: string): Promise<string> {
  const directory = javaToolsDirectory(dataRoot);
  if (await javaToolsInstalled(dataRoot)) return directory;
  const existing = installs.get(directory);
  if (existing) return existing;
  const job = (async () => {
    const agent = new EnvHttpProxyAgent();
    const temporary = directory + "." + randomUUID() + ".tmp";
    try {
      const response = await fetch(DOWNLOAD, {
        dispatcher: agent,
        signal: AbortSignal.timeout(120000),
      });
      if (!response.ok || !response.body)
        throw new Error(`Java tools download failed (${response.status})`);
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const part of response.body) {
        size += part.length;
        if (size > 64 * 1024 * 1024)
          throw new Error("Java tools download exceeds 64 MiB");
        chunks.push(Buffer.from(part));
      }
      const buffer = Buffer.concat(chunks);
      if (createHash("sha256").update(buffer).digest("hex") !== SHA256)
        throw new Error("Java tools checksum mismatch");
      const archive = await JSZip.loadAsync(buffer);
      await mkdir(temporary, { recursive: true });
      let extracted = 0;
      const entries = Object.entries(archive.files);
      if (entries.length > 4000)
        throw new Error("Java tools archive entry limit");
      for (const [name, entry] of entries) {
        if (
          entry.dir ||
          (!name.startsWith("extension/server/") &&
            name !== "extension/LICENSE.txt")
        )
          continue;
        const relative = name.replace(/^extension\//, "");
        const destination = path.resolve(temporary, relative);
        if (
          !destination.startsWith(temporary + path.sep) ||
          relative.split("/").includes("..")
        )
          throw new Error("Invalid Java tools archive path");
        const content = await entry.async("nodebuffer");
        extracted += content.length;
        if (extracted > 180 * 1024 * 1024)
          throw new Error("Java tools extraction limit");
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, content);
      }
      await writeFile(
        path.join(temporary, "installation.json"),
        JSON.stringify({
          version: JAVA_TOOLS_VERSION,
          sha256: SHA256,
          source: DOWNLOAD,
          license: "EPL-2.0",
        }),
      );
      await mkdir(path.dirname(directory), { recursive: true });
      await rename(temporary, directory);
      return directory;
    } finally {
      await agent.close();
      await rm(temporary, { recursive: true, force: true });
    }
  })();
  installs.set(directory, job);
  try {
    return await job;
  } finally {
    installs.delete(directory);
  }
}
export async function javaLauncher(dataRoot: string) {
  const directory = javaToolsDirectory(dataRoot),
    plugins = path.join(directory, "server/plugins");
  const matches = (await readdir(plugins)).filter((name) =>
    /^org\.eclipse\.equinox\.launcher_[\w.-]+\.jar$/.test(name),
  );
  if (matches.length !== 1)
    throw new Error(
      "Java language launcher is unavailable; reinstall Java tools",
    );
  const platform =
    process.platform === "win32"
      ? "win"
      : process.platform === "darwin"
        ? "mac"
        : "linux";
  const config = path.join(
    directory,
    `server/config_${platform}${process.arch === "arm64" ? "_arm" : ""}`,
  );
  if (!(await stat(config)).isDirectory())
    throw new Error("This Java tools platform is unavailable");
  return { jar: path.join(plugins, matches[0]!), config };
}
