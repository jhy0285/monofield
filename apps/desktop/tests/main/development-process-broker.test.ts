import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DevelopmentProcessBroker } from "../../src/main/development-process-broker.js";

function fakeChild(pid = 101): any {
  const child = new EventEmitter() as any;
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

describe("DevelopmentProcessBroker", () => {
  const brokers: DevelopmentProcessBroker[] = [];

  afterEach(async () => { await Promise.all(brokers.splice(0).map((broker) => broker.dispose())); });

  it("spawns an absolute discovered command and terminates only its registered project", async () => {
    const child = fakeChild();
    const terminateTree = vi.fn(async () => undefined);
    const spawnProcess = vi.fn(() => child);
    const broker = new DevelopmentProcessBroker({ isAlive: (pid) => pid === 100 || pid === 101, monitorIntervalMs: 60_000, spawnProcess: spawnProcess as any, terminateTree });
    brokers.push(broker);
    const started = await broker.execute({ action: "start", args: ["-m", "http.server"], command: "C:\\Python\\python.exe", cwd: "C:\\work", ownerPid: 100, port: 8000, projectId: "project-1" });
    expect(started).toMatchObject({ accepted: true, pid: 101, running: true });
    expect(spawnProcess).toHaveBeenCalledOnce();
    await expect(broker.execute({ action: "terminate", ownerPid: 200, projectId: "project-1" })).rejects.toThrow(/another daemon/i);
    await expect(broker.execute({ action: "terminate", ownerPid: 100, projectId: "project-1" })).resolves.toMatchObject({ action: "terminate", running: false });
    expect(terminateTree).toHaveBeenCalledWith(101);
  });

  it("returns captured logs through status", async () => {
    const child = fakeChild();
    const broker = new DevelopmentProcessBroker({ isAlive: () => true, monitorIntervalMs: 60_000, spawnProcess: (() => child) as any, terminateTree: async () => undefined });
    brokers.push(broker);
    await broker.execute({ action: "start", args: [], command: "C:\\Python\\python.exe", cwd: "C:\\work", ownerPid: 100, port: 8000, projectId: "project-1" });
    child.stdout.emit("data", "ready on http://127.0.0.1:8000\n");
    await expect(broker.execute({ action: "status", ownerPid: 100, projectId: "project-1" })).resolves.toMatchObject({ logs: ["ready on http://127.0.0.1:8000"] });
  });

  it("rejects relative executable and working-directory paths", async () => {
    const broker = new DevelopmentProcessBroker({ isAlive: () => true, monitorIntervalMs: 60_000 });
    brokers.push(broker);
    await expect(broker.execute({ action: "start", args: [], command: "python", cwd: ".", ownerPid: 100, port: 8000, projectId: "project-1" })).rejects.toThrow(/absolute paths/i);
  });
});
