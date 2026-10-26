import { createHash } from "node:crypto";

// Pure Oracle-family (Oracle Database, Tibero) catalogue mapping for the
// Desktop database broker. Nothing here opens a connection: the broker runs
// the fixed statements below and passes the driver rows in unchanged. See
// docs/adr/0003-oracle-tibero-metadata-access.md.

/** node-oracledb returns NUMBER as a JS number; ODBC drivers may return SQL_NUMERIC as a string. */
type CatalogNumber = number | string | null | undefined;
type CatalogText = string | null | undefined;

/** ALL_TABLES. */
export type OracleTableRow = {
  OWNER: string;
  TABLE_NAME: string;
  DROPPED?: CatalogText;
  IOT_TYPE?: CatalogText;
  NESTED?: CatalogText;
  SECONDARY?: CatalogText;
};

/** ALL_TAB_COLUMNS without the LONG DATA_DEFAULT column. */
export type OracleColumnRow = {
  OWNER: string;
  TABLE_NAME: string;
  COLUMN_NAME: string;
  COLUMN_ID: CatalogNumber;
  DATA_TYPE: string;
  DATA_TYPE_MOD?: CatalogText;
  DATA_TYPE_OWNER?: CatalogText;
  DATA_LENGTH: CatalogNumber;
  DATA_PRECISION?: CatalogNumber;
  DATA_SCALE?: CatalogNumber;
  CHAR_LENGTH?: CatalogNumber;
  CHAR_USED?: CatalogText;
  NULLABLE: string;
};

/** ALL_TAB_COLUMNS.DATA_DEFAULT (LONG), fetched by its own statement. */
export type OracleColumnDefaultRow = { OWNER: string; TABLE_NAME: string; COLUMN_NAME: string; DATA_DEFAULT: CatalogText };

/** ALL_CONSTRAINTS. SEARCH_CONDITION is LONG. */
export type OracleConstraintRow = {
  OWNER: string;
  CONSTRAINT_NAME: string;
  CONSTRAINT_TYPE: string;
  TABLE_NAME: string;
  SEARCH_CONDITION?: CatalogText;
  R_OWNER?: CatalogText;
  R_CONSTRAINT_NAME?: CatalogText;
  DELETE_RULE?: CatalogText;
  STATUS?: CatalogText;
  DEFERRABLE?: CatalogText;
  DEFERRED?: CatalogText;
  VALIDATED?: CatalogText;
  GENERATED?: CatalogText;
};

/** ALL_CONS_COLUMNS. */
export type OracleConstraintColumnRow = { OWNER: string; CONSTRAINT_NAME: string; TABLE_NAME: string; COLUMN_NAME: string; POSITION?: CatalogNumber };

/** ALL_INDEXES joined with ALL_IND_COLUMNS. */
export type OracleIndexColumnRow = {
  INDEX_OWNER: string;
  INDEX_NAME: string;
  TABLE_OWNER: string;
  TABLE_NAME: string;
  UNIQUENESS?: CatalogText;
  INDEX_TYPE?: CatalogText;
  GENERATED?: CatalogText;
  COLUMN_NAME: string;
  COLUMN_POSITION: CatalogNumber;
  DESCEND?: CatalogText;
};

export type OracleCatalogRows = {
  tables: OracleTableRow[];
  columns: OracleColumnRow[];
  /** Present for schema snapshots; when omitted no structureSha256 is produced. */
  structure?: {
    columnDefaults: OracleColumnDefaultRow[];
    constraints: OracleConstraintRow[];
    constraintColumns: OracleConstraintColumnRow[];
    indexColumns: OracleIndexColumnRow[];
  };
};

/** Same shape as DatabaseSchemaSnapshot in @open-design/contracts, which the daemon validates. */
export type OracleSchemaSnapshot = {
  tables: Array<{
    schema: string;
    table: string;
    columns: Array<{ name: string; type: string; nullable: "YES" | "NO" }>;
    structureSha256?: string;
  }>;
};

export const ORACLE_MAX_OWNERS = 32;
export const ORACLE_ROW_LIMITS = Object.freeze({ tables: 10_000, columns: 50_000, structure: 200_000 });
const GENERATED_NAME = "[generated]";
const INDEX_EXPRESSION = "[expression]";

function ownerList(count: number): string {
  if (!Number.isInteger(count) || count < 1 || count > ORACLE_MAX_OWNERS) throw new Error(`Between 1 and ${ORACLE_MAX_OWNERS} schemas may be monitored`);
  return Array.from({ length: count }, (_, index) => `:owner${index}`).join(", ");
}

