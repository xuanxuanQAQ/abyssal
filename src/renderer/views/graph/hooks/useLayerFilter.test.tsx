import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import Graph from 'graphology';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storeState = vi.hoisted(() => ({
  layerVisibility: {
    citation: true,
    conceptAgree: true,
    conceptConflict: true,
    conceptExtend: true,
    semanticNeighbor: true,
    notes: true,
  },
  similarityThreshold: 0.75,
  showConceptNodes: false,
  showNoteNodes: false,
  focusedGraphNodeId: 'concept-1',
}));

vi.mock('../../../core/store', () => ({
  useAppStore: (selector: (store: typeof storeState) => unknown) => selector(storeState),
}));

vi.mock('../canvas/sigmaGuard', () => ({
  safeSigmaRefresh: vi.fn(),
}));

import { useLayerFilter } from './useLayerFilter';

function LayerFilterHarness({ graph }: { graph: Graph }) {
  useLayerFilter(null, graph);
  return null;
}

describe('useLayerFilter', () => {
  let container: HTMLDivElement;
  let root: Root;
  let graph: Graph;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    graph = new Graph({ multi: true, type: 'directed', allowSelfLoops: false });
    graph.addNode('concept-1', { nodeType: 'concept' });
    graph.addNode('concept-2', { nodeType: 'concept' });
    graph.addNode('note__1', { nodeType: 'note' });
    graph.addNode('paper-1', { nodeType: 'paper' });
    graph.addNode('paper-2', { nodeType: 'paper' });
    graph.addEdgeWithKey('semantic-low', 'paper-1', 'paper-2', {
      layer: 'semanticNeighbor',
      weight: 0.3,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('keeps the focused concept visible while hiding unfocused concept and note nodes', () => {
    act(() => {
      root.render(<LayerFilterHarness graph={graph} />);
    });

    expect(graph.getNodeAttribute('concept-1', 'forceHidden')).toBe(false);
    expect(graph.getNodeAttribute('concept-2', 'forceHidden')).toBe(true);
    expect(graph.getNodeAttribute('note__1', 'forceHidden')).toBe(true);
    expect(graph.getEdgeAttribute('semantic-low', 'forceHidden')).toBe(true);
  });
});