import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JavaDebugService } from "../src/services/java/debug-service.js";
const services: JavaDebugService[] = [],
  roots: string[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) service.shutdown();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function target() {
  const root = await mkdtemp(path.join(os.tmpdir(), "mf-jdb-"));
  roots.push(root);
  return { projectId: "traffic", root, workspaceRoot: root, projectPath: "." };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++)
    await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
}
describe("Java debugger protocol lifecycle", () => {
  it("waits for the split breakpoint prompt before stack and variable commands", async () => {
    let attachArgs: string[] = [];
    const service = new JavaDebugService((_command, args, options) => {
      attachArgs = args;
      return spawn(
        process.execPath,
        [
          "-e",
          String.raw`
let ready=false,b='';process.stdout.write('> ');
process.stdin.on('data',x=>{b+=x;while(b.includes('\n')){const i=b.indexOf('\n'),cmd=b.slice(0,i);b=b.slice(i+1);
if(cmd.startsWith('stop at')){process.stdout.write('Set breakpoint\n> ');setTimeout(()=>process.stdout.write('Breakpoint hit: worker, example.Service.read(), line=34\n'),10);setTimeout(()=>{ready=true;process.stdout.write('worker[1] ');},40);}
else if(cmd==='where'){if(!ready)process.stdout.write('EARLY COMMAND\n');process.stdout.write('  [1] example.Service.read (Service.java:34)\nworker[1] ');}
else if(cmd==='locals')process.stdout.write('Method arguments:\nid = 1\nLocal variables:\nworker[1] ');
}});
`,
        ],
        options,
      );
    });
    services.push(service);
    const selected = await target();
    await service.attach(selected, 5005);
    await until(() => service.status(selected).state === "running");
    expect(attachArgs).toEqual(['-J-Duser.language=en','-J-Duser.country=US',"-attach", "127.0.0.1:5005"]);
    await service.command(selected, "breakpoint", {
      className: "example.Service",
      line: 34,
    });
    await until(() => service.status(selected).locals.length === 1);
    expect(service.status(selected)).toMatchObject({
      state: "paused",
      locals: [{ name: "id", value: "1" }],
      frames: [{ method: "example.Service.read", line: 34 }],
    });
    expect(service.status(selected).output).not.toContain("EARLY COMMAND");
    service.stop(selected);
    expect(service.status(selected).state).toBe("stopped");
  });
  it("surfaces rejected breakpoints and refuses arbitrary debugger expressions", async () => {
    const service = new JavaDebugService((_command, _args, options) =>
      spawn(
        process.execPath,
        [
          "-e",
          "process.stdout.write('> ');process.stdin.on('data',()=>process.stdout.write('No code at line 1\\n> '));",
        ],
        options,
      ),
    );
    services.push(service);
    const selected = await target();
    await service.attach(selected, 5005);
    await until(() => service.status(selected).state === "running");
    await expect(
      service.command(selected, "breakpoint", {
        className: "example.Service",
        line: 1,
      }),
    ).rejects.toThrow("No code at line");
    await expect(
      service.command(selected, "eval", { className: "System.exit(0)" }),
    ).rejects.toThrow("Unsupported");
  });
});
