import { describe, expect, it } from "vitest";

import {
  formatOracleColumnType,
  normalizeOracleOwner,
  ORACLE_MAX_OWNERS,
  ORACLE_ROW_LIMITS,
  oracleCatalogStatements,
  oracleCatalogToSchemaSnapshot,
  oracleOwnerBinds,
  type OracleCatalogRows,
  type OracleColumnRow,
} from "../../src/main/database-oracle-catalog.js";
import { APP_OWNER, civilPetitionCatalog } from "./fixtures/oracle-catalog.js";

const column = (overrides: Partial<OracleColumnRow>): OracleColumnRow => ({
  OWNER: APP_OWNER, TABLE_NAME: "T", COLUMN_NAME: "C", COLUMN_ID: 1, DATA_TYPE: "NUMBER", DATA_LENGTH: 22, NULLABLE: "Y", ...overrides,
});

const hashes = (rows: OracleCatalogRows) => Object.fromEntries(
  oracleCatalogToSchemaSnapshot(rows, [APP_OWNER]).tables.map((table) => [table.table, table.structureSha256]),
);

/** ODBC drivers commonly deliver SQL_NUMERIC values as strings. */
function withStringNumbers(rows: OracleCatalogRows): OracleCatalogRows {
  return JSON.parse(JSON.stringify(rows, (_key, value: unknown) => typeof value === "number" ? String(value) : value)) as OracleCatalogRows;
}

describe("Oracle catalogue type formatting", () => {
  it.each<[string, Partial<OracleColumnRow>, string]>([
    ["byte semantics", { DATA_TYPE: "VARCHAR2", DATA_LENGTH: 20, CHAR_LENGTH: 20, CHAR_USED: "B" }, "VARCHAR2(20 BYTE)"],
    ["character semantics", { DATA_TYPE: "VARCHAR2", DATA_LENGTH: 400, CHAR_LENGTH: 100, CHAR_USED: "C" }, "VARCHAR2(100 CHAR)"],
    ["fixed char", { DATA_TYPE: "CHAR", DATA_LENGTH: 2, CHAR_LENGTH: 2, CHAR_USED: "B" }, "CHAR(2 BYTE)"],
    ["no length semantics column", { DATA_TYPE: "VARCHAR2", DATA_LENGTH: 20 }, "VARCHAR2(20)"],
    ["national character", { DATA_TYPE: "NVARCHAR2", DATA_LENGTH: 40, CHAR_LENGTH: 20, CHAR_USED: "C" }, "NVARCHAR2(20)"],
    ["unconstrained number", { DATA_TYPE: "NUMBER" }, "NUMBER"],
    ["integer", { DATA_TYPE: "NUMBER", DATA_SCALE: 0 }, "NUMBER(*,0)"],
    ["precision only", { DATA_TYPE: "NUMBER", DATA_PRECISION: 10, DATA_SCALE: 0 }, "NUMBER(10)"],
    ["precision and scale", { DATA_TYPE: "NUMBER", DATA_PRECISION: 12, DATA_SCALE: 2 }, "NUMBER(12,2)"],
    ["negative scale", { DATA_TYPE: "NUMBER", DATA_PRECISION: 5, DATA_SCALE: -2 }, "NUMBER(5,-2)"],
    ["binary float precision", { DATA_TYPE: "FLOAT", DATA_PRECISION: 126 }, "FLOAT(126)"],
    ["raw", { DATA_TYPE: "RAW", DATA_LENGTH: 16 }, "RAW(16)"],
    ["timestamp with time zone", { DATA_TYPE: "TIMESTAMP(6) WITH TIME ZONE", DATA_LENGTH: 13, DATA_SCALE: 6 }, "TIMESTAMP(6) WITH TIME ZONE"],
    ["interval", { DATA_TYPE: "INTERVAL DAY(2) TO SECOND(6)", DATA_LENGTH: 11, DATA_PRECISION: 2, DATA_SCALE: 6 }, "INTERVAL DAY(2) TO SECOND(6)"],
    ["date", { DATA_TYPE: "DATE", DATA_LENGTH: 7 }, "DATE"],
    ["object type", { DATA_TYPE: "SDO_GEOMETRY", DATA_TYPE_OWNER: "MDSYS", DATA_LENGTH: 1 }, "MDSYS.SDO_GEOMETRY"],
    ["object reference", { DATA_TYPE: "ADDRESS_T", DATA_TYPE_OWNER: APP_OWNER, DATA_TYPE_MOD: "REF", DATA_LENGTH: 46 }, "REF APP_OWNER.ADDRESS_T"],
    ["unrecognised type passes through", { DATA_TYPE: "VARCHAR", DATA_LENGTH: 20 }, "VARCHAR"],
  ])("formats %s", (_label, overrides, expected) => {
    expect(formatOracleColumnType(column(overrides))).toBe(expected);
  });
});