/**
 * Fixed read-only statements for one snapshot. Owners are always bind
 * variables. LONG columns (DATA_DEFAULT, SEARCH_CONDITION) never appear in a
 * subquery, ORDER BY or expression, which Oracle rejects; ROWNUM in the outer
 * WHERE caps each result one row above its limit and the mapper both orders
 * the rows and rejects a capped result.
 */
export function oracleCatalogStatements(ownerCount: number) {
  const owners = ownerList(ownerCount);
  const cap = (limit: number) => `ROWNUM <= ${limit + 1}`;
  return {
    readOnlyTransaction: "SET TRANSACTION READ ONLY",
    currentSchema: "SELECT USER AS OWNER FROM DUAL",
    tables: `SELECT OWNER, TABLE_NAME, DROPPED, IOT_TYPE, NESTED, SECONDARY FROM ALL_TABLES WHERE OWNER IN (${owners}) AND ${cap(ORACLE_ROW_LIMITS.tables)}`,
    // ALL_TAB_COLUMNS also lists view and cluster columns; keep them out so the cap counts table columns.
    columns: `SELECT OWNER, TABLE_NAME, COLUMN_NAME, COLUMN_ID, DATA_TYPE, DATA_TYPE_MOD, DATA_TYPE_OWNER, DATA_LENGTH, DATA_PRECISION, DATA_SCALE, CHAR_LENGTH, CHAR_USED, NULLABLE FROM ALL_TAB_COLUMNS WHERE OWNER IN (${owners}) AND (OWNER, TABLE_NAME) IN (SELECT OWNER, TABLE_NAME FROM ALL_TABLES WHERE OWNER IN (${owners})) AND ${cap(ORACLE_ROW_LIMITS.columns)}`,
    columnDefaults: `SELECT OWNER, TABLE_NAME, COLUMN_NAME, DATA_DEFAULT FROM ALL_TAB_COLUMNS WHERE OWNER IN (${owners}) AND DEFAULT_LENGTH > 0 AND ${cap(ORACLE_ROW_LIMITS.structure)}`,
    constraints: `SELECT OWNER, CONSTRAINT_NAME, CONSTRAINT_TYPE, TABLE_NAME, SEARCH_CONDITION, R_OWNER, R_CONSTRAINT_NAME, DELETE_RULE, STATUS, DEFERRABLE, DEFERRED, VALIDATED, GENERATED FROM ALL_CONSTRAINTS WHERE OWNER IN (${owners}) AND CONSTRAINT_TYPE IN ('P', 'U', 'R', 'C') AND ${cap(ORACLE_ROW_LIMITS.structure)}`,
    constraintColumns: `SELECT OWNER, CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME, POSITION FROM ALL_CONS_COLUMNS WHERE OWNER IN (${owners}) AND ${cap(ORACLE_ROW_LIMITS.structure)}`,
    indexColumns: `SELECT i.OWNER AS INDEX_OWNER, i.INDEX_NAME, i.TABLE_OWNER, i.TABLE_NAME, i.UNIQUENESS, i.INDEX_TYPE, i.GENERATED, c.COLUMN_NAME, c.COLUMN_POSITION, c.DESCEND FROM ALL_INDEXES i, ALL_IND_COLUMNS c WHERE c.INDEX_OWNER = i.OWNER AND c.INDEX_NAME = i.INDEX_NAME AND i.TABLE_OWNER IN (${owners}) AND ${cap(ORACLE_ROW_LIMITS.structure)}`,
  };
}

/** Bind object for the `:ownerN` placeholders of oracleCatalogStatements. */
export function oracleOwnerBinds(owners: readonly string[]): Record<string, string> {
  ownerList(owners.length);
  return Object.fromEntries(owners.map((owner, index) => [`owner${index}`, owner]));
}

/**
 * Oracle identifier semantics for a user-entered schema name: unquoted names
 * fold to upper case, a double-quoted name keeps its exact case.
 */
export function normalizeOracleOwner(input: string): string {
  const value = input.trim();
  const quoted = /^"([^"]+)"$/.exec(value);
  const owner = quoted ? quoted[1]! : value.toUpperCase();
  if (!owner || owner.length > 128 || owner.includes('"') || /[\u0000-\u001f]/.test(owner)) throw new Error("Schema name is not a valid Oracle identifier");
  return owner;
}

