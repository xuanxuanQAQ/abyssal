import Graph from 'graphology';
import { describe, expect, it } from 'vitest';
import { synchronizeGraph } from './graphSynchronizer';

describe('graphSynchronizer', () => {
  it('writes compatible node and edge attributes for mixed graph data', () => {
    const graph = new Graph({ multi: true, type: 'directed', allowSelfLoops: false });

    synchronizeGraph(graph, {
      nodes: [
        {
          id: 'paper-1',
          type: 'paper',
          label: 'Paper One',
          metadata: { entityId: 'paper-1' },
        },
        {
          id: 'concept-1',
          type: 'concept',
          label: 'Concept One',
          level: 2,
        },
        {
          id: 'note__note-1',
          type: 'note',
          label: 'Note One',
          metadata: { entityId: 'note-1' },
        },
      ],
      edges: [
        {
          id: 'mapping-1',
          source: 'paper-1',
          target: 'concept-1',
          type: 'conceptMapping',
          weight: 1,
          conceptId: 'concept-1',
        },
        {
          id: 'note-edge-1',
          source: 'note__note-1',
          target: 'paper-1',
          type: 'notes',
          weight: 1,
        },
      ],
    });

    expect(graph.getNodeAttribute('note__note-1', 'type')).toBe('circle');
    expect(graph.getNodeAttribute('note__note-1', 'nodeType')).toBe('note');
    expect(graph.getNodeAttribute('note__note-1', 'entityId')).toBe('note-1');
    expect(graph.getNodeAttribute('concept-1', 'conceptLevel')).toBe(2);

    expect(graph.getEdgeAttribute('mapping-1', 'layer')).toBe('conceptMapping');
    expect(graph.getEdgeAttribute('mapping-1', 'edgeType')).toBe('conceptMapping');
    expect(graph.getEdgeAttribute('mapping-1', 'conceptId')).toBe('concept-1');
    expect(graph.getEdgeAttribute('note-edge-1', 'layer')).toBe('notes');
    expect(graph.getEdgeAttribute('note-edge-1', 'edgeType')).toBe('notes');
  });
});