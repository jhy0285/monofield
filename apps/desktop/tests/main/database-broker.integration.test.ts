import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "pg";
import { beforeAll, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({
  userData: "",
  messageBoxCalls: 0,
}));

vi.mock("electron", () => ({
  app: { getPath: () => electronState.userData },
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: {
    showMessageBox: async () => {
      electronState.messageBoxCalls += 1;
      return { response: 0 };
    },
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

const connectionString = process.env.MONOFIELD_DB_INTEGRATION_URL?.trim() ?? "";
const integration = describe.runIf(connectionString.length > 0);

integration("DatabaseBroker PostgreSQL integration", () => {
  let DatabaseBroker: typeof import("../../src/main/database-broker.js").DatabaseBroker;

  beforeAll(async () => {
    electronState.userData = await mkdtemp(join(tmpdir(), "monofield-database-integration-"));
    ({ DatabaseBroker } = await import("../../src/main/database-broker.js"));
  });

  it("reads redacted samples and completes audited insert, update, and delete operations", async () => {
    const setup = new Client({ connectionString });
    await setup.connect();
    await setup.query("DROP TABLE IF EXISTS public.monofield_broker_integration");
    await setup.query(`
      CREATE TABLE public.monofield_broker_integration (
        id text PRIMARY KEY,
        status text NOT NULL,
        secret_token text NOT NULL
      )
    `);

    try {
      const broker = new DatabaseBroker();
      const connection = await broker.save({
        label: "MonoField integration",
        connectionString,
        writePolicy: "always",
      });
      await broker.setReadApproval(connection.id, "always");

      const listed = await broker.execute({ action: "schemas", connectionId: connection.id });
      expect(listed).toMatchObject({
        tables: expect.arrayContaining([
          { schema: "public", table: "monofield_broker_integration" },
        ]),
      });

      await broker.execute({
        action: "mutate",
        connectionId: connection.id,
        operation: "insert",
        schema: "public",
        table: "monofield_broker_integration",
        values: { id: "order-1", status: "draft", secret_token: "must-not-leak" },
        projectId: "integration-project",
        reason: "Verify the guarded MonoField write path",
      });

      const sample = await broker.execute({
        action: "sample",
        connectionId: connection.id,
        schema: "public",
        table: "monofield_broker_integration",
        limit: 5,
      });
      expect(sample).toEqual({
        rows: [{ id: "order-1", status: "draft", secret_token: "[redacted]" }],
      });

      await broker.execute({
        action: "mutate",
        connectionId: connection.id,
        operation: "update",
        schema: "public",
        table: "monofield_broker_integration",
        values: { status: "verified" },
        where: { id: "order-1" },
        projectId: "integration-project",
        reason: "Verify bounded structured updates",
      });
      expect((await setup.query(
        "SELECT status FROM public.monofield_broker_integration WHERE id = $1",
        ["order-1"],
      )).rows).toEqual([{ status: "verified" }]);

      await broker.execute({
        action: "mutate",
        connectionId: connection.id,
        operation: "delete",
        schema: "public",
        table: "monofield_broker_integration",
        where: { id: "order-1" },
        projectId: "integration-project",
        reason: "Remove the integration fixture",
      });
      expect((await setup.query(
        "SELECT count(*)::int AS count FROM public.monofield_broker_integration",
      )).rows).toEqual([{ count: 0 }]);

      const audit = await readFile(join(electronState.userData, "database-mutations.v1.jsonl"), "utf8");
      const entries = audit.trim().split("\n").map((line) => JSON.parse(line) as { operation: string });
      expect(entries.map((entry) => entry.operation)).toEqual(["insert", "update", "delete"]);
      // One explicit confirmation enables the always-write policy; the broker
      // must not show another prompt for each structured mutation.
      expect(electronState.messageBoxCalls).toBe(1);
    } finally {
      await setup.query("DROP TABLE IF EXISTS public.monofield_broker_integration");
      await setup.end();
    }
  });
});