describe("Oracle catalogue schema snapshot", () => {
  it("maps in-scope tables in column order and drops views, recycle-bin, IOT overflow and other owners", () => {
    expect(oracleCatalogToSchemaSnapshot(civilPetitionCatalog(), [APP_OWNER])).toEqual({
      tables: [
        {
          schema: APP_OWNER,
          table: "TB_CVPL_APLY",
          columns: [
            { name: "APLY_NO", type: "VARCHAR2(20 BYTE)", nullable: "NO" },
            { name: "APLCNT_NM", type: "VARCHAR2(100 CHAR)", nullable: "NO" },
            { name: "PRCS_STTS_CD", type: "CHAR(2 BYTE)", nullable: "NO" },
            { name: "FEE_AMT", type: "NUMBER(12)", nullable: "YES" },
            { name: "APLY_DT", type: "DATE", nullable: "NO" },
            { name: "MDFCN_TS", type: "TIMESTAMP(6)", nullable: "YES" },
            { name: "RMRK_CN", type: "CLOB", nullable: "YES" },
          ],
          structureSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        {
          schema: APP_OWNER,
          table: "TB_CVPL_ATCH",
          columns: [
            { name: "ATCH_SN", type: "NUMBER(*,0)", nullable: "NO" },
            { name: "APLY_NO", type: "VARCHAR2(20 BYTE)", nullable: "NO" },
            { name: "FILE_HASH", type: "RAW(32)", nullable: "NO" },
            { name: "GEOM", type: "MDSYS.SDO_GEOMETRY", nullable: "YES" },
          ],
          structureSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      ],
    });
  });

  it("includes another schema only when it is in the owner allowlist", () => {
    const tables = oracleCatalogToSchemaSnapshot(civilPetitionCatalog(), [APP_OWNER, "OTHER_OWNER"]).tables;
    expect(tables.map((table) => `${table.schema}.${table.table}`)).toEqual([
      "APP_OWNER.TB_CVPL_APLY", "APP_OWNER.TB_CVPL_ATCH", "OTHER_OWNER.TB_SECRET_LEDGER",
    ]);
  });

  it("omits the structure hash when only table and column rows are supplied", () => {
    const { tables, columns } = civilPetitionCatalog();
    expect(oracleCatalogToSchemaSnapshot({ tables, columns }, [APP_OWNER]).tables.every((table) => !("structureSha256" in table))).toBe(true);
  });

  it("never exports defaults, check conditions or out-of-scope names", () => {
    const serialized = JSON.stringify(oracleCatalogToSchemaSnapshot(civilPetitionCatalog(), [APP_OWNER]));
    for (const hidden of ["'01'", "SYSDATE", "PRCS_STTS_CD IN", "do-not-export", "OTHER_OWNER", "TB_SECRET_LEDGER", "VW_CVPL_STATS", "BIN$", "SYS_IOT_OVER"]) {
      expect(serialized).not.toContain(hidden);
    }
  });

  it("produces the same snapshot regardless of row order or numeric representation", () => {
    const expected = oracleCatalogToSchemaSnapshot(civilPetitionCatalog(), [APP_OWNER]);
    const reversed = civilPetitionCatalog();
    reversed.tables.reverse();
    reversed.columns.reverse();
    for (const rows of Object.values(reversed.structure!)) rows.reverse();
    expect(oracleCatalogToSchemaSnapshot(reversed, [APP_OWNER])).toEqual(expected);
    expect(oracleCatalogToSchemaSnapshot(withStringNumbers(civilPetitionCatalog()), [APP_OWNER])).toEqual(expected);
  });
});

describe("Oracle catalogue structure hash", () => {
  const baseline = hashes(civilPetitionCatalog());

  it("ignores reissued system-generated names, DDL whitespace and an explicit DEFAULT NULL", () => {
    const rows = civilPetitionCatalog();
    const structure = rows.structure!;
    const rename = (name: string) => name === "SYS_C0011223" ? "SYS_C0099001" : name === "SYS_C0011230" ? "SYS_C0099002" : name;
    for (const row of structure.constraints) row.CONSTRAINT_NAME = rename(row.CONSTRAINT_NAME);
    for (const row of structure.constraintColumns) row.CONSTRAINT_NAME = rename(row.CONSTRAINT_NAME);
    for (const row of structure.indexColumns) row.INDEX_NAME = rename(row.INDEX_NAME);
    // The hidden column behind a function-based index is renumbered when other virtual columns appear.
    structure.indexColumns.find((row) => row.INDEX_NAME === "IX_CVPL_APLY_NM")!.COLUMN_NAME = "SYS_NC00012$";
    structure.columnDefaults[0]!.DATA_DEFAULT = "'01'";
    structure.columnDefaults.push({ OWNER: APP_OWNER, TABLE_NAME: "TB_CVPL_APLY", COLUMN_NAME: "FEE_AMT", DATA_DEFAULT: "NULL " });
    expect(hashes(rows)).toEqual(baseline);
  });

  it("reports a new LOB column as a column change only, as PostgreSQL does", () => {
    const rows = civilPetitionCatalog();
    rows.columns.push(column({ TABLE_NAME: "TB_CVPL_ATCH", COLUMN_NAME: "FILE_CN", COLUMN_ID: 5, DATA_TYPE: "BLOB", DATA_LENGTH: 4000 }));
    rows.structure!.indexColumns.push({ INDEX_OWNER: APP_OWNER, INDEX_NAME: "SYS_IL0000076544C00005$$", TABLE_OWNER: APP_OWNER, TABLE_NAME: "TB_CVPL_ATCH", UNIQUENESS: "UNIQUE", INDEX_TYPE: "LOB", GENERATED: "Y", COLUMN_NAME: "FILE_CN", COLUMN_POSITION: 1, DESCEND: "ASC" });
    expect(hashes(rows)).toEqual(baseline);
  });

  it("leaves the hash to column diffs for size changes of recognised types", () => {
    const rows = civilPetitionCatalog();
    const target = rows.columns.find((row) => row.TABLE_NAME === "TB_CVPL_APLY" && row.COLUMN_NAME === "APLY_NO")!;
    target.DATA_LENGTH = 30;
    target.CHAR_LENGTH = 30;
    expect(hashes(rows)).toEqual(baseline);
    expect(oracleCatalogToSchemaSnapshot(rows, [APP_OWNER]).tables[0]!.columns[0]).toEqual({ name: "APLY_NO", type: "VARCHAR2(30 BYTE)", nullable: "NO" });
  });

  it.each<[string, (rows: OracleCatalogRows) => void, string[]]>([
    ["a default value changes", (rows) => { rows.structure!.columnDefaults[0]!.DATA_DEFAULT = "'00'"; }, ["TB_CVPL_APLY"]],
    ["a check constraint is disabled", (rows) => { rows.structure!.constraints.find((row) => row.CONSTRAINT_NAME === "CK_CVPL_APLY_STTS")!.STATUS = "DISABLED"; }, ["TB_CVPL_APLY"]],
    ["a foreign key delete rule changes", (rows) => { rows.structure!.constraints.find((row) => row.CONSTRAINT_TYPE === "R")!.DELETE_RULE = "NO ACTION"; }, ["TB_CVPL_ATCH"]],
    ["an index is added", (rows) => {
      rows.structure!.indexColumns.push({ INDEX_OWNER: APP_OWNER, INDEX_NAME: "IX_CVPL_ATCH_HASH", TABLE_OWNER: APP_OWNER, TABLE_NAME: "TB_CVPL_ATCH", UNIQUENESS: "NONUNIQUE", INDEX_TYPE: "NORMAL", GENERATED: "N", COLUMN_NAME: "FILE_HASH", COLUMN_POSITION: 1, DESCEND: "ASC" });
    }, ["TB_CVPL_ATCH"]],
    // The primary key itself changes, and so does every foreign key resolved to its columns.
    ["a referenced primary key gains a column", (rows) => {
      rows.structure!.constraintColumns.push({ OWNER: APP_OWNER, CONSTRAINT_NAME: "PK_TB_CVPL_APLY", TABLE_NAME: "TB_CVPL_APLY", COLUMN_NAME: "APLY_DT", POSITION: 2 });
    }, ["TB_CVPL_APLY", "TB_CVPL_ATCH"]],
  ])("changes exactly the affected table hashes when %s", (_label, mutate, changedTables) => {
    const rows = civilPetitionCatalog();
    mutate(rows);
    const next = hashes(rows);
    expect(Object.keys(baseline).filter((table) => next[table] !== baseline[table])).toEqual(changedTables);
  });

  it("keeps the referenced key name for foreign keys into schemas outside the allowlist", () => {
    // Shared code tables commonly live under a separate owner that is not monitored.
    const rows = civilPetitionCatalog();
    rows.structure!.constraints.push({ OWNER: APP_OWNER, CONSTRAINT_NAME: "FK_CVPL_APLY_STTS", CONSTRAINT_TYPE: "R", TABLE_NAME: "TB_CVPL_APLY", R_OWNER: "COM_OWNER", R_CONSTRAINT_NAME: "PK_CMMN_CD", DELETE_RULE: "NO ACTION", STATUS: "ENABLED", GENERATED: "USER NAME" });
    rows.structure!.constraintColumns.push({ OWNER: APP_OWNER, CONSTRAINT_NAME: "FK_CVPL_APLY_STTS", TABLE_NAME: "TB_CVPL_APLY", COLUMN_NAME: "PRCS_STTS_CD", POSITION: 1 });
    const before = hashes(rows);
    rows.structure!.constraints.at(-1)!.R_CONSTRAINT_NAME = "PK_CMMN_CD_V2";
    expect(hashes(rows).TB_CVPL_APLY).not.toBe(before.TB_CVPL_APLY);
  });

  it("hashes raw dimensions of unrecognised types so their size changes stay visible", () => {
    const rows = civilPetitionCatalog();
    rows.columns.push(column({ TABLE_NAME: "TB_CVPL_ATCH", COLUMN_NAME: "LEGACY_CD", COLUMN_ID: 5, DATA_TYPE: "VARCHAR", DATA_LENGTH: 10 }));
    const before = hashes(rows);
    rows.columns.at(-1)!.DATA_LENGTH = 20;
    expect(hashes(rows).TB_CVPL_ATCH).not.toBe(before.TB_CVPL_ATCH);
    expect(hashes(rows).TB_CVPL_APLY).toBe(before.TB_CVPL_APLY);
  });
});

describe("Oracle catalogue validation", () => {
  it("rejects unexpected dictionary values instead of guessing", () => {
    const nullability = civilPetitionCatalog();
    nullability.columns[0]!.NULLABLE = "U";
    expect(() => oracleCatalogToSchemaSnapshot(nullability, [APP_OWNER])).toThrow("NULLABLE");
    const precision = civilPetitionCatalog();
    precision.columns.find((row) => row.COLUMN_NAME === "FEE_AMT")!.DATA_PRECISION = "12.5";
    expect(() => oracleCatalogToSchemaSnapshot(precision, [APP_OWNER])).toThrow("DATA_PRECISION");
    const order = civilPetitionCatalog();
    order.columns[0]!.COLUMN_ID = null;
    expect(() => oracleCatalogToSchemaSnapshot(order, [APP_OWNER])).toThrow("COLUMN_ID");
    const duplicate = civilPetitionCatalog();
    duplicate.columns.push({ ...duplicate.columns[0]! });
    expect(() => oracleCatalogToSchemaSnapshot(duplicate, [APP_OWNER])).toThrow("Duplicate");
  });

  it("fails closed when a statement reached its row cap", () => {
    const table = { OWNER: APP_OWNER, TABLE_NAME: "T" };
    expect(() => oracleCatalogToSchemaSnapshot({ tables: Array.from({ length: ORACLE_ROW_LIMITS.tables + 1 }, () => table), columns: [] }, [APP_OWNER]))
      .toThrow("10000 table monitoring limit");
    expect(() => oracleCatalogToSchemaSnapshot({ tables: [], columns: Array.from({ length: ORACLE_ROW_LIMITS.columns + 1 }, () => column({})) }, [APP_OWNER]))
      .toThrow("50000 column monitoring limit");
    const rows = civilPetitionCatalog();
    rows.structure!.constraintColumns = Array.from({ length: ORACLE_ROW_LIMITS.structure + 1 }, () => rows.structure!.constraintColumns[0]!);
    expect(() => oracleCatalogToSchemaSnapshot(rows, [APP_OWNER])).toThrow("structure row monitoring limit");
  });
});

describe("Oracle catalogue statements and owner scope", () => {
  it("folds unquoted schema names to upper case and keeps quoted names exact", () => {
    expect(normalizeOracleOwner(" app_owner ")).toBe("APP_OWNER");
    expect(normalizeOracleOwner("\"MixedCase\"")).toBe("MixedCase");
    for (const invalid of ["", "  ", "\"\"", "\"a\"b\"", "a\u0000b", "X".repeat(129)]) expect(() => normalizeOracleOwner(invalid)).toThrow("Oracle identifier");
  });

  it("binds owners instead of interpolating them", () => {
    expect(oracleOwnerBinds([APP_OWNER, "COM_OWNER"])).toEqual({ owner0: APP_OWNER, owner1: "COM_OWNER" });
    expect(() => oracleOwnerBinds([])).toThrow("schemas");
    expect(() => oracleOwnerBinds(Array.from({ length: ORACLE_MAX_OWNERS + 1 }, (_, index) => `OWNER_${index}`))).toThrow("schemas");
    expect(oracleCatalogStatements(2).tables).toContain("OWNER IN (:owner0, :owner1)");
  });

  it("issues only read-only queries against ALL_* views and never wraps LONG columns", () => {
    const { readOnlyTransaction, ...queries } = oracleCatalogStatements(3);
    expect(readOnlyTransaction).toBe("SET TRANSACTION READ ONLY");
    for (const sql of Object.values(queries)) {
      expect(sql).toMatch(/^SELECT /);
      expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|GRANT|TRUNCATE|BEGIN|DECLARE|EXECUTE|ORDER BY|FOR UPDATE)\b|;/);
      expect(sql).not.toMatch(/\b(?:DBA_|CDB_|USER_|G?V\$|SYS\.)/);
      // Oracle rejects LONG columns inside subqueries, ORDER BY and expressions.
      if (/\b(?:DATA_DEFAULT|SEARCH_CONDITION)\b/.test(sql)) expect(sql).not.toContain("(SELECT");
    }
    expect([...new Set(Object.values(queries).flatMap((sql) => sql.match(/\bALL_[A-Z_]+|\bDUAL\b/g) ?? []))].sort()).toEqual([
      "ALL_CONSTRAINTS", "ALL_CONS_COLUMNS", "ALL_INDEXES", "ALL_IND_COLUMNS", "ALL_TABLES", "ALL_TAB_COLUMNS", "DUAL",
    ]);
  });
});
