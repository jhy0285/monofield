import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({
  userData: "",
  approvalResponse: 0,
  messageBoxCalls: 0,
}));
const pgState = vi.hoisted(() => ({
  client: {
    connect: vi.fn(),
    query: vi.fn(),
    end: vi.fn(),
  },
  clientFactory: vi.fn(),
  pool: {
    query: vi.fn(),
    end: vi.fn(),
  },
  poolFactory: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getPath: () => electronState.userData },
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: {
    showMessageBox: async () => {
      electronState.messageBoxCalls += 1;
      return { response: electronState.approvalResponse };
    },
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

vi.mock("pg", () => ({
  Client: pgState.clientFactory,
  Pool: pgState.poolFactory,
}));

describe("DatabaseBroker access approval", () => {
  let DatabaseBroker: typeof import("../../src/main/database-broker.js").DatabaseBroker;

  beforeEach(async () => {
    electronState.userData = await mkdtemp(join(tmpdir(), "open-design-database-broker-"));
    electronState.approvalResponse = 0;
    electronState.messageBoxCalls = 0;
    pgState.client.connect.mockReset();
    pgState.client.query.mockReset();
    pgState.client.end.mockReset();
    pgState.client.connect.mockResolvedValue(undefined);
    pgState.client.query.mockResolvedValue({ rows: [{ schema: "public", table: "users" }] });
    pgState.client.end.mockResolvedValue(undefined);
    pgState.clientFactory.mockReset();
    pgState.clientFactory.mockImplementation(function (this: Record<string, unknown>) {
      Object.assign(this, pgState.client);
    });
    pgState.pool.query.mockReset();
    pgState.pool.end.mockReset();
    pgState.pool.query.mockResolvedValue({ rows: [] });
    pgState.pool.end.mockResolvedValue(undefined);
    pgState.poolFactory.mockReset();
    pgState.poolFactory.mockImplementation(function (this: Record<string, unknown>) {
      Object.assign(this, pgState.pool);
    });
    ({ DatabaseBroker } = await import("../../src/main/database-broker.js"));
  });

  it("defaults to prompt and resets approval when a label targets another URL", async () => {
    const broker = new DatabaseBroker();
    const initial = await broker.save({
      label: "Development",
      connectionString: "postgresql://user:pass@localhost:5432/app",
    });

    expect(initial.readApproval).toBe("prompt");
    expect(initial).toMatchObject({ accessMode: "read-only", writePolicy: "disabled" });
    await broker.setReadApproval(initial.id, "always");
    expect((await broker.list())[0]?.readApproval).toBe("always");

    const sameTarget = await broker.save({
      label: "Development",
      connectionString: "postgresql://user:pass@localhost:5432/app",
    });
    expect(sameTarget.readApproval).toBe("always");

    const changedTarget = await broker.save({
      label: "Development",
      connectionString: "postgresql://user:pass@localhost:5432/other",
    });
    expect(changedTarget.id).toBe(initial.id);
    expect(changedTarget.readApproval).toBe("prompt");
  });

  it("shows approval for prompt and skips it for always on read-only requests", async () => {
    const broker = new DatabaseBroker();
    const connection = await broker.save({
      label: "Development",
      connectionString: "postgresql://user:pass@localhost:5432/app",
    });

    await broker.execute({ action: "schemas", connectionId: connection.id });
    expect(electronState.messageBoxCalls).toBe(1);
    expect(pgState.clientFactory).toHaveBeenLastCalledWith(expect.objectContaining({
      options: expect.stringContaining('default_transaction_read_only=on'),
    }));

    await broker.setReadApproval(connection.id, "always");
    await broker.execute({ action: "schemas", connectionId: connection.id });
    expect(electronState.messageBoxCalls).toBe(1);
    expect(pgState.client.query).toHaveBeenCalledTimes(2);

    await broker.setReadApproval(connection.id, "prompt");
    await broker.execute({ action: "schemas", connectionId: connection.id, selectedByUser: true });
    expect(electronState.messageBoxCalls).toBe(2);
  });

  it("does not trust a renderer supplied selectedByUser flag as read consent", async () => {
    const broker = new DatabaseBroker();
    const connection = await broker.save({
      label: "Development",
      connectionString: "postgresql://user:pass@localhost:5432/app",
    });

    await broker.execute({
      action: "inspect",
      connectionId: connection.id,
      tables: [{ schema: "public", table: "users" }],
      selectedByUser: true,
    });

    expect(electronState.messageBoxCalls).toBe(1);
    expect(pgState.pool.query).toHaveBeenCalled();
  });

  it("requires one Desktop approval for every structured development write", async () => {
    const broker = new DatabaseBroker();
    const connection = await broker.save({
      label: "Development",
      connectionString: "postgresql://user:pass@localhost:5432/app",
      writePolicy: "approve-each",
    });
    pgState.client.query.mockImplementation(async (sql: string) => {
      if (/^INSERT/i.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: null };
    });

    const first = await broker.execute({
      action: "mutate",
      connectionId: connection.id,
      operation: "insert",
      schema: "public",
      table: "orders",
      values: { customer_id: 42, status: "draft" },
      projectId: "project-1",
      reason: "Create test data for checkout verification",
    });
    const second = await broker.execute({
      action: "mutate",
      connectionId: connection.id,
      operation: "insert",
      schema: "public",
      table: "orders",
      values: { customer_id: 43, status: "draft" },
      projectId: "project-1",
      reason: "Create a second test case",
    });

    expect(first).toMatchObject({ approved: true, affectedRows: 1, auditId: expect.any(String) });
    expect(second).toMatchObject({ approved: true, affectedRows: 1, auditId: expect.any(String) });
    expect(electronState.messageBoxCalls).toBe(2);
  });

  it("uses the same access policy for every database target", async () => {
    const broker = new DatabaseBroker();
    const connection = await broker.save({
      label: "Production",
      connectionString: "postgresql://user:pass@localhost:5432/app",
      writePolicy: "approve-each",
    });
    pgState.client.query.mockImplementation(async (sql: string) => {
      if (/^INSERT/i.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: null };
    });

    await expect(broker.execute({
      action: "mutate",
      connectionId: connection.id,
      operation: "insert",
      schema: "public",
      table: "orders",
      values: { id: 42 },
      reason: "Verify permission-only enforcement",
    })).resolves.toMatchObject({ approved: true, affectedRows: 1 });
    expect(electronState.messageBoxCalls).toBe(1);
  });

  it("asks once when enabling always allow and then skips per-write dialogs", async () => {
    const broker = new DatabaseBroker();
    const connection = await broker.save({
      label: "Automation data",
      connectionString: "postgresql://user:pass@localhost:5432/app",
      writePolicy: "always",
    });
    expect(electronState.messageBoxCalls).toBe(1);
    pgState.client.query.mockImplementation(async (sql: string) => {
      if (/^INSERT/i.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: null };
    });

    for (const id of [1, 2]) {
      await broker.execute({
        action: "mutate",
        connectionId: connection.id,
        operation: "insert",
        schema: "public",
        table: "orders",
        values: { id },
        projectId: "project-1",
        reason: "Prepare repeatable test data",
      });
    }

    expect(electronState.messageBoxCalls).toBe(1);
    expect((await broker.list())[0]).toMatchObject({ accessMode: "read-write", writePolicy: "always" });
  });

  it("redacts credentials and account names from database errors", async () => {
    const broker = new DatabaseBroker();
    pgState.client.connect.mockRejectedValueOnce(new Error(
      'password authentication failed for user "finance_admin" at postgresql://finance_admin:super-secret@db.internal/app?sslpassword=another-secret',
    ));

    const error = await broker.test({
      label: "Sensitive",
      connectionString: "postgresql://finance_admin:super-secret@db.internal/app",
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('finance_admin');
    expect((error as Error).message).not.toContain('super-secret');
    expect((error as Error).message).not.toContain('another-secret');
    expect((error as Error).message).toContain('[redacted]');
  });
});
