import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  rm,
  lstat,
} from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { load } from "cheerio";

/** JDT performs an initial Eclipse build even when autobuild is disabled.
 * Isolate its Maven model and output in daemon-owned analysis copies. */
export class JavaSourceMirror {
  private hashes = new Map<string, string>();
  private initialized = false;
  private pending: Promise<string[]> | null = null;
  constructor(
    readonly original: string,
    readonly root: string,
    private readonly dataRoot?: string,
  ) {}
  async sync(): Promise<string[]> {
    if (this.pending) return this.pending;
    const job = this.synchronize();
    this.pending = job;
    try {
      return await job;
    } finally {
      if (this.pending === job) this.pending = null;
    }
  }
  sourceHashes() {
    return new Map(this.hashes);
  }
  private async synchronize(): Promise<string[]> {
    if (!this.initialized) {
      await rm(this.root, { recursive: true, force: true });
      this.initialized = true;
    }
    const seen = new Set<string>(),
      changed: string[] = [];
    let bytes = 0,
      files = 0;
    const skipped = new Set([
      ".git",
      ".hg",
      ".svn",
      "node_modules",
      ".idea",
      ".mvn",
    ]);
    let entries = 0;
    const visit = async (relative: string) => {
      for (const item of await readdir(path.join(this.original, relative), {
        withFileTypes: true,
      })) {
        if (++entries > 50000)
          throw new Error(
            "Java analysis inventory exceeds 50000 entries; select a smaller workspace",
          );
        const name = path.posix.join(relative, item.name);
        if (item.isDirectory()) {
          if (skipped.has(item.name)) continue;
          const absolute = path.resolve(this.original, name);
          if (
            absolute === path.dirname(this.root) ||
            (this.dataRoot &&
              this.dataRoot !== this.original &&
              absolute === path.resolve(this.dataRoot))
          )
            continue;
          const module = await lstat(
            path.join(this.original, relative, "pom.xml"),
          )
            .then((stat) => stat.isFile())
            .catch(() => false);
          if (module && ["build", "dist"].includes(item.name)) continue;
          if (item.name === "target" && module) {
            for (const generated of [
              "generated-sources",
              "generated-test-sources",
            ]) {
              const next = path.posix.join(name, generated);
              if (
                await lstat(path.join(this.original, next))
                  .then((stat) => stat.isDirectory())
                  .catch(() => false)
              )
                await visit(next);
            }
          } else await visit(name);
          continue;
        }
        if (
          !/\.java$|(?:^|\/)pom\.xml$|(?:^|\/)\.settings\/[^/]+\.prefs$/.test(
            name,
          )
        )
          continue;
        if (item.isSymbolicLink() || !item.isFile())
          throw new Error("Java analysis copies require regular project files");
        if (++files > 10000)
          throw new Error(
            "Java analysis exceeds 10000 source/configuration files; select a smaller workspace",
          );
        const source = path.join(this.original, name);
        const size = (await lstat(source)).size;
        bytes += size;
        if (size > 2 * 1024 * 1024 || bytes > 64 * 1024 * 1024)
          throw new Error(
            "Java analysis source copy exceeds its 64 MiB budget",
          );
        const buffer = await readFile(source);
        const hash = createHash("sha256").update(buffer).digest("hex");
        seen.add(name);
        if (this.hashes.get(name) === hash) continue;
        let content: Buffer | string = buffer;
        if (item.name === "pom.xml") {
          const xml = buffer.toString("utf8");
          if (/<!DOCTYPE|<!ENTITY/i.test(xml))
            throw new Error(
              "External entities in analysis POMs are unsupported",
            );
          const $ = load(xml, { xmlMode: true }),
            project = $.root().children("project");
          if (project.length !== 1)
            throw new Error("Java analysis requires a Maven project XML root");
          if (!project.children("build").length) project.append("<build/>");
          // Also override profile-specific output directories; never inherit an
          // absolute customer output path into the private analysis build.
          $("project > build, project > profiles > profile > build").each(
            (_index, element) => {
              const build = $(element);
              for (const [key, value] of Object.entries({
                directory: "${project.basedir}/target",
                outputDirectory: "${project.basedir}/target/classes",
                testOutputDirectory: "${project.basedir}/target/test-classes",
              })) {
                build.children(key).remove();
                build.append($(`<${key}/>`).text(value));
              }
            },
          );
          content = $.xml();
        }
        const destination = path.join(this.root, name);
        await mkdir(path.dirname(destination), {
          recursive: true,
          mode: 0o700,
        });
        await writeFile(destination, content, { mode: 0o600 });
        this.hashes.set(name, hash);
        changed.push(name);
      }
    };
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await visit("");
    for (const name of this.hashes.keys())
      if (!seen.has(name)) {
        await rm(path.join(this.root, name), { force: true });
        this.hashes.delete(name);
        changed.push(name);
      }
    return changed;
  }
}
