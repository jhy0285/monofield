import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  stat,
  rm,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { load } from "cheerio";
import {
  javaMavenSettings,
  javaMavenProfile,
} from "../src/services/java/maven-settings.js";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "mf-java-profile-"));
  roots.push(root);
  await mkdir(path.join(root, ".mvn"));
  return root;
}
describe("Java Maven profile bridge", () => {
  it("honors project profile and repository selectors while ignoring other CLI arguments", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "settings.xml"), "<settings/>");
    await writeFile(
      path.join(root, ".mvn/maven.config"),
      "-s\nsettings.xml\n-Dmaven.repo.local=${maven.multiModuleProjectDirectory}/repo\n-Dpassword=DO_NOT_FORWARD\n",
    );
    const selectors = await javaMavenSettings(root);
    expect(selectors).toMatchObject({
      userSettings: path.join(root, "settings.xml"),
      localRepository: path.join(root, "repo"),
    });
    expect(JSON.stringify(selectors)).not.toContain("DO_NOT_FORWARD");
  });
  it("preserves the existing Maven profile without changing it and writes a private, unique repository override", async () => {
    const root = await fixture(),
      userSettings = path.join(root, "settings.xml");
    const original =
      "<settings><servers><server><id>corp</id><password>fixture-secret</password></server></servers><mirrors><mirror><id>corp-mirror</id></mirror></mirrors><localRepository>old</localRepository></settings>";
    await writeFile(userSettings, original);
    const first = await javaMavenProfile(
      {
        userSettings,
        localRepository: root + "/a&b",
        globalSettings: "/global.xml",
      },
      root,
    );
    const second = await javaMavenProfile(
      { userSettings, localRepository: root + "/a&b" },
      root,
    );
    expect(first.temporaryFile).not.toBe(second.temporaryFile);
    expect(await readFile(userSettings, "utf8")).toBe(original);
    const $ = load(await readFile(first.temporaryFile!, "utf8"), {
      xmlMode: true,
    });
    expect($("settings > localRepository")).toHaveLength(1);
    expect($("localRepository").text()).toBe(root + "/a&b");
    expect($("password").text()).toBe("fixture-secret");
    expect(first.profiles.globalSettings).toBe("/global.xml");
    expect(JSON.stringify(first)).not.toContain("fixture-secret");
    if (process.platform !== "win32")
      expect((await stat(first.temporaryFile!)).mode & 0o777).toBe(0o600);
  });
  it("rejects external entities and unresolved profile paths with no XML content in the error", async () => {
    const root = await fixture(),
      userSettings = path.join(root, "settings.xml");
    await writeFile(
      userSettings,
      '<!DOCTYPE settings SYSTEM "private-secret"><settings/>',
    );
    await expect(
      javaMavenProfile({ userSettings, localRepository: root }, root),
    ).rejects.toThrow("External entities");
    await writeFile(
      path.join(root, ".mvn/maven.config"),
      "-s\n${unknown}/settings.xml\n",
    );
    await expect(javaMavenSettings(root)).rejects.toThrow(
      "Resolve Maven profile paths",
    );
  });
});
