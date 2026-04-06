import { useEffect, useRef, useCallback } from 'react';
import type Sigma from 'sigma';
import type Graph from 'graphology';
import { useAppStore } from '../../../core/store';

function useGraphKeyboardNav(
  sigma: Sigma | null,
  graph: Graph | null,
  containerRef: React.RefObject<HTMLDivElement | null>,
): void {
  const neighborIndexRef = useRef(0);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!graph) return;

      const { focusGraphNode, focusedGraphNodeId: focusedNodeId } = useAppStore.getState();

      switch (e.key) {
        case 'Escape': {
          focusGraphNode(null);
          neighborIndexRef.current = 0;
          break;
        }

        case 'ArrowUp':
        case 'ArrowDown': {
          if (!focusedNodeId || !graph.hasNode(focusedNodeId)) return;

          e.preventDefault();

          const neighbors = graph.neighbors(focusedNodeId);
          if (neighbors.length === 0) return;

          // Sort neighbors for consistent ordering
          neighbors.sort();

          if (e.key === 'ArrowDown') {
            neighborIndexRef.current = (neighborIndexRef.current + 1) % neighbors.length;
          } else {
            neighborIndexRef.current =
              (neighborIndexRef.current - 1 + neighbors.length) % neighbors.length;
          }

          const nextNodeId = neighbors[neighborIndexRef.current];
          if (nextNodeId !== undefined) {
            const nextAttrs = graph.getNodeAttributes(nextNodeId) as Record<string, unknown>;
            focusGraphNode(nextNodeId, (nextAttrs.type as 'paper' | 'concept' | 'memo' | 'note') ?? 'paper');
          }
          break;
        }

        case 'ArrowLeft':
        case 'ArrowRight': {
          if (!focusedNodeId || !graph.hasNode(focusedNodeId)) return;

          e.preventDefault();

          const neighborsLR = graph.neighbors(focusedNodeId);
          if (neighborsLR.length === 0) return;

          neighborsLR.sort();

          if (e.key === 'ArrowRight') {
            neighborIndexRef.current = (neighborIndexRef.current + 1) % neighborsLR.length;
          } else {
            neighborIndexRef.current =
              (neighborIndexRef.current - 1 + neighborsLR.length) % neighborsLR.length;
          }

          const nextId = neighborsLR[neighborIndexRef.current];
          if (nextId !== undefined) {
            const nextAttrs = graph.getNodeAttributes(nextId) as Record<string, unknown>;
            focusGraphNode(nextId, (nextAttrs.type as 'paper' | 'concept' | 'memo' | 'note') ?? 'paper');
          }
          break;
        }

        case 'Enter': {
          if (!focusedNodeId) return;
          e.preventDefault();

          // Confirm selection: navigate to the focused node
          const navigateTo = useAppStore.getState().navigateTo;
          const nodeAttrs = graph.hasNode(focusedNodeId)
            ? graph.getNodeAttributes(focusedNodeId)
            : null;
          if (nodeAttrs && nodeAttrs.type === 'paper') {
            navigateTo({ type: 'paper', id: focusedNodeId, view: 'library' });
          }
          break;
        }

        default:
          break;
      }
    },
    [graph],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('keydown', handleKeyDown);
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
    };
  }, [containerRef, handleKeyDown]);

  // Reset neighbor index when focused node changes
  useEffect(() => {
    const unsubscribe = useAppStore.subscribe((state, prevState) => {
      const curr = state.focusedGraphNodeId;
      const prev = prevState.focusedGraphNodeId;
      if (curr !== prev) {
        neighborIndexRef.current = 0;
      }
    });
    return unsubscribe;
  }, []);
}

export { useGraphKeyboardNav };
