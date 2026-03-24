import { useEffect, useRef } from 'react';
import type Sigma from 'sigma';
import type Graph from 'graphology';
import { useAppStore } from '../../../core/store';
import { computeFocusNeighborhood, applyFocusVisuals } from '../data/focusNeighborhood';
import { safeSigmaRefresh } from '../canvas/sigmaGuard';
import type { LayoutWorkerControls } from '../layout/useLayoutWorker';

// ---------------------------------------------------------------------------
// useFocusMode -- [D-3] Focus mode orchestration (SS6.1)
// ---------------------------------------------------------------------------

/**
 * Orchestrates focus mode: when a node is focused, compute its BFS
 * neighbourhood, apply dim/highlight visuals, pause the layout, and animate
 * the camera to the focal node.
 *
 * When focus is cleared the visuals are reset and the layout resumed (unless
 * it had already converged).
 */
export function useFocusMode(
  sigma: Sigma | null,
  graph: Graph | null,
  layoutControls: LayoutWorkerControls | null,
): void {
  const focusedGraphNodeId = useAppStore((s) => s.focusedGraphNodeId);
  const focusDepth = useAppStore((s) => s.focusDepth);

  // Track previous focused node so we can detect transitions.
  const prevFocusRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sigma || !graph) return;

    const prevFocus = prevFocusRef.current;
    prevFocusRef.current = focusedGraphNodeId;

    // -----------------------------------------------------------------
    // Entering focus mode
    // -----------------------------------------------------------------
    if (focusedGraphNodeId !== null) {
      // 1. Compute BFS neighbourhood
      const neighborhood = computeFocusNeighborhood(graph, focusedGraphNodeId, focusDepth);

      // 2. Apply dim / highlight visuals
      applyFocusVisuals(graph, neighborhood);

      // 3. [D-3] Pause layout while focused
      layoutControls?.pause();

      // 4. Camera animation to focal node
      const nodeAttrs = graph.getNodeAttributes(focusedGraphNodeId);
      const x = (nodeAttrs.x ?? 0) as number;
      const y = (nodeAttrs.y ?? 0) as number;

      sigma.getCamera().animate(
        { x, y, ratio: 0.15 },
        { duration: 500 },
      );

      // 5. Refresh rendering
      safeSigmaRefresh(sigma);
      return;
    }

    // -----------------------------------------------------------------
    // Leaving focus mode (focusedGraphNodeId became null)
    // -----------------------------------------------------------------
    if (prevFocus !== null && focusedGraphNodeId === null) {
      // 1. Reset visuals
      applyFocusVisuals(graph, null);

      // 2. [D-3] Resume layout if it hasn't converged
      layoutControls?.resume();

      // 3. Refresh rendering
      safeSigmaRefresh(sigma);
    }
  }, [sigma, graph, layoutControls, focusedGraphNodeId, focusDepth]);
}

export default useFocusMode;
