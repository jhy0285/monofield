# 0002. Read-only Oracle and Tibero metadata access

## Status

Proposed. Phase 1 (catalogue mapping, no driver) is implemented; phases 2 and 3 are not.

## Context

MonoField's governed database access and schema watch support PostgreSQL only ([`docs/database-schema-watch.md`](../database-schema-watch.md)). The target users are Korean SI and public-sector teams. Their systems mostly run Oracle Database and TmaxTibero, and many of those systems use `KO16MSWIN949`/`KO16KSC5601` character sets, separate owner and application accounts, MyBatis/iBATIS SQL mappers and, in places, Oracle 11g R2.

### Where the database code lives

The PostgreSQL access path is split across processes. The part that touches a database runs in the Electron main process, not the daemon:

| Concern | Location |
| --- | --- |
| Encrypted connection store, approval dialogs, `pg` driver, SQL, mutation audit log | `apps/desktop/src/main/database-broker.ts` (`DatabaseBroker`) |
| Broker request protocol (no URLs, credentials or SQL) | `packages/sidecar-proto/src/index.ts` (`DesktopDatabaseRequest`) |
| `/api/database/*` routes: validate and relay to the Desktop broker over sidecar IPC | `apps/daemon/src/routes/database.ts` |
| Schema watch: polls `schema-snapshot` with `background: true`, diffs, persists state | `apps/daemon/src/services/database-schema-watch.ts`, `routes/database-schema-watch.ts` |
| `monofield database …` CLI on the same routes | `apps/daemon/src/database-cli.ts`, `services/schema-watch-cli.ts` |
| Source-code table candidates (no database access) | `apps/daemon/src/database-candidates.ts` |
| Snapshot and response DTOs | `packages/contracts/src/api/database.ts` (`DatabaseSchemaSnapshot` and others) |
| Renderer bridge and settings form | `packages/host/src/index.ts`, `apps/web/src/components/SettingsDialog.tsx` (`DatabaseConnectionsSection`) |

The daemon, CLI, contracts and schema-watch diff work with connection ids and `DatabaseSchemaSnapshot`, so they don't depend on the database dialect. The PostgreSQL-specific code is:

- In the broker: `asPostgresUrl`, the `postgres://` redaction in `safeError`, the `default_transaction_read_only` startup option, the `information_schema`/`pg_catalog` SQL, and identifier validation and quoting.
- In the web form: it builds a `postgresql://` URL.
- In the locale strings: "Encrypted PostgreSQL connection".

## Decision

### 1. Oracle-family access is a Desktop broker dialect, not a daemon feature

Credentials stay in the Desktop main process, as they do today. A stored connection gains `dialect: 'postgresql' | 'oracle' | 'tibero'`. A missing value reads as `postgresql`, so existing encrypted stores keep working without a format bump. The daemon, CLI and schema watch need no dialect branches. The dialect reaches the UI and CLI only as a display field on `DatabaseConnectionSummary` (see 7).

### 2. Metadata only, and never a write

For `oracle` and `tibero` connections the broker serves `list`, `schemas`, `describe`, `schema-snapshot` and `inspect`. `inspect` returns columns with empty `sampleRows`. The broker rejects `sample` and `mutate` before it opens a connection. For these dialects `writePolicy` is fixed at `disabled`, and `save`/`setAccessPolicy` reject any other value. Row sampling would bring the existing sensitive-column redaction problem to systems that hold resident registration numbers and similar data. That needs its own decision.

### 3. Fixed catalogue statements against `ALL_*` views

All SQL is the constant set returned by `oracleCatalogStatements()` in `apps/desktop/src/main/database-oracle-catalog.ts`. These statements:

- read only `ALL_TABLES`, `ALL_TAB_COLUMNS`, `ALL_CONSTRAINTS`, `ALL_CONS_COLUMNS`, `ALL_INDEXES`, `ALL_IND_COLUMNS` and `DUAL`.
- receive owners only as `:ownerN` bind variables. No identifier is ever interpolated. Because there is no row sampling, there is no quoting path at all.
- keep the LONG columns `DATA_DEFAULT` and `SEARCH_CONDITION` out of subqueries, `ORDER BY` and expressions, which Oracle rejects. The defaults come from their own statement.
- cap every result with `ROWNUM <= limit + 1` in the outer `WHERE`. The mapper rejects a result that hit the cap, so a large schema fails visibly instead of being silently truncated. The limits match the existing ones: 10,000 tables and 50,000 columns.

