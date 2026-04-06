import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import Graph from 'graphology';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const focusGraphNode = vi.fn();

vi.mock('../../../core/store', () => ({
  useAppStore: (selector: (store: { focusGraphNode: typeof focusGraphNode }) => unknown) => selector({
    focusGraphNode,
  }),
}));

vi.mock('./sigmaGuard', () => ({
  safeSigmaRefresh: vi.fn(),
}));

import { useSigmaEvents, type SigmaEventCallbacks } from './useSigmaEvents';

class FakeSigma {
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();

  on(event: string, handler: (payload: unknown) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)?.add(handler);
  }

  off(event: string, handler: (payload: unknown) => void): void {
    this.listeners.get(event)?.delete(handler);
  }

  emit(event: string, payload: unknown): void {
    for (const handler of this.listeners.get(event) ?? []) {
      handler(payload);
    }
  }
}

function SigmaEventsHarness({
  sigma,
  graph,
  callbacks,
}: {
  sigma: FakeSigma;
  graph: Graph;
  callbacks: SigmaEventCallbacks;
}) {
  useSigmaEvents(sigma as never, graph, callbacks);
  return null;
}

describe('useSigmaEvents', () => {
  let container: HTMLDivElement;
  let root: Root;
  let sigma: FakeSigma;
  let graph: Graph;
  const callbacks = {
    onNodeRightClick: vi.fn(),
    onEdgeHover: vi.fn(),
  };

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    focusGraphNode.mockReset();
    callbacks.onNodeRightClick.mockReset();
    callbacks.onEdgeHover.mockReset();
    sigma = new FakeSigma();
    graph = new Graph({ multi: true, type: 'directed', allowSelfLoops: false });
    graph.addNode('memo__1', { nodeType: 'memo' });
    graph.addNode('paper-1', { nodeType: 'paper' });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root.render(<SigmaEventsHarness sigma={sigma} graph={graph} callbacks={callbacks} />);
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('propagates graph node type through click and context-menu events', () => {
    const preventDefault = vi.fn();

    act(() => {
      sigma.emit('clickNode', { node: 'memo__1' });
      sigma.emit('rightClickNode', {
        node: 'memo__1',
        event: { x: 12, y: 24, original: { preventDefault } },
      });
    });

    expect(focusGraphNode).toHaveBeenCalledWith('memo__1', 'memo');
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(callbacks.onNodeRightClick).toHaveBeenCalledWith('memo__1', 'memo', { x: 12, y: 24 });
  });
});