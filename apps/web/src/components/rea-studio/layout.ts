import type { ReaSqliteColumn, ReaSqliteTable, ReaStaticEdge, ReaStaticNode } from '@open-design/contracts';

/** Pure layout for the two diagrams of REA Studio: tables and their foreign keys, and the application graph. */
export const ER_BOX_WIDTH = 236;
export const ER_HEADER = 30;
export const ER_ROW = 22;
const ER_GAP_X = 96;
const ER_GAP_Y = 36;
const ER_PAD = 16;

export interface ErBox { name: string; x: number; y: number; width: number; height: number; depth: number; columns: ReaSqliteColumn[] }
export interface ErLink { fromTable: string; fromColumn: string; toTable: string; toColumn: string; d: string }
export interface ErLayout { width: number; height: number; boxes: ErBox[]; links: ErLink[] }

/** How many foreign-key hops separate a table from one that references nothing: parents get depth 0. */
function depths(tables: ReaSqliteTable[]): Map<string, number> {
  const byName = new Map(tables.map((table) => [table.name, table]));
  const result = new Map<string, number>();
  const visit = (name: string, trail: Set<string>): number => {
    const known = result.get(name);
    if (known !== undefined) return known;
    const table = byName.get(name);
    if (!table || trail.has(name)) return 0;
    trail.add(name);
    const parents = table.foreignKeys.map((key) => key.refTable).filter((parent) => parent !== name && byName.has(parent));
    const depth = parents.length ? 1 + Math.max(...parents.map((parent) => visit(parent, trail))) : 0;
    trail.delete(name);
    result.set(name, depth);
    return depth;
  };
  for (const table of tables) visit(table.name, new Set());
  return result;
}

/** Tables in columns by foreign-key depth, parents on the left, so every reference points leftwards. */
export function layoutEr(tables: ReaSqliteTable[]): ErLayout {
  const depth = depths(tables);
  const columns = new Map<number, ReaSqliteTable[]>();
  for (const table of tables) columns.set(depth.get(table.name) ?? 0, [...(columns.get(depth.get(table.name) ?? 0) ?? []), table]);
  const boxes: ErBox[] = [];
  let height = 0;
  [...columns.entries()].sort((a, b) => a[0] - b[0]).forEach(([level, group], column) => {
    let y = ER_PAD;
    for (const table of group) {
      const boxHeight = ER_HEADER + Math.max(1, table.columns.length) * ER_ROW + 8;
      boxes.push({ name: table.name, x: ER_PAD + column * (ER_BOX_WIDTH + ER_GAP_X), y, width: ER_BOX_WIDTH, height: boxHeight, depth: level, columns: table.columns });
      y += boxHeight + ER_GAP_Y;
    }
    height = Math.max(height, y - ER_GAP_Y + ER_PAD);
  });
  const box = new Map(boxes.map((item) => [item.name, item]));
  const anchorY = (item: ErBox, column: string) => {
    const index = Math.max(0, item.columns.findIndex((candidate) => candidate.name === column));
    return item.y + ER_HEADER + index * ER_ROW + ER_ROW / 2;
  };
  const links: ErLink[] = [];
  for (const table of tables) {
    for (const key of table.foreignKeys) {
      const from = box.get(table.name);
      const to = box.get(key.refTable);
      if (!from || !to) continue;
      const y1 = anchorY(from, key.column);
      const y2 = anchorY(to, key.refColumn);
      let d: string;
      if (to.x + to.width <= from.x) {
        const x1 = from.x;
        const x2 = to.x + to.width;
        d = `M${x1},${y1} C${x1 - 48},${y1} ${x2 + 48},${y2} ${x2},${y2}`;
      } else {
        // A reference inside one column (or to a later one): loop out of the right edge and back in.
        const x1 = from.x + from.width;
        const x2 = to.x + to.width;
        d = `M${x1},${y1} C${x1 + 56},${y1} ${x2 + 56},${y2} ${x2},${y2}`;
      }
      links.push({ fromTable: table.name, fromColumn: key.column, toTable: key.refTable, toColumn: key.refColumn, d });
    }
  }
  return { width: ER_PAD * 2 + columns.size * ER_BOX_WIDTH + Math.max(0, columns.size - 1) * ER_GAP_X, height: Math.max(height, ER_PAD * 2 + ER_HEADER), boxes, links };
}

export const GRAPH_NODE_WIDTH = 200;
export const GRAPH_NODE_HEIGHT = 40;
const GRAPH_GAP_X = 110;
const GRAPH_GAP_Y = 16;
const KIND_COLUMN: Readonly<Record<string, number>> = { artifact: 0, package: 1, 'electron-renderer': 1, 'javascript-asset': 1, 'javascript-module': 2, endpoint: 3 };

export interface GraphBox { id: string; kind: string; label: string; x: number; y: number; column: number }
export interface GraphLink { from: string; to: string; relation: string; d: string }
export interface GraphLayout { width: number; height: number; boxes: GraphBox[]; links: GraphLink[] }

/** The application graph in columns by node kind: roots on the left, endpoints on the right. */
export function layoutGraph(nodes: ReaStaticNode[], edges: ReaStaticEdge[]): GraphLayout {
  const grouped = new Map<number, ReaStaticNode[]>();
  for (const node of nodes) {
    const column = KIND_COLUMN[node.kind] ?? 4;
    grouped.set(column, [...(grouped.get(column) ?? []), node]);
  }
  const used = [...grouped.keys()].sort((a, b) => a - b);
  const boxes: GraphBox[] = [];
  let height = 0;
  used.forEach((column, index) => {
    const group = (grouped.get(column) ?? []).sort((a, b) => a.label.localeCompare(b.label));
    group.forEach((node, row) => boxes.push({ id: node.id, kind: node.kind, label: node.label, column: index, x: 12 + index * (GRAPH_NODE_WIDTH + GRAPH_GAP_X), y: 12 + row * (GRAPH_NODE_HEIGHT + GRAPH_GAP_Y) }));
    height = Math.max(height, 12 + group.length * (GRAPH_NODE_HEIGHT + GRAPH_GAP_Y));
  });
  const box = new Map(boxes.map((item) => [item.id, item]));
  const links: GraphLink[] = [];
  for (const edge of edges) {
    const from = box.get(edge.from);
    const to = box.get(edge.to);
    if (!from || !to) continue;
    const y1 = from.y + GRAPH_NODE_HEIGHT / 2;
    const y2 = to.y + GRAPH_NODE_HEIGHT / 2;
    if (from.column < to.column) {
      const x1 = from.x + GRAPH_NODE_WIDTH;
      links.push({ ...edge, d: `M${x1},${y1} C${x1 + 60},${y1} ${to.x - 60},${y2} ${to.x},${y2}` });
    } else {
      // Same column or backwards: a loop on the right edge keeps the line off the boxes between.
      const x1 = from.x + GRAPH_NODE_WIDTH;
      const x2 = to.x + GRAPH_NODE_WIDTH;
      links.push({ ...edge, d: `M${x1},${y1} C${x1 + 70},${y1} ${x2 + 70},${y2} ${x2},${y2}` });
    }
  }
  return { width: 24 + used.length * GRAPH_NODE_WIDTH + Math.max(0, used.length - 1) * GRAPH_GAP_X, height: Math.max(height, 64), boxes, links };
}
