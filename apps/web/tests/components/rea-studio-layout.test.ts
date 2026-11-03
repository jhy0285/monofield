import { describe, expect, it } from 'vitest';
import type { ReaSqliteTable } from '@open-design/contracts';
import { ER_BOX_WIDTH, ER_HEADER, ER_ROW, layoutEr, layoutGraph } from '../../src/components/rea-studio/layout';

const column = (name: string, primaryKey = 0) => ({ name, type: 'INTEGER', notNull: false, primaryKey, defaultSql: null });
const table = (name: string, columns: string[], foreignKeys: ReaSqliteTable['foreignKeys'] = []): ReaSqliteTable => ({
  name, columns: columns.map((c, i) => column(c, i === 0 ? 1 : 0)), foreignKeys, unique: [], checks: [], indexes: [],
});

describe('layoutEr', () => {
  const tables = [
    table('audit_log', ['id', 'order_id'], [{ column: 'order_id', refTable: 'orders', refColumn: 'id' }]),
    table('settlements', ['id', 'order_id'], [{ column: 'order_id', refTable: 'orders', refColumn: 'id' }]),
    table('orders', ['id', 'customer_id'], [{ column: 'customer_id', refTable: 'customers', refColumn: 'id' }]),
    table('customers', ['id', 'name']),
  ];
  const layout = layoutEr(tables);

  it('puts parents left of the tables that reference them', () => {
    const by = Object.fromEntries(layout.boxes.map((box) => [box.name, box]));
    expect(by.customers!.depth).toBe(0);
    expect(by.orders!.depth).toBe(1);
    expect(by.settlements!.depth).toBe(2);
    expect(by.audit_log!.depth).toBe(2);
    expect(by.customers!.x).toBeLessThan(by.orders!.x);
    expect(by.orders!.x).toBeLessThan(by.settlements!.x);
    // The two children share a column and do not overlap.
    expect(by.settlements!.x).toBe(by.audit_log!.x);
    const [upper, lower] = [by.settlements!, by.audit_log!].sort((a, b) => a.y - b.y);
    expect(upper!.y + upper!.height).toBeLessThanOrEqual(lower!.y);
  });

  it('sizes each box from its columns and the canvas from its boxes', () => {
    const customers = layout.boxes.find((box) => box.name === 'customers')!;
    expect(customers.width).toBe(ER_BOX_WIDTH);
    expect(customers.height).toBe(ER_HEADER + 2 * ER_ROW + 8);
    expect(layout.width).toBeGreaterThan(3 * ER_BOX_WIDTH);
    for (const box of layout.boxes) expect(box.y + box.height).toBeLessThanOrEqual(layout.height);
  });

  it('draws one link per foreign key from the column row to the referenced table', () => {
    expect(layout.links.map((link) => `${link.fromTable}.${link.fromColumn}->${link.toTable}.${link.toColumn}`).sort()).toEqual([
      'audit_log.order_id->orders.id', 'orders.customer_id->customers.id', 'settlements.order_id->orders.id',
    ]);
    const orders = layout.boxes.find((box) => box.name === 'orders')!;
    const link = layout.links.find((candidate) => candidate.fromTable === 'orders')!;
    // Starts on the child's left edge at the foreign-key column's row (the second column).
    expect(link.d.startsWith(`M${orders.x},${orders.y + ER_HEADER + ER_ROW + ER_ROW / 2}`)).toBe(true);
  });

  it('survives a self reference, a reference to a missing table and no tables at all', () => {
    const odd = layoutEr([table('tree', ['id', 'parent_id'], [{ column: 'parent_id', refTable: 'tree', refColumn: 'id' }, { column: 'ghost_id', refTable: 'ghost', refColumn: 'id' }])]);
    expect(odd.boxes).toHaveLength(1);
    expect(odd.links).toHaveLength(1);
    expect(layoutEr([]).boxes).toEqual([]);
  });
});

describe('layoutGraph', () => {
  const nodes = [
    { id: 'a', kind: 'artifact', label: 'artifact root' },
    { id: 'm', kind: 'javascript-module', label: 'public/app.js' },
    { id: 'e', kind: 'endpoint', label: '/api/orders' },
    { id: 'x', kind: 'something-new', label: 'x' },
  ];
  const layout = layoutGraph(nodes, [{ from: 'a', to: 'm', relation: 'contains' }, { from: 'm', to: 'e', relation: 'calls' }, { from: 'm', to: 'missing', relation: 'imports' }]);

  it('puts roots on the left and endpoints to the right of the modules that call them', () => {
    const by = Object.fromEntries(layout.boxes.map((box) => [box.id, box]));
    expect(by.a!.x).toBeLessThan(by.m!.x);
    expect(by.m!.x).toBeLessThan(by.e!.x);
    expect(by.e!.x).toBeLessThan(by.x!.x);
  });

  it('keeps only edges whose ends are drawn', () => {
    expect(layout.links.map((link) => link.relation)).toEqual(['contains', 'calls']);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(40);
  });
});