A unit test asserts these properties for every statement.

`ALL_*` is used instead of `DBA_*`, which needs `SELECT ANY DICTIONARY` or `SELECT_CATALOG_ROLE`, and instead of `USER_*`, which can't see the owner schema an application account reads through grants.

### 4. Layered read-only enforcement

Each layer is independent of the others:

1. The statement allowlist above.
2. `SET TRANSACTION READ ONLY` as the first statement of every session. It also gives all six catalogue reads one transaction-consistent view, the counterpart of the single-statement PostgreSQL snapshot.
3. A 10-second `callTimeout`, matching `statement_timeout=10000`.
4. The session never commits and is closed after each request.
5. Operator guidance: a dedicated account with `CREATE SESSION` and only the grants needed to see the monitored objects.

Sessions identify themselves with the driver's end-to-end tracing attributes (`module = 'MonoField'`, `action = <broker action>`) and the Thin-mode `program`/`driverName` connection options. DBA auditing and DB access-control gateways can then attribute and allow-list MonoField sessions.

### 5. Explicit owner scope

Each Oracle-family connection stores a non-secret owner allowlist of 1–32 schemas. It defaults to the login user's schema (`SELECT USER AS OWNER FROM DUAL`). `normalizeOracleOwner` applies Oracle identifier rules: an unquoted name folds to upper case, a `"Quoted"` name keeps its case. The mapper also drops rows outside the allowlist as defence in depth. This avoids scanning thousands of `SYS`/`MDSYS` objects. It also doesn't depend on `ALL_USERS.ORACLE_MAINTAINED`, which needs 12c and isn't confirmed for Tibero.

### 6. Map onto the existing snapshot contract

`oracleCatalogToSchemaSnapshot` produces exactly the existing `DatabaseSchemaSnapshot` shape, so schema-watch diffing, acknowledgement, the document graph and the CLI need no change.

**Real tables only.** Views, recycle-bin tables (`DROPPED = 'YES'`, `BIN$…`), IOT overflow and mapping segments, nested-table storage and domain-index secondary tables are dropped.

**Names verbatim.** Names are kept in dictionary case, usually upper case. Quoted mixed-case identifiers are distinct objects in Oracle, so names are never folded.

**Nullability.** `NULLABLE` `Y`/`N` becomes `YES`/`NO`. Any other value throws.

**Types.** Each column gets an Oracle-style type string:

- `VARCHAR2(20 BYTE)` and `VARCHAR2(100 CHAR)` keep their length semantics. A byte↔char change is a real column change for Hangul data: 30 bytes hold 10 syllables in AL32UTF8.
- Numbers: `NUMBER`, `NUMBER(*,0)`, `NUMBER(12)`, `NUMBER(12,2)`, `NUMBER(5,-2)`; floats: `FLOAT(126)`.
- `RAW(n)`.
- `TIMESTAMP(6) WITH TIME ZONE` and `INTERVAL DAY(2) TO SECOND(6)` keep the precision that is part of the `DATA_TYPE` name.
- Object types become `OWNER.TYPE`, prefixed with `REF ` for references.

An unrecognised type passes through verbatim, and its raw length, precision and scale enter the structure hash so a size change stays visible.

**Numbers from either driver.** Numeric dictionary values are accepted as JS numbers (node-oracledb) or as integer strings (ODBC `SQL_NUMERIC`). Anything else throws.

**`structureSha256`.** The hash covers:

- non-null defaults, trimmed, with `NULL` counted as no default;
- `P`/`U`/`R`/`C` constraints with their columns, condition, status, deferrability, validation and delete rule;
- indexes with their uniqueness, type and ordered columns.

Three normalizations keep the hash in line with PostgreSQL behaviour:

- System-generated constraint and index names (`SYS_Cnnnnnn`) become a placeholder because Oracle reissues them on every recreate.
- A foreign key is identified by the table and columns it references, not by the name of the referenced key.
- Function-based index keys (`SYS_NCnnnnn$`) and LOB segment indexes are normalized or ignored.

As in PostgreSQL, defaults and check conditions leave the broker only inside the hash.

### 7. Contracts and surfaces (phase 2)

