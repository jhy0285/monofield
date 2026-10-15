import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { load } from "cheerio";

/** Select Maven's existing profiles by path. Never read or expose credential contents. */
export async function javaMavenSettings(root: string): Promise<{
  globalSettings?: string;
  userSettings?: string;
  localRepository?: string;
  projectProfileSelected?: boolean;
}> {
  const settings: {
    globalSettings?: string;
    userSettings?: string;
    localRepository?: string;
    projectProfileSelected?: boolean;
  } = {};
  const exists = async (file: string) =>
    (await stat(file).catch(() => null))?.isFile() ?? false;
  const user = path.join(os.homedir(), ".m2", "settings.xml");
  if (await exists(user)) settings.userSettings = user;
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(
      directory,
      process.platform === "win32" ? "mvn.cmd" : "mvn",
    );
    if (!(await exists(candidate))) continue;
    const launcher = await realpath(candidate);
    const global = path.join(
      path.dirname(path.dirname(launcher)),
      "conf",
      "settings.xml",
    );
    if (await exists(global)) settings.globalSettings = global;
    break;
  }
  const config = path.join(root, ".mvn", "maven.config");
  if (await exists(config)) {
    if ((await stat(config)).size > 32768)
      throw new Error("Maven configuration exceeds 32 KiB");
    // Maven 3.9 uses one argument per line. Only profile/repository selectors
    // are forwarded, never arbitrary flags, commands or credential values.
    const args = (await readFile(config, "utf8"))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    const resolvePath = (value: string) => {
      value = value
        .replace(/^(["'])(.*)\1$/, "$2")
        .replaceAll("${maven.multiModuleProjectDirectory}", root)
        .replaceAll("${user.home}", os.homedir());
      if (value.includes("${"))
        throw new Error(
          "Resolve Maven profile paths before starting Java tools",
        );
      return path.resolve(root, value);
    };
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (["-s", "--settings", "-gs", "--global-settings"].includes(arg)) {
        settings.projectProfileSelected = true;
        if (!args[i + 1]) throw new Error("Maven profile path is missing");
        const value = resolvePath(args[++i]!);
        if (!(await exists(value)))
          throw new Error("Selected Maven settings file is unavailable");
        if (arg === "-s" || arg === "--settings") settings.userSettings = value;
        else settings.globalSettings = value;
      } else if (arg.startsWith("-Dmaven.repo.local="))
        settings.localRepository = resolvePath(
          arg.slice("-Dmaven.repo.local=".length),
        );
    }
  }
  return settings;
}

/** m2e ignores Maven CLI's repo property. Preserve the selected user profile
 * and change only its repository selector in a private, session-owned file.
 * The XML is never returned through the API, logged, or placed in the project.
 */
export async function javaMavenProfile(
  settings: Awaited<ReturnType<typeof javaMavenSettings>>,
  work: string,
) {
  const { localRepository, projectProfileSelected, ...profiles } = settings;
  // m2e gives project-selected profiles precedence over workspace profiles.
  // Keep that selector intact; explicit online preparation is the recovery for
  // CLI repository overrides that embedded Maven does not honor.
  if (!localRepository || projectProfileSelected)
    return { profiles, temporaryFile: null };
  let xml = "<settings/>";
  if (profiles.userSettings) {
    if ((await stat(profiles.userSettings)).size > 1024 * 1024)
      throw new Error("Maven settings exceed 1 MiB");
    xml = await readFile(profiles.userSettings, "utf8");
  }
  // Profiles containing external entities are not suitable for this bridge.
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("External entities in Maven settings are unsupported");
  const $ = load(xml, { xmlMode: true });
  const root = $.root().children();
  if (root.length !== 1 || root[0]?.tagName !== "settings")
    throw new Error("Selected Maven settings have no settings root");
  root.children("localRepository").remove();
  const repository = $("<localRepository/>").text(localRepository);
  root.prepend(repository);
  const temporaryFile = path.join(work, `maven-session-${randomUUID()}.xml`);
  await writeFile(temporaryFile, $.xml(), { mode: 0o600, flag: "wx" });
  return {
    profiles: { ...profiles, userSettings: temporaryFile },
    temporaryFile,
  };
}
