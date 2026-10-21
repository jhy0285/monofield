import type { Express } from "express";
import path from "node:path";
import { realpath } from "node:fs/promises";
import { getProject } from "../db.js";
import { resolveProjectDir } from "../projects.js";
import { discoverDevelopmentProjects } from "../development-projects.js";
import type { RouteDeps } from "../server-context.js";
import { projectRelativePath } from "../services/change-policy.js";
import type {
  JavaLanguageService,
  JavaTarget,
} from "../services/java/language-service.js";
import type { JavaDebugService } from "../services/java/debug-service.js";
import { javaBreakpointClass } from "../services/java/source-info.js";

export interface RegisterJavaToolsRoutesDeps
  extends RouteDeps<"db" | "http" | "paths" | "projectFiles" | "verification"> {
  javaLanguage: JavaLanguageService;
  javaDebug: JavaDebugService;
}
export function registerJavaToolsRoutes(
  app: Express,
  deps: RegisterJavaToolsRoutesDeps,
) {
  const base = "/api/projects/:id/development/java";
  const gate = deps.http.requireLocalDaemonRequest;
  async function selected(id: string, file: unknown, requireSource = true) {
    const project = getProject(deps.db, id);
    if (!project)
      throw Object.assign(new Error("Project not found"), { status: 404 });
    if (
      typeof file !== "string" ||
      !projectRelativePath(file) ||
      !file.endsWith(".java")
    )
      throw new Error("A project-relative Java source file is required");
    const loaded = requireSource
      ? await deps.projectFiles.readProjectFile(
          deps.paths.PROJECTS_DIR,
          id,
          file,
          project.metadata,
        )
      : { name: file, buffer: Buffer.alloc(0) };
    if (loaded.buffer.length > 512 * 1024)
      throw new Error("Java source exceeds 512 KiB");
    const workspaceRoot = await realpath(
      resolveProjectDir(deps.paths.PROJECTS_DIR, id, project.metadata),
    );
    const projects = await discoverDevelopmentProjects(workspaceRoot);
    const module = projects
      .filter(
        (module) =>
          module.path === "." || loaded.name.startsWith(module.path + "/"),
      )
      .sort((a, b) => b.path.length - a.path.length)[0];
    const projectPath = module?.path ?? ".";
    const root = await realpath(path.resolve(workspaceRoot, projectPath));
    if (root !== path.resolve(workspaceRoot, projectPath))
      throw new Error("Java module contains a symlink");
    const target: JavaTarget = {
      projectId: id,
      workspaceRoot,
      root,
      projectPath,
    };
    const read = (name: string) =>
      deps.projectFiles.readProjectFile(
        deps.paths.PROJECTS_DIR,
        id,
        name,
        project.metadata,
      );
    const write = (
      name: string,
      buffer: Buffer,
      expectedContentSha256: string,
    ) =>
      deps.projectFiles.writeProjectFile(
        deps.paths.PROJECTS_DIR,
        id,
        name,
        buffer,
        { expectedContentSha256 },
        project.metadata,
      );
    return { target, loaded, read, write };
  }
  const fail = (res: import("express").Response, error: unknown) =>
    deps.http.sendApiError(
      res,
      Number((error as { status?: number })?.status) || 400,
      "JAVA_TOOLS_ERROR",
      error instanceof Error ? error.message : String(error),
    );
  app.get(base, gate, async (req, res) => {
    try {
      const s = await selected(String(req.params.id), req.query.file, false);
      res
        .set("Cache-Control", "no-store")
        .json(await deps.javaLanguage.status(s.target, s.loaded.name));
    } catch (error) {
      fail(res, error);
    }
  });
  app.post(base + "/start", gate, async (req, res) => {
    try {
      const s = await selected(String(req.params.id), req.body?.file);
      const home = req.body?.javaHome;
      if (
        home !== undefined &&
        (typeof home !== "string" || home.length > 4096)
      )
        throw new Error("Java home must be a JDK path");
      if (
        req.body?.resolveDependencies !== undefined &&
        typeof req.body.resolveDependencies !== "boolean"
      )
        throw new Error("Dependency resolution must be a boolean");
      res
        .status(202)
        .json(
          await deps.javaLanguage.start(
            s.target,
            home,
            req.body?.resolveDependencies === true,
          ),
        );
    } catch (error) {
      fail(res, error);
    }
  });
  app.post(base + "/stop", gate, async (req, res) => {
    try {
      const s = await selected(String(req.params.id), req.body?.file, false);
      deps.javaLanguage.stop(s.target);
      res.json(await deps.javaLanguage.status(s.target));
    } catch (error) {
      fail(res, error);
    }
  });
  app.post(base + "/document", gate, async (req, res) => {
    try {
      const s = await selected(String(req.params.id), req.body?.file);
      if (typeof req.body?.text !== "string")
        throw new Error("Java document text is required");
      res.json({
        version: await deps.javaLanguage.document(
          s.target,
          s.loaded.name,
          req.body.text,
        ),
      });
    } catch (error) {
      fail(res, error);
    }
  });
  app.post(base + "/close", gate, async (req, res) => {
    try {
      const s = await selected(String(req.params.id), req.body?.file, false);
      deps.javaLanguage.closeDocument(s.target, s.loaded.name);
      res.json({ ok: true });
    } catch (error) {
      fail(res, error);
    }
  });
  app.post(base + "/query", gate, async (req, res) => {
    try {
      const s = await selected(String(req.params.id), req.body?.file),
        body = req.body ?? {};
      if (
        !["completion", "definition", "references", "rename", "hover"].includes(
          body.operation,
        )
      )
        throw new Error("Unsupported Java operation");
      const text = body.text ?? s.loaded.buffer.toString("utf8");
      if (typeof text !== "string")
        throw new Error("Java text must be a string");
      if (
        body.operation === "rename" &&
        text !== s.loaded.buffer.toString("utf8")
      )
        throw new Error("Save the Java document before previewing a rename");
      res
        .set("Cache-Control", "no-store")
        .json(
          await deps.javaLanguage.query(
            s.target,
            s.loaded.name,
            text,
            body.position,
            body.operation,
            s.read,
            body.newName,
          ),
        );
    } catch (error) {
      fail(res, error);
    }
  });
  app.post(base + "/rename", gate, async (req, res) => {
    try {
      const s = await selected(String(req.params.id), req.body?.file);
      if (typeof req.body?.planId !== "string")
        throw new Error("Rename preview ID required");
      res.json(
        await deps.javaLanguage.applyRename(
          s.target,
          req.body.planId,
          s.read,
          s.write,
        ),
      );
    } catch (error) {
      fail(res, error);
    }
  });
  app.post(base + "/prepare", gate, async (req, res) => {
    try {
      const s = await selected(String(req.params.id), req.body?.file);
      res
        .status(202)
        .json(
          await deps.verification.start(
            s.target.projectId,
            s.target.projectPath,
            s.target.root,
            ["java:maven-prepare"],
            300000,
          ),
        );
    } catch (error) {
      fail(res, error);
    }
  });
  app.get(base + "/preparation", gate, async (req, res) => {
    try {
      const s = await selected(String(req.params.id), req.query.file);
      res
        .set("Cache-Control", "no-store")
        .json(
          await deps.verification.status(
            s.target.projectId,
            s.target.projectPath,
            s.target.root,
            typeof req.query.runId === "string" ? req.query.runId : undefined,
          ),
        );
    } catch (error) {
      fail(res, error);
    }
  });
  app.get(base + "/debug", gate, async (req, res) => {
    try {
      const s = await selected(String(req.params.id), req.query.file, false);
      res
        .set("Cache-Control", "no-store")
        .json(deps.javaDebug.status(s.target));
    } catch (error) {
      fail(res, error);
    }
  });
  app.post(base + "/debug/attach", gate, async (req, res) => {
    try {
      const s = await selected(String(req.params.id), req.body?.file);
      if (
        req.body?.javaHome !== undefined &&
        typeof req.body.javaHome !== "string"
      )
        throw new Error("Java home must be a path");
      res
        .status(202)
        .json(
          await deps.javaDebug.attach(
            s.target,
            req.body?.port,
            req.body?.javaHome,
          ),
        );
    } catch (error) {
      fail(res, error);
    }
  });
  app.post(base + "/debug/command", gate, async (req, res) => {
    try {
      const s = await selected(String(req.params.id), req.body?.file),
        body = req.body ?? {};
      let className = body.className;
      if (body.action === "breakpoint" || body.action === "remove-breakpoint") {
        if (
          !Number.isInteger(body.line) ||
          body.line < 1 ||
          body.line > s.loaded.buffer.toString("utf8").split("\n").length
        )
          throw new Error("Choose a line in the Java source");
        if (className === undefined)
          className = await javaBreakpointClass(
            s.loaded.name,
            s.loaded.buffer.toString("utf8"),
          );
        else if (typeof className !== "string")
          throw new Error("Runtime class must be text");
      }
      res.json(
        await deps.javaDebug.command(s.target, body.action, {
          className,
          line: body.line,
          index: body.index,
        }),
      );
    } catch (error) {
      fail(res, error);
    }
  });
  app.post(base + "/debug/stop", gate, async (req, res) => {
    try {
      const s = await selected(String(req.params.id), req.body?.file, false);
      deps.javaDebug.stop(s.target);
      res.json(deps.javaDebug.status(s.target));
    } catch (error) {
      fail(res, error);
    }
  });
}
