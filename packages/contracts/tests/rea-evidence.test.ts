import { describe, expect, it } from 'vitest';
import { REA_PACKAGE, classifyReaEvidence, parseSqliteConstraints, satisfiesNodeRange } from '../src/api/rea-evidence';

describe('classifyReaEvidence', () => {
  it('names the kind from the predicate or the operation', () => {
    expect(classifyReaEvidence('rea.browser-scenario-capture', 'capture_browser_scenario')).toBe('browser');
    expect(classifyReaEvidence('rea.analysis', 'inspect_sqlite_database')).toBe('sqlite');
    expect(classifyReaEvidence('rea.analysis', 'analyze_javascript_application')).toBe('static');
    expect(classifyReaEvidence('rea.application-feature-trace', 'trace_application_feature')).toBe('trace');
    expect(classifyReaEvidence('rea.analysis-view', 'inspect_analysis_view')).toBe('view');
    expect(classifyReaEvidence('rea.something-new', 'future_operation')).toBe('other');
  });
});

describe('parseSqliteConstraints', () => {
  it('reads inline foreign keys, UNIQUE and CHECK declarations', () => {
    const sql = "CREATE TABLE settlements(id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),gross_amount INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)";
    expect(parseSqliteConstraints(sql)).toEqual({ foreignKeys: [{ column: 'order_id', refTable: 'orders', refColumn: 'id' }], unique: ['order_id'], checks: [] });
  });

  it('keeps a CHECK whole when it holds commas, parentheses and quotes', () => {
    const sql = "CREATE TABLE orders(id INTEGER PRIMARY KEY,customer_id INTEGER NOT NULL REFERENCES customers(id),status TEXT NOT NULL CHECK(status IN ('PAID','PENDING','CANCELLED')),gross_amount INTEGER NOT NULL CHECK(gross_amount>0),commission_bps INTEGER NOT NULL CHECK(commission_bps BETWEEN 0 AND 10000))";
    const parsed = parseSqliteConstraints(sql);
    expect(parsed.checks).toEqual(["status IN ('PAID','PENDING','CANCELLED')", 'gross_amount>0', 'commission_bps BETWEEN 0 AND 10000']);
    expect(parsed.foreignKeys).toEqual([{ column: 'customer_id', refTable: 'customers', refColumn: 'id' }]);
    expect(parsed.unique).toEqual([]);
  });

  it('reads table constraints, composite ones included, and quoted names', () => {
    const sql = 'CREATE TABLE "line item"(order_id INTEGER, sku TEXT, qty INTEGER, PRIMARY KEY(order_id, sku), UNIQUE(sku, qty), CONSTRAINT fk FOREIGN KEY(order_id) REFERENCES "orders"(id), FOREIGN KEY (sku) REFERENCES products, CHECK (qty > 0))';
    const parsed = parseSqliteConstraints(sql);
    expect(parsed.foreignKeys).toEqual([
      { column: 'order_id', refTable: 'orders', refColumn: 'id' },
      { column: 'sku', refTable: 'products', refColumn: 'id' },
    ]);
    expect(parsed.unique).toEqual(['sku, qty']);
    expect(parsed.checks).toEqual(['qty > 0']);
  });

  it('is not fooled by the word UNIQUE inside a CHECK or a name, and tolerates missing SQL', () => {
    expect(parseSqliteConstraints("CREATE TABLE t(code TEXT CHECK(code <> 'UNIQUE'), n INTEGER)").unique).toEqual([]);
    expect(parseSqliteConstraints(null)).toEqual({ foreignKeys: [], unique: [], checks: [] });
    expect(parseSqliteConstraints('not sql')).toEqual({ foreignKeys: [], unique: [], checks: [] });
  });
});

describe('satisfiesNodeRange', () => {
  it('reads the caret and lower-bound ranges REA declares', () => {
    const range = REA_PACKAGE.node;
    expect(['v22.19.0', '22.20.1', 'v24.11.0', 'v24.15.2', 'v26.0.0', 'v27.1.0'].map((version) => satisfiesNodeRange(version, range))).toEqual([true, true, true, true, true, true]);
    expect(['v20.18.0', 'v22.18.9', 'v23.5.0', 'v24.10.9', 'v25.9.0', 'not-a-version'].map((version) => satisfiesNodeRange(version, range))).toEqual([false, false, false, false, false, false]);
  });
});
