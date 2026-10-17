import { readFile, stat } from "node:fs/promises";

export async function runJavaToolsCli(
  args: string[],
  helpers: {
    baseUrl: (flags: Record<string, unknown>) => Promise<string>;
    parseFlags: (args: string[], spec: unknown) => Record<string, unknown>;
  },
) {
  const action = args[0] ?? "status";
  const flags = helpers.parseFlags(args.slice(1), {
    string: [
      "project",
      "file",
      "java-home",
      "line",
      "character",
      "name",
      "plan-id",
      "text-file",
      "daemon-url",
      "port",
      "class",
      "index",
      "action",
      "run-id",
      "config-id",
      "http-port",
      "url",
    ],
    boolean: ["json", "help", "resolve-dependencies"],
  });
  if (flags.help) {
    process.stdout.write(
      "Usage: monofield java start|stop|status|prepare|preparation|completion|definition|references|hover|rename-preview|rename-apply|debug-launch|debug-status|debug-attach|debug-stop|debug-command --project ID --file path.java [--java-home JDK] [--line 0 --character 0] [--name NAME] [--plan-id ID] [--text-file path|->] [--run-id ID] [--resolve-dependencies] [--port 5005] [--config-id ID --http-port 8080 --url URL] [--action breakpoint|remove-breakpoint|continue|step|next|frame|refresh] [--class example.Service --line 10] [--index 1] --json\nSemantic positions are zero-based; debugger lines and frame indexes are one-based.\n",
    );
    return;
  }
  if (typeof flags.project !== "string" || typeof flags.file !== "string")
    throw new Error("--project and --file are required");
  const base =
    (await helpers.baseUrl(flags)) +
    `/api/projects/${encodeURIComponent(flags.project)}/development/java`;
  let endpoint = "",
    body: Record<string, unknown> | undefined;
  if (action === "debug-launch") {
    const read = async (url: string) => {
      const response = await fetch(url);
      const value = (await response.json()) as any;
      if (!response.ok)
        throw new Error(value.error?.message ?? `Java HTTP ${response.status}`);
      return value;
    };
    const project = await read(
      base + `?file=${encodeURIComponent(flags.file)}`,
    );
    const development = base.replace(/\/java$/, "");
    const detected = await read(
      development +
        `/configs?projectPath=${encodeURIComponent(project.projectPath)}`,
    );
    const configs = detected.configs.filter(
      (config: any) =>
        config.framework === "Spring Boot" &&
        config.args.includes("spring-boot:run"),
    );
    const config =
      typeof flags["config-id"] === "string"
        ? configs.find((config: any) => config.id === flags["config-id"])
        : configs.length === 1
          ? configs[0]
          : undefined;
    if (!config)
      throw new Error(
        "Select a discovered Spring Boot Maven config with --config-id",
      );
    const response = await fetch(development + "/server/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectPath: project.projectPath,
        configId: config.id,
        overrides: {
          debugPort: Number(flags.port ?? 5005),
          ...(flags["http-port"] === undefined
            ? {}
            : { port: Number(flags["http-port"]) }),
          ...(flags.url === undefined ? {} : { url: flags.url }),
        },
      }),
    });
    const value = (await response.json()) as any;
    if (!response.ok)
      throw new Error(value.error?.message ?? `Java HTTP ${response.status}`);
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
    return;
  }
  if (action === "status") endpoint = `?file=${encodeURIComponent(flags.file)}`;
  else if (action === "debug-status")
    endpoint = `/debug?file=${encodeURIComponent(flags.file)}`;
  else if (action === "preparation")
    endpoint = `/preparation?file=${encodeURIComponent(flags.file)}${typeof flags["run-id"] === "string" ? `&runId=${encodeURIComponent(flags["run-id"])}` : ""}`;
  else if (action === "prepare") {
    endpoint = "/prepare";
    body = { file: flags.file };
  } else if (action === "debug-attach") {
    endpoint = "/debug/attach";
    body = {
      file: flags.file,
      port: Number(flags.port ?? 5005),
      ...(typeof flags["java-home"] === "string"
        ? { javaHome: flags["java-home"] }
        : {}),
    };
  } else if (action === "debug-stop") {
    endpoint = "/debug/stop";
    body = { file: flags.file };
  } else if (action === "debug-command") {
    endpoint = "/debug/command";
    body = {
      file: flags.file,
      action: flags.action,
      ...(flags.line === undefined ? {} : { line: Number(flags.line) }),
      ...(flags.index === undefined ? {} : { index: Number(flags.index) }),
      ...(flags.class === undefined ? {} : { className: flags.class }),
    };
  } else if (action === "start" || action === "stop") {
    endpoint = "/" + action;
    body = {
      file: flags.file,
      ...(flags["resolve-dependencies"] === true
        ? { resolveDependencies: true }
        : {}),
      ...(typeof flags["java-home"] === "string"
        ? { javaHome: flags["java-home"] }
        : {}),
    };
  } else if (action === "rename-apply") {
    endpoint = "/rename";
    body = { file: flags.file, planId: flags["plan-id"] };
  } else {
    const operation = action === "rename-preview" ? "rename" : action;
    if (
      !["completion", "definition", "references", "hover", "rename"].includes(
        operation,
      )
    )
      throw new Error("Unknown Java command");
    endpoint = "/query";
    body = {
      file: flags.file,
      operation,
      position: {
        line: Number(flags.line ?? 0),
        character: Number(flags.character ?? 0),
      },
      ...(flags.name === undefined ? {} : { newName: flags.name }),
    };
    if (typeof flags["text-file"] === "string") {
      const file = flags["text-file"];
      if (file === "-") {
        const parts: Buffer[] = [];
        let size = 0;
        for await (const part of process.stdin) {
          const buffer = Buffer.from(part);
          size += buffer.length;
          if (size > 512 * 1024) throw new Error("Java text exceeds 512 KiB");
          parts.push(buffer);
        }
        body.text = Buffer.concat(parts).toString("utf8");
      } else {
        if ((await stat(file)).size > 512 * 1024)
          throw new Error("Java text exceeds 512 KiB");
        body.text = await readFile(file, "utf8");
      }
    }
  }
  const response = await fetch(base + endpoint, {
    method: body ? "POST" : "GET",
    ...(body
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const result = (await response.json()) as { error?: { message?: string } };
  if (!response.ok)
    throw new Error(result.error?.message ?? `Java HTTP ${response.status}`);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
