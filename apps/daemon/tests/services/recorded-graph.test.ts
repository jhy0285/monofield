import { describe, expect, it } from 'vitest';
import type { DocumentGraphEdge, DocumentGraphNode } from '@open-design/contracts';
import { RecordedDependencyGraph } from '../../src/services/ontology/recorded-graph.js';

const nodes = (...ids: string[]): DocumentGraphNode[] => ids.map(id => ({ id, label: id, kind: 'code' }));
const edge = (sourceId: string, dependentId: string, evidenceRef = 'recorded'): DocumentGraphEdge => ({ sourceId, dependentId, evidenceRef, documentFile: 'api.json' });

describe('Graphology recorded dependency index', () => {
  it('follows directed consumers through cycles, self loops and parallel evidence, leaving unrelated nodes out', () => {
    const snapshot = { nodes: nodes('service', 'controller', 'api', 'screen', 'unrelated'), edges: [
      edge('service', 'controller', 'call A'), edge('service', 'controller', 'call B'),
      edge('controller', 'api'), edge('api', 'screen'), edge('screen', 'controller'), edge('api', 'api'),
    ] };
    const original = JSON.stringify(snapshot), graph = new RecordedDependencyGraph(snapshot);
    expect([...graph.pathsFrom(['service'])]).toEqual([
      ['service', ['service']], ['controller', ['service', 'controller']],
      ['api', ['service', 'controller', 'api']], ['screen', ['service', 'controller', 'api', 'screen']],
    ]);
    expect([...graph.reachableFrom(['api'])]).not.toContain('service');
    expect(JSON.stringify(snapshot)).toBe(original);
  });
  it('chooses the nearest of multiple changed sources instead of the first source with a long path', () => {
    const graph = new RecordedDependencyGraph({ nodes: nodes('a', 'b', 'long', 'near', 'api', 'screen'),
      edges: [edge('a','long'), edge('long','near'), edge('near','api'), edge('b','api'), edge('api','screen')] });
    expect(graph.pathsFrom(['a','b','b']).get('screen')).toEqual(['b','api','screen']);
    expect(graph.pathsFrom(['api','a']).get('api')).toEqual(['api']);
    expect(graph.pathsFrom([]).size).toBe(0);
  });
  it('retains every reachable branch of a diamond but explains one shortest path', () => {
    const graph = new RecordedDependencyGraph({ nodes: nodes('source', 'left', 'right', 'screen'),
      edges: [edge('source','left'),edge('source','right'),edge('left','screen'),edge('right','screen')] });
    expect([...graph.reachableFrom(['source'])]).toEqual(['source','left','right','screen']);
    expect(graph.pathsFrom(['source']).get('screen')).toEqual(['source','left','screen']);
  });
  it('rejects broken snapshots and missing change seeds rather than claiming no impact', () => {
    expect(() => new RecordedDependencyGraph({nodes:nodes('a','a'),edges:[]})).toThrow('duplicate');
    expect(() => new RecordedDependencyGraph({nodes:nodes('a'),edges:[edge('a','missing')]})).toThrow('unresolved');
    const graph = new RecordedDependencyGraph({nodes:nodes('a'),edges:[]});
    expect(() => graph.pathsFrom(['missing'])).toThrow('absent');
    expect(() => graph.pathsFrom(['a'],0)).toThrow('0 affected');
    expect(() => new RecordedDependencyGraph({nodes:nodes(...Array.from({length:20001},(_,i)=>String(i))),edges:[]})).toThrow('20000');
  });
  it('bounds deep explanation memory and removes the virtual root even when traversal fails', () => {
    // Deliberately collides with the internal root name and a prototype property.
    const graph = new RecordedDependencyGraph({nodes:nodes('\0monofield:roots','__proto__','constructor','last'),
      edges:[edge('\0monofield:roots','__proto__'),edge('__proto__','constructor'),edge('constructor','last')]});
    expect(() => graph.pathsFrom(['\0monofield:roots'],2)).toThrow('2 affected');
    expect(() => graph.pathsFrom(['\0monofield:roots'],4,9)).toThrow('9 path');
    expect(graph.pathsFrom(['__proto__']).get('last')).toEqual(['__proto__','constructor','last']);
    expect(graph.reachableFrom(['last'])).toEqual(new Set(['last']));
  });
});