function integer(value: CatalogNumber, label: string): number | null {
  if (value == null) return null;
  const parsed = typeof value === "string" && /^-?\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed)) throw new Error(`Unexpected ${label} value in database catalogue`);
  return parsed;
}

function requiredInteger(value: CatalogNumber, label: string): number {
  const parsed = integer(value, label);
  if (parsed == null) throw new Error(`Missing ${label} value in database catalogue`);
  return parsed;
}

function text(value: CatalogText): string | null {
  return value == null ? null : value.trim();
}

const FIXED_TYPES = new Set(["DATE", "BINARY_FLOAT", "BINARY_DOUBLE", "CLOB", "NCLOB", "BLOB", "BFILE", "LONG", "LONG RAW", "ROWID", "JSON", "BOOLEAN"]);

function formatType(row: OracleColumnRow): { type: string; recognized: boolean } {
  const dataType = row.DATA_TYPE.trim();
  const typeOwner = text(row.DATA_TYPE_OWNER);
  if (typeOwner) {
    // User-defined object types such as MDSYS.SDO_GEOMETRY carry no dimensions.
    const mod = text(row.DATA_TYPE_MOD);
    return { type: `${mod ? `${mod} ` : ""}${typeOwner}.${dataType}`, recognized: true };
  }
  const precision = integer(row.DATA_PRECISION, "DATA_PRECISION");
  const scale = integer(row.DATA_SCALE, "DATA_SCALE");
  const charLength = integer(row.CHAR_LENGTH, "CHAR_LENGTH");
  switch (dataType) {
    case "VARCHAR2":
    case "CHAR": {
      // Length semantics matter for Korean data: VARCHAR2(30 BYTE) holds ten
      // Hangul syllables in AL32UTF8, VARCHAR2(30 CHAR) holds thirty.
      const used = text(row.CHAR_USED);
      if (used === "C" && charLength != null) return { type: `${dataType}(${charLength} CHAR)`, recognized: true };
      const length = requiredInteger(row.DATA_LENGTH, "DATA_LENGTH");
      return { type: used === "B" ? `${dataType}(${length} BYTE)` : `${dataType}(${length})`, recognized: true };
    }
    case "NVARCHAR2":
    case "NCHAR":
      return { type: charLength != null ? `${dataType}(${charLength})` : `${dataType}(${requiredInteger(row.DATA_LENGTH, "DATA_LENGTH")} BYTE)`, recognized: true };
    case "NUMBER":
      if (precision == null) return { type: scale == null ? "NUMBER" : `NUMBER(*,${scale})`, recognized: true };
      return { type: scale == null || scale === 0 ? `NUMBER(${precision})` : `NUMBER(${precision},${scale})`, recognized: true };
    case "FLOAT":
      return { type: precision == null ? "FLOAT" : `FLOAT(${precision})`, recognized: true };
    case "RAW":
    case "UROWID":
      return { type: `${dataType}(${requiredInteger(row.DATA_LENGTH, "DATA_LENGTH")})`, recognized: true };
    default:
      // TIMESTAMP(6) WITH TIME ZONE and INTERVAL DAY(2) TO SECOND(6) already
      // carry their precision in DATA_TYPE.
      if (FIXED_TYPES.has(dataType) || /^(?:TIMESTAMP|INTERVAL)\b/.test(dataType)) return { type: dataType, recognized: true };
      return { type: dataType, recognized: false };
  }
}

/** Oracle-style display type for one ALL_TAB_COLUMNS row, e.g. VARCHAR2(20 BYTE) or NUMBER(12,2). */
export function formatOracleColumnType(row: OracleColumnRow): string {
  return formatType(row).type;
}

function nullable(value: string): "YES" | "NO" {
  const flag = value.trim();
  if (flag === "Y") return "YES";
  if (flag === "N") return "NO";
  throw new Error("Unexpected NULLABLE value in database catalogue");
}

function normalizedDefault(value: CatalogText): string | null {
  // DATA_DEFAULT keeps the DDL text verbatim, and ALTER ... DEFAULT NULL
  // leaves the literal NULL behind; neither is a structural change.
  const trimmed = text(value);
  return !trimmed || trimmed.toUpperCase() === "NULL" ? null : trimmed;
}

const key = (owner: string, name: string) => JSON.stringify([owner, name]);
const sortEntries = (entries: unknown[]) => entries.map((entry) => JSON.stringify(entry)).sort();

function groupBy<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const id = keyOf(row);
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }
  return groups;
}

function rejectCapped(count: number, limit: number, label: string): void {
  // The statements fetch limit + 1 rows, so reaching it means rows were cut off.
  if (count > limit) throw new Error(`Database schema exceeds the ${limit} ${label} monitoring limit`);
}

type StructureIndex = {
  defaults: Map<string, OracleColumnDefaultRow[]>;
  constraints: Map<string, OracleConstraintRow[]>;
  indexColumns: Map<string, OracleIndexColumnRow[]>;
  constraintColumns: Map<string, string[]>;
  constraintTargets: Map<string, { owner: string; table: string; columns: string[] }>;
};

function indexStructure(structure: NonNullable<OracleCatalogRows["structure"]>): StructureIndex {
  const constraintColumns = new Map<string, string[]>();
  for (const [id, rows] of groupBy(structure.constraintColumns, (row) => key(row.OWNER, row.CONSTRAINT_NAME))) {
    // Check constraints have no POSITION; order their columns by name instead.
    constraintColumns.set(id, rows
      .map((row) => [integer(row.POSITION, "POSITION") ?? 0, row.COLUMN_NAME] as const)
      .sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1], "en"))
      .map(([, name]) => name));
  }
  // A foreign key is identified by the columns it references, not by the
  // possibly generated name of the referenced key.
  const constraintTargets = new Map<string, { owner: string; table: string; columns: string[] }>();
  for (const row of structure.constraints) {
    if (row.CONSTRAINT_TYPE !== "P" && row.CONSTRAINT_TYPE !== "U") continue;
    const id = key(row.OWNER, row.CONSTRAINT_NAME);
    constraintTargets.set(id, { owner: row.OWNER, table: row.TABLE_NAME, columns: constraintColumns.get(id) ?? [] });
  }
  return {
    defaults: groupBy(structure.columnDefaults, (row) => key(row.OWNER, row.TABLE_NAME)),
    constraints: groupBy(structure.constraints, (row) => key(row.OWNER, row.TABLE_NAME)),
    indexColumns: groupBy(structure.indexColumns, (row) => key(row.TABLE_OWNER, row.TABLE_NAME)),
    constraintColumns,
    constraintTargets,
  };
}

function structureSignature(tableKey: string, columns: OracleColumnRow[], structure: StructureIndex): unknown {
  const defaults = (structure.defaults.get(tableKey) ?? [])
    .map((row) => [row.COLUMN_NAME, normalizedDefault(row.DATA_DEFAULT)])
    .filter(([, value]) => value != null);
  const constraints = (structure.constraints.get(tableKey) ?? []).map((row) => {
    const reference = row.CONSTRAINT_TYPE === "R" && row.R_OWNER && row.R_CONSTRAINT_NAME
      ? structure.constraintTargets.get(key(row.R_OWNER, row.R_CONSTRAINT_NAME)) ?? { owner: row.R_OWNER, constraint: row.R_CONSTRAINT_NAME }
      : null;
    return [
      // SYS_Cnnnnnn names are reissued whenever a constraint is recreated;
      // PostgreSQL's deterministic constraint names have no such churn.
      text(row.GENERATED) === "GENERATED NAME" ? GENERATED_NAME : row.CONSTRAINT_NAME,
      row.CONSTRAINT_TYPE,
      structure.constraintColumns.get(key(row.OWNER, row.CONSTRAINT_NAME)) ?? [],
      text(row.SEARCH_CONDITION),
      reference,
      text(row.DELETE_RULE), text(row.STATUS), text(row.DEFERRABLE), text(row.DEFERRED), text(row.VALIDATED),
    ];
  });
  const indexes = new Map<string, { name: string; uniqueness: string | null; type: string | null; columns: Array<[number, string, string | null]> }>();
  for (const row of structure.indexColumns.get(tableKey) ?? []) {
    // LOB segment indexes (SYS_IL...$$) are storage, not schema design.
    if (text(row.INDEX_TYPE) === "LOB") continue;
    const id = key(row.INDEX_OWNER, row.INDEX_NAME);
    const index = indexes.get(id) ?? {
      name: text(row.GENERATED) === "Y" ? GENERATED_NAME : row.INDEX_NAME,
      uniqueness: text(row.UNIQUENESS),
      type: text(row.INDEX_TYPE),
      columns: [],
    };
    // Function-based index keys are hidden SYS_NCnnnnn$ virtual columns.
    index.columns.push([integer(row.COLUMN_POSITION, "COLUMN_POSITION") ?? 0, /^SYS_NC\d+\$$/.test(row.COLUMN_NAME) ? INDEX_EXPRESSION : row.COLUMN_NAME, text(row.DESCEND)]);
    indexes.set(id, index);
  }
  // Types this mapper cannot format would otherwise hide size changes, so
  // their raw dimensions join the structure hash instead.
  const unrecognized = columns
    .filter((row) => !formatType(row).recognized)
    .map((row) => [row.COLUMN_NAME, row.DATA_TYPE, integer(row.DATA_LENGTH, "DATA_LENGTH"), integer(row.DATA_PRECISION, "DATA_PRECISION"),
      integer(row.DATA_SCALE, "DATA_SCALE"), integer(row.CHAR_LENGTH, "CHAR_LENGTH"), text(row.CHAR_USED)]);
  return {
    defaults: sortEntries(defaults),
    constraints: sortEntries(constraints),
    indexes: sortEntries([...indexes.values()].map((index) => [index.name, index.uniqueness, index.type,
      index.columns.sort((a, b) => a[0] - b[0]).map(([, name, descend]) => [name, descend])])),
    unrecognized: sortEntries(unrecognized),
  };
}

