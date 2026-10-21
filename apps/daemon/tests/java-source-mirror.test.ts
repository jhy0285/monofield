import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { load } from "cheerio";
import { JavaSourceMirror } from "../src/services/java/source-mirror.js";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
describe("isolated Java analysis copies", () => {
  it("isolates inherited/absolute build outputs, copies code but not Maven binaries or auth files, and synchronizes deletion", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mf-java-mirror-"));
    roots.push(root);
    const source = root + "/project",
      copy = root + "/copy";
    await mkdir(source + "/src/main/java", { recursive: true });
    await mkdir(source + "/target/classes", { recursive: true });
    await mkdir(source + "/.mvn", { recursive: true });
    const pom =
      "<project><modelVersion>4.0.0</modelVersion><build><outputDirectory>/customer/classes</outputDirectory></build><profiles><profile><id>corp</id><build><testOutputDirectory>/customer/test</testOutputDirectory></build></profile></profiles></project>";
    await writeFile(source + "/pom.xml", pom);
    await writeFile(source + "/src/main/java/Service.java", "class Service {}");
    await writeFile(source + "/target/classes/Service.class", "MAVEN-BYTECODE");
    await writeFile(source + "/.mvn/settings.xml", "PRIVATE-PROFILE");
    const mirror = new JavaSourceMirror(source, copy);
    await mirror.sync();
    const $ = load(await readFile(copy + "/pom.xml", "utf8"), {
      xmlMode: true,
    });
    expect(
      $("outputDirectory")
        .map((_i, e) => $(e).text())
        .get(),
    ).toEqual([
      "${project.basedir}/target/classes",
      "${project.basedir}/target/classes",
    ]);
    expect(await readFile(source + "/pom.xml", "utf8")).toBe(pom);
    await expect(
      readFile(copy + "/target/classes/Service.class"),
    ).rejects.toThrow();
    await expect(readFile(copy + "/.mvn/settings.xml")).rejects.toThrow();
    expect(await mirror.sync()).toEqual([]);
    await rm(source + "/src/main/java/Service.java");
    expect(await mirror.sync()).toEqual(["src/main/java/Service.java"]);
    await expect(
      readFile(copy + "/src/main/java/Service.java"),
    ).rejects.toThrow();
    await mkdir(source + "/src/main/java/example/data", { recursive: true });
    await writeFile(
      source + "/src/main/java/example/data/Record.java",
      "class Record {}",
    );
    await mirror.sync();
    expect(
      await readFile(copy + "/src/main/java/example/data/Record.java", "utf8"),
    ).toBe("class Record {}");
    await writeFile(copy + "/Stale.java", "class Stale {}");
    await new JavaSourceMirror(source, copy).sync();
    await expect(readFile(copy + "/Stale.java")).rejects.toThrow();
  });
  it.skipIf(process.platform === "win32")(
    "rejects Java source symlinks rather than copying files outside the project",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "mf-java-link-"));
      roots.push(root);
      await mkdir(root + "/source");
      await writeFile(root + "/external.java", "class External {}");
      await symlink(root + "/external.java", root + "/source/External.java");
      await expect(
        new JavaSourceMirror(root + "/source", root + "/copy").sync(),
      ).rejects.toThrow("regular project files");
    },
  );
});