| Change | Location |
| --- | --- |
| `dialect` field on the connection summary | `DatabaseConnectionSummary` in `packages/contracts/src/api/database.ts` |
| `dialect` field on the host bridge types | `OpenDesignHostDatabaseConnection` in `packages/host` |
| Structured Oracle target replaces the free-form `connectionString` for these dialects: host, port, service name or SID, user, password, owners | `OpenDesignHostDatabaseConnectionInput` |

No `/api/*` endpoint is added. The existing routes serve every dialect, and `monofield database list --json` shows `dialect` through the same `/api/database/connections` route the UI uses. Registering a connection stays Desktop-only, as it is today. Credentials never pass through the daemon, the CLI or `/api/*`. This is the existing documented exception (`monofield database help`: "Connection credentials are configured only in the MonoField desktop app") and this ADR doesn't widen it.

The settings form adds a dialect selector and Oracle fields. New strings go into all 18 locales. `docs/database-schema-watch.md` changes only when a dialect actually ships.

### 8. Data paths

Nothing new is stored by the daemon. Credentials and the owner allowlist stay in the Desktop encrypted connection store. Schema-watch snapshots flow through the existing daemon store, whose location is governed only by root [`AGENTS.md`](../../AGENTS.md) → **Daemon data directory contract**. This ADR does not restate those rules.

## Driver choice and licensing

### Oracle Database: `oracledb` (node-oracledb), Thin mode

