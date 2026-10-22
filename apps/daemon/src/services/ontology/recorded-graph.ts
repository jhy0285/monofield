import { MultiDirectedGraph } from 'graphology';
import { bfsFromNode } from 'graphology-traversal/bfs.js';
import type { DocumentGraphNode, DocumentGraphEdge } from '@open-design/contracts';

type Snapshot = { nodes: DocumentGraphNode[]; edges: DocumentGraphEdge[] };
// Graphology's adjacency objects must not receive bare JS prototype keys.
// Prefixing is injective, and leaves user IDs unchanged in every result.
const keyOf = (id: string) => `n:${id}`;

/** A bounded local index of recorded evidence, not an inference engine or database.
 * Edges point from a source to its consumers. Parallel evidence stays distinct.
 */
export class RecordedDependencyGraph {
  private readonly graph = new MultiDirectedGraph<
    { value: DocumentGraphNode | null }, { value: DocumentGraphEdge | null }
  >();

  constructor(snapshot: Snapshot) {
    if (snapshot.nodes.length > 20000 || snapshot.edges.length > 50000)
      throw new Error('Recorded graph exceeds 20000 nodes or 50000 edges; select a smaller module');
    for (const node of snapshot.nodes) {
      if (this.graph.hasNode(keyOf(node.id))) throw new Error('Recorded graph contains a duplicate node ID');
      this.graph.addNode(keyOf(node.id), { value: node });
    }
    for (const edge of snapshot.edges) {
      if (!this.graph.hasNode(keyOf(edge.sourceId)) || !this.graph.hasNode(keyOf(edge.dependentId)))
        throw new Error('Recorded graph has an unresolved edge endpoint; rebuild its source evidence');
      this.graph.addDirectedEdge(keyOf(edge.sourceId), keyOf(edge.dependentId), { value: edge });
    }
  }

  /** One multi-source BFS; the synthetic root never leaves this private index. */
  private parentsFrom(seeds: Iterable<string>, maxVisited: number) {
    const parents = new Map<string, string | null>();
    for (const id of seeds) {
      if (!this.graph.hasNode(keyOf(id))) throw new Error('Recorded change seed is absent from the graph; rebuild its source evidence');
      parents.set(id, null);
    }
    const bound = () => {
      if (parents.size > maxVisited) throw new Error(`Graph traversal exceeds ${maxVisited} affected nodes; select a smaller module`);
    };
    bound();
    if (!parents.size) return parents;
    let root = '\0monofield:roots';
    while (this.graph.hasNode(root)) root += ':';
    this.graph.addNode(root, { value: null });
    try {
      for (const seed of parents.keys()) this.graph.addDirectedEdge(root, keyOf(seed), { value: null });
      bfsFromNode(this.graph, root, (key, attributes) => {
        if (key === root) return;
        const id = attributes.value!.id;
        this.graph.forEachOutboundNeighbor(key, (_key, targetAttributes) => {
          const target = targetAttributes.value!.id;
          if (parents.has(target)) return;
          parents.set(target, id);
          bound();
        });
      }, { mode: 'outbound' });
      return parents;
    } finally {
      this.graph.dropNode(root);
    }
  }

  reachableFrom(seeds: Iterable<string>): Set<string> {
    return new Set(this.parentsFrom(seeds, 20000).keys());
  }

  /** Shortest recorded paths, with a separate bound on total explanation size. */
  pathsFrom(seeds: Iterable<string>, maxVisited = 20000, maxPathEntries = 100000): Map<string, string[]> {
    const parents = this.parentsFrom(seeds, maxVisited);
    const paths = new Map<string, string[]>();
    let entries = 0;
    for (const [id, parent] of parents) {
      const length = parent === null ? 1 : paths.get(parent)!.length + 1;
      entries += length;
      if (entries > maxPathEntries)
        throw new Error(`Graph explanations exceed ${maxPathEntries} path entries; select a smaller module`);
      paths.set(id, parent === null ? [id] : [...paths.get(parent)!, id]);
    }
    return paths;
  }
}
