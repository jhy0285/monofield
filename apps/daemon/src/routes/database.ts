import type { DesktopDatabaseRequest } from "@open-design/sidecar-proto";
import type { Express, Request, Response } from "express";

export type RegisterDatabaseRoutesDeps = {
  desktopDatabaseBroker: ((input: DesktopDatabaseRequest) => Promise<unknown>) | null;
  requireLocalDaemonRequest?: (req: Request, res: Response, next: () => void) => void;
  authorizeMutation?: (req: Request, res: Response) => { connectionId: string; projectId: string } | null;
  authorizeRead?: (req: Request, res: Response) => { connectionId: string; projectId: string } | null;
};

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required`);
  return value.trim();
}

function requireInspectTables(value: unknown): Array<{ schema: string; table: string }> {
  if (!Array.isArray(value) || value.length < 1) {
    throw new Error("tables must contain at least one selected table");
  }
  if (value.length > 32) throw new Error('tables may contain at most 32 selected tables');
  return value.map((item, index) => {
    if (item == null || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`tables[${index}] must be an object`);
    }
    const entry = item as { schema?: unknown; table?: unknown };
    return {
      schema: requireText(entry.schema, `tables[${index}].schema`),
      table: requireText(entry.table, `tables[${index}].table`),
    };
  });
}

function sendBrokerError(res: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : "Database broker request failed";
  const unavailable = message.includes("unavailable") || message.includes("ENOENT") || message.includes("ECONNREFUSED");
  res.status(unavailable ? 503 : 400).json({
    error: {
      code: unavailable ? "DESKTOP_DATABASE_UNAVAILABLE" : "DATABASE_REQUEST_REJECTED",
      message: unavailable ? "The encrypted database broker is available only while MonoField desktop is running." : message,
    },
  });
}

async function execute(res: Response, broker: RegisterDatabaseRoutesDeps["desktopDatabaseBroker"], request: DesktopDatabaseRequest): Promise<void> {
  if (broker == null) {
    res.status(503).json({ error: { code: "DESKTOP_DATABASE_UNAVAILABLE", message: "The encrypted database broker is available only while MonoField desktop is running." } });
    return;
  }
  try {
    res.json(await broker(request));
  } catch (error) {
    sendBrokerError(res, error);
  }
}

export function registerDatabaseRoutes(app: Express, deps: RegisterDatabaseRoutesDeps): void {
  const gate = deps.requireLocalDaemonRequest ?? ((_req: Request, _res: Response, next: () => void) => next());
  const authorizeConnectionRead = (req: Request, res: Response, requestedConnectionId?: string) => {
    const authorization = deps.authorizeRead?.(req, res);
    if (deps.authorizeRead && authorization == null) return null;
    if (authorization && requestedConnectionId && authorization.connectionId !== requestedConnectionId) {
      res.status(403).json({ error: { code: 'DATABASE_CONNECTION_DENIED', message: 'The active project token cannot use this database connection.' } });
      return null;
    }
    return authorization ?? { connectionId: requestedConnectionId ?? '', projectId: '' };
  };
  app.get("/api/database/connections", gate, async (req, res) => {
    const authorization = authorizeConnectionRead(req, res);
    if (!authorization) return;
    if (deps.desktopDatabaseBroker == null) return void execute(res, null, { action: 'list' });
    try {
      const result = await deps.desktopDatabaseBroker({ action: 'list' }) as { connections?: Array<{ id?: string }> };
      res.json({ connections: (result.connections ?? []).filter((connection) => connection.id === authorization.connectionId) });
    } catch (error) { sendBrokerError(res, error); }
  });
  app.get("/api/database/connections/:connectionId/schemas", gate, (req, res) => {
    const selectedByUser = req.query.selectedByUser;
    if (selectedByUser != null && selectedByUser !== "true" && selectedByUser !== "false") {
      res.status(400).json({ error: { code: "DATABASE_REQUEST_REJECTED", message: "selectedByUser must be a boolean" } });
      return;
    }
    try {
      if (!authorizeConnectionRead(req, res, requireText(req.params.connectionId, 'connectionId'))) return;
      void execute(res, deps.desktopDatabaseBroker, {
        action: "schemas",
        connectionId: requireText(req.params.connectionId, "connectionId"),
        ...(selectedByUser == null ? {} : { selectedByUser: selectedByUser === "true" }),
      });
    }
    catch (error) { sendBrokerError(res, error); }
  });
  app.get("/api/database/connections/:connectionId/tables/:schema/:table", gate, (req, res) => {
    try {
      if (!authorizeConnectionRead(req, res, requireText(req.params.connectionId, 'connectionId'))) return;
      void execute(res, deps.desktopDatabaseBroker, { action: "describe", connectionId: requireText(req.params.connectionId, "connectionId"), schema: requireText(req.params.schema, "schema"), table: requireText(req.params.table, "table") });
    }
    catch (error) { sendBrokerError(res, error); }
  });
  app.get("/api/database/connections/:connectionId/tables/:schema/:table/sample", gate, (req: Request, res: Response) => {
    const rawLimit = req.query.limit;
    const limit = rawLimit == null ? undefined : Number(rawLimit);
    if (limit != null && (!Number.isInteger(limit) || limit < 1 || limit > 20)) {
      res.status(400).json({ error: { code: "DATABASE_REQUEST_REJECTED", message: "limit must be an integer between 1 and 20" } });
      return;
    }
    try {
      if (!authorizeConnectionRead(req, res, requireText(req.params.connectionId, 'connectionId'))) return;
      void execute(res, deps.desktopDatabaseBroker, { action: "sample", connectionId: requireText(req.params.connectionId, "connectionId"), schema: requireText(req.params.schema, "schema"), table: requireText(req.params.table, "table"), ...(limit == null ? {} : { limit }) });
    }
    catch (error) { sendBrokerError(res, error); }
  });
  app.post("/api/database/connections/:connectionId/inspect", gate, (req: Request, res: Response) => {
    const rawLimit = req.body?.limit;
    const limit = rawLimit == null ? undefined : Number(rawLimit);
    if (limit != null && (!Number.isInteger(limit) || limit < 1 || limit > 20)) {
      res.status(400).json({ error: { code: "DATABASE_REQUEST_REJECTED", message: "limit must be an integer between 1 and 20" } });
      return;
    }
    const rawConcurrency = req.body?.concurrency;
    const concurrency = rawConcurrency == null ? undefined : Number(rawConcurrency);
    if (concurrency != null && concurrency !== 8 && concurrency !== 16 && concurrency !== 32) {
      res.status(400).json({ error: { code: "DATABASE_REQUEST_REJECTED", message: "concurrency must be 8, 16, or 32" } });
      return;
    }
    const selectedByUser = req.body?.selectedByUser;
    if (selectedByUser != null && typeof selectedByUser !== "boolean") {
      res.status(400).json({ error: { code: "DATABASE_REQUEST_REJECTED", message: "selectedByUser must be a boolean" } });
      return;
    }
    try {
      if (!authorizeConnectionRead(req, res, requireText(req.params.connectionId, 'connectionId'))) return;
      void execute(res, deps.desktopDatabaseBroker, {
        action: "inspect",
        connectionId: requireText(req.params.connectionId, "connectionId"),
        tables: requireInspectTables(req.body?.tables),
        ...(limit == null ? {} : { limit }),
        ...(concurrency == null ? {} : { concurrency: concurrency as 8 | 16 | 32 }),
        ...(selectedByUser == null ? {} : { selectedByUser }),
      });
    } catch (error) { sendBrokerError(res, error); }
  });
  app.post("/api/database/connections/:connectionId/mutations", gate, (req: Request, res: Response) => {
    try {
      const authorization = deps.authorizeMutation?.(req, res);
      if (deps.authorizeMutation && authorization == null) return;
      const requestedConnectionId = requireText(req.params.connectionId, 'connectionId');
      if (authorization && authorization.connectionId !== requestedConnectionId) {
        res.status(403).json({ error: { code: 'DATABASE_CONNECTION_DENIED', message: 'The active project token cannot use this database connection.' } });
        return;
      }
      const operation = req.body?.operation;
      if (operation !== 'insert' && operation !== 'update' && operation !== 'delete') throw new Error('operation must be insert, update, or delete');
      const scalarRecord = (value: unknown, label: string): Record<string, string | number | boolean | null> | undefined => {
        if (value == null) return undefined;
        if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
        const entries = Object.entries(value as Record<string, unknown>);
        if (entries.length > 50) throw new Error(`${label} has too many columns`);
        return Object.fromEntries(entries.map(([key, entry]) => {
          if (entry !== null && typeof entry !== 'string' && typeof entry !== 'number' && typeof entry !== 'boolean') throw new Error(`${label}.${key} must be a scalar JSON value`);
          return [key, entry];
        }));
      };
      const values = scalarRecord(req.body?.values, 'values');
      const where = scalarRecord(req.body?.where, 'where');
      void execute(res, deps.desktopDatabaseBroker, {
        action: 'mutate',
        connectionId: authorization?.connectionId ?? requestedConnectionId,
        operation,
        schema: requireText(req.body?.schema, 'schema'),
        table: requireText(req.body?.table, 'table'),
        ...(values == null ? {} : { values }),
        ...(where == null ? {} : { where }),
        ...(authorization
          ? { projectId: authorization.projectId }
          : req.body?.projectId == null
            ? {}
            : { projectId: requireText(req.body.projectId, 'projectId') }),
        reason: requireText(req.body?.reason, 'reason').slice(0, 500),
      });
    } catch (error) { sendBrokerError(res, error); }
  });
}