These facts were checked against the published 26.0.0 package and the [node-oracledb documentation](https://node-oracledb.readthedocs.io/en/latest/):

| Package fact | Value |
| --- | --- |
| License | `(Apache-2.0 OR UPL-1.0)`. `THIRD_PARTY_LICENSES.txt` covers bundled Node.js code. Compatible with this repository's Apache-2.0 distribution. npm dependencies are not listed one by one; the pre-release dependency license scan in [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) → Release checks covers it, and packaged builds must keep its `LICENSE.txt`/`NOTICE.txt`/`THIRD_PARTY_LICENSES.txt`. |
| Runtime dependencies | None |
| Install footprint | 4.1 MB unpacked, mostly four prebuilt Thick-mode binaries |
| Lifecycle scripts | An `install` script that only checks viability. Under pnpm 10 it does not run unless listed in `onlyBuiltDependencies`. Thin mode does not need it, so it stays unlisted. |

**Thin mode** is the default and is pure JavaScript. No Oracle Client is required, and the native binary is loaded only by `oracledb.initOracleClient()`. It requires **Oracle Database 12.1 or later**. Any database character set works because the server converts to UTF-8, so `KO16MSWIN949` is fine. A `UTF8` national character set affects only NCHAR data, which dictionary views don't use.

**Thick mode** reaches **11.2**. It needs a user-installed Oracle Instant Client 19 or later and loads a native addon. Since 7.0.0 there is no macOS Intel prebuild. Since 26.0.0 the unversioned `libclntsh.so`/`.dylib` name is required. MonoField never bundles Instant Client, which is under Oracle's own license. Thick mode is a later opt-in setting that points to a local Instant Client directory.

**Version.** Pin an exact version per `scripts/guard.ts` when phase 2 lands. The current release is `26.0.0` (8 Oct 2026); the previous line is `7.0.1` (15 Jul 2026). Prefer the newest release that is at least two weeks old at that time: `"oracledb": "26.0.0"` as of this ADR. The lockfile change triggers the Nix pnpm-deps hash refresh check (root `AGENTS.md` → Validation strategy).

### Tibero: ODBC via `odbc`, deferred

node-oracledb speaks only Oracle Net. Tibero clients use Tibero's own drivers (tbJDBC, and ODBC/tbCLI), and TmaxTibero ships no Node.js driver. Its documented Node.js route is ODBC through the `odbc` npm package ([Tibero support: Node.js Integration Example Query](https://support.tibero.com/hc/en-us/articles/13714333769359-Nodejs-Integration-Example-Query), applicable to 6 FS07PS and 7 FS02PS), using the Tibero ODBC driver/tbCLI. Whether Tibero accepts Oracle Net clients at all is not established here and doesn't change the plan. The facts below come from the npm registry metadata for `odbc`; the tarball was not inspected.

| Package fact | Value |
| --- | --- |
| Version | `2.6.0` (23 Sep 2026) |
| License | MIT |
| Node requirement | Node ≥ 20 |
| Install | A native N-API addon fetched or built via `@mapbox/node-pre-gyp` |
| Prerequisites | unixODBC on Linux/macOS and a user-installed, proprietary Tibero ODBC driver, which MonoField never bundles |

That means an `onlyBuiltDependencies` entry, Electron packaging and `asarUnpack` work, and a driver-manager prerequisite on user machines. A JDBC bridge using tbJDBC on a bundled or located JRE in a sidecar process was rejected: it adds a JRE, a second long-lived process and a larger attack surface for a metadata-only feature.

The catalogue mapper already accepts Tibero-shaped input. Optional Oracle-only columns may be absent, numerics may arrive as strings, and unknown type names pass through with their dimensions hashed. Tibero's `ALL_*` column set has **not** been confirmed against a live instance, and public documentation doesn't settle it. The Tibero statement set is therefore not written yet: it is finalised only against a live Tibero 6/7 in phase 3. Unexpected values fail closed, so schema watch shows an error instead of reporting no change.

## Phasing

1. **Phase 1 (this change).** This ADR, plus `apps/desktop/src/main/database-oracle-catalog.ts`: statements, owner normalization and binds, type formatting, and row-to-snapshot mapping as pure functions. Fixture tests live in `apps/desktop/tests/main/database-oracle-catalog.test.ts`. No dependency, UI, contract or user-documentation change; MonoField still supports PostgreSQL only.
2. **Phase 2: Oracle 12.1+ (Thin).**
   - Add `oracledb`, the `dialect` field (7) and broker branching (2, 4).
   - Add the Desktop form and locales.
   - Add an integration suite gated on an environment variable such as `MONOFIELD_ORACLE_INTEGRATION_URL`, mirroring `MONOFIELD_DB_INTEGRATION_URL`. It runs against a disposable Oracle Database Free instance and repeats the PostgreSQL schema-watch DDL scenarios (resize, nullability, drop/add, index, default secrecy).
   - Update the user documentation.
3. **Phase 3.**
   - Tibero via ODBC after live dictionary verification.
   - Optional Thick mode for 11.2.
   - `ALL_IND_EXPRESSIONS`, so a changed function-based index expression changes the hash; phase 1 only normalizes its hidden column name.

## Alternatives considered

- **Run Oracle access in the daemon.** Rejected. It would move credentials out of the Desktop encrypted store and break the existing "agents never see credentials" boundary.
- **Hash `DBMS_METADATA.GET_DDL` output.** Rejected. It executes PL/SQL, needs `SELECT_CATALOG_ROLE` for other schemas, is slow on large schemas, and its storage and tablespace clauses change without any schema change.
- **`DBA_*` or `USER_*` views.** Rejected; see Decision 3.
- **Thick mode by default.** Rejected. It would require distributing or locating Instant Client on every machine to serve the minority of 11g systems.
- **One generic JDBC sidecar for Oracle and Tibero.** Rejected for the same reasons as the Tibero JDBC bridge.

## Consequences

- Schema watch, impact analysis and the CLI will work for Oracle without new routes or contract shapes. The only contract change is the additive `dialect` field.
- Evidence references must use dictionary case. Document-graph matching compares `schema`/`table`/`column` exactly (`apps/daemon/src/services/document-graph.ts`), so `APP_OWNER.TB_CVPL_APLY.APLY_NO` matches and `app_owner.tb_cvpl_aply.aply_no` does not. Phase 2 documentation must say so, and the UI should offer names picked from the captured snapshot instead of typed ones.
- Large public-sector schemas can exceed 50,000 columns. The owner allowlist is the intended way to stay under the limit. Raising the limit is a separate decision because it is shared with PostgreSQL and the contract schema.
- `ALL_*` views can be slow on databases with many grants. The 10-second call timeout fails a slow capture visibly. It doesn't retry.
- A disabled or `NOVALIDATE` NOT NULL constraint reports `NULLABLE = 'Y'`. The constraint still appears in the structure hash.
- Oracle 11g R2 systems stay unsupported until Thick mode lands.

## Adjacent issues (not addressed here)

- `apps/daemon/src/database-candidates.ts` misses table references in MyBatis/iBATIS mapper XML, the dominant pattern in eGovFramework projects. A mapper whose `FROM COMTNEMPLYRINFO` line has no SQL verb on the same line produces no candidate. This was reproduced against the current scanner. It is dialect-independent and should get its own red spec and fix.