/**
 * Maps Oracle-family dictionary rows to the broker's schema snapshot. Only
 * rows owned by `owners` and belonging to real tables leave the broker: views,
 * recycle-bin, IOT overflow, nested and domain-index tables are dropped.
 * Defaults and check conditions contribute only to the structure hash.
 */
export function oracleCatalogToSchemaSnapshot(rows: OracleCatalogRows, owners: readonly string[]): OracleSchemaSnapshot {
  ownerList(owners.length);
  rejectCapped(rows.tables.length, ORACLE_ROW_LIMITS.tables, "table");
  rejectCapped(rows.columns.length, ORACLE_ROW_LIMITS.columns, "column");
  const structure = rows.structure;
  if (structure) {
    for (const group of [structure.columnDefaults, structure.constraints, structure.constraintColumns, structure.indexColumns]) {
      rejectCapped(group.length, ORACLE_ROW_LIMITS.structure, "structure row");
    }
  }
  const allowed = new Set(owners);
  const tables = new Map<string, { schema: string; table: string }>();
  for (const row of rows.tables) {
    if (!allowed.has(row.OWNER) || text(row.DROPPED) === "YES" || row.TABLE_NAME.startsWith("BIN$")) continue;
    const iotType = text(row.IOT_TYPE);
    if (iotType === "IOT_OVERFLOW" || iotType === "IOT_MAPPING" || text(row.NESTED) === "YES" || text(row.SECONDARY) === "Y") continue;
    tables.set(key(row.OWNER, row.TABLE_NAME), { schema: row.OWNER, table: row.TABLE_NAME });
  }
  const columnsByTable = new Map<string, OracleColumnRow[]>();
  const seen = new Set<string>();
  for (const row of rows.columns) {
    const tableKey = key(row.OWNER, row.TABLE_NAME);
    if (!tables.has(tableKey)) continue;
    const columnKey = JSON.stringify([row.OWNER, row.TABLE_NAME, row.COLUMN_NAME]);
    if (seen.has(columnKey)) throw new Error("Duplicate column in database catalogue");
    seen.add(columnKey);
    const columns = columnsByTable.get(tableKey);
    if (columns) columns.push(row);
    else columnsByTable.set(tableKey, [row]);
  }
  const indexed = structure ? indexStructure(structure) : null;
  const result: OracleSchemaSnapshot["tables"] = [];
  for (const [tableKey, table] of tables) {
    const columns = (columnsByTable.get(tableKey) ?? [])
      .map((row) => ({ row, position: requiredInteger(row.COLUMN_ID, "COLUMN_ID") }))
      .sort((a, b) => a.position - b.position)
      .map(({ row }) => row);
    result.push({
      ...table,
      columns: columns.map((row) => ({ name: row.COLUMN_NAME, type: formatType(row).type, nullable: nullable(row.NULLABLE) })),
      ...(indexed ? {
        structureSha256: createHash("sha256").update(JSON.stringify(structureSignature(tableKey, columns, indexed))).digest("hex"),
      } : {}),
    });
  }
  return { tables: result.sort((a, b) => key(a.schema, a.table).localeCompare(key(b.schema, b.table), "en")) };
}
