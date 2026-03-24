import { useEffect, useRef } from 'react';
import type Sigma from 'sigma';
import type Graph from 'graphology';
import { safeSigmaRefresh } from '../canvas/sigmaGuard';

// ---------------------------------------------------------------------------
// useLOD -- Level-of-detail system (SS9.1)
// ---------------------------------------------------------------------------

/** LOD tiers keyed by camera-ratio thresholds. */
const enum LODTier {
  Close = 0,   // ratio < 0.3
  Medium = 1,  // 0.3 <= ratio <= 1.0
  Far = 2,     // ratio > 1.0
}

function tierFromRatio(ratio: number): LODTier {
  if (ratio < 0.3) return LODTier.Close;
  if (ratio <= 1.0) return LODTier.Medium;
  return LODTier.Far;
}

/** Throttle helper -- fires at most once per `ms`. */
function throttle<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: unknown[]) => {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  }) as unknown as T;
}

/**
 * Adjusts rendering fidelity based on the current camera zoom level.
 *
 * | Tier   | Ratio    | Behaviour                                          |
 * |--------|----------|----------------------------------------------------|
 * | Close  | < 0.3    | Full rendering, glow effects, label threshold = 8  |
 * | Medium | 0.3-1.0  | No glow, label threshold = 12                      |
 * | Far    | > 1.0    | Simplified nodes (2 px), thin edges (1 px), no labels |
 */
export function useLOD(
  sigma: Sigma | null,
  graph: Graph | null,
): void {
  const currentTierRef = useRef<LODTier | null>(null);

  useEffect(() => {
    if (!sigma || !graph) return;

    const applyLOD = throttle(() => {
      const ratio = sigma.getCamera().ratio;
      const tier = tierFromRatio(ratio);

      // Skip if tier hasn't changed
      if (tier === currentTierRef.current) return;
      currentTierRef.current = tier;

      switch (tier) {
        // ---------------------------------------------------------------
        // Close -- full fidelity
        // ---------------------------------------------------------------
        case LODTier.Close: {
          sigma.setSetting('labelRenderedSizeThreshold', 8);

          // Enable glow-eligible highlighting on all nodes
          graph.forEachNode((node) => {
            graph.setNodeAttribute(node, 'lodSimplified', false);
          });
          graph.forEachEdge((edge) => {
            graph.setEdgeAttribute(edge, 'lodSimplified', false);
          });
          break;
        }

        // ---------------------------------------------------------------
        // Medium -- disable glow, raise label threshold
        // ---------------------------------------------------------------
        case LODTier.Medium: {
          sigma.setSetting('labelRenderedSizeThreshold', 12);

          graph.forEachNode((node) => {
            graph.setNodeAttribute(node, 'lodSimplified', false);
          });
          graph.forEachEdge((edge) => {
            graph.setEdgeAttribute(edge, 'lodSimplified', false);
          });
          break;
        }

        // ---------------------------------------------------------------
        // Far -- maximally simplified
        // ---------------------------------------------------------------
        case LODTier.Far: {
          // Push threshold very high so no labels render
          sigma.setSetting('labelRenderedSizeThreshold', 9999);

          // Simplify node & edge sizes
          graph.forEachNode((node, attrs) => {
            if (!attrs.lodSimplified) {
              graph.setNodeAttribute(node, '_prevNodeSize', attrs.size);
              graph.setNodeAttribute(node, 'size', 2);
              graph.setNodeAttribute(node, 'lodSimplified', true);
            }
          });
          graph.forEachEdge((edge, attrs) => {
            if (!attrs.lodSimplified) {
              graph.setEdgeAttribute(edge, '_prevEdgeSize', attrs.size);
              graph.setEdgeAttribute(edge, 'size', 1);
              graph.setEdgeAttribute(edge, 'lodSimplified', true);
            }
          });
          break;
        }
      }

      safeSigmaRefresh(sigma);
    }, 50); // 50 ms throttle to avoid per-frame overhead

    // Listen to camera updates
    sigma.on('beforeRender', applyLOD);

    // Run once immediately so the initial tier is applied
    applyLOD();

    return () => {
      sigma.off('beforeRender', applyLOD);

      // Restore any simplified sizes on teardown
      if (currentTierRef.current === LODTier.Far) {
        graph.forEachNode((node) => {
          const prev = graph.getNodeAttribute(node, '_prevNodeSize') as number | undefined;
          if (prev !== undefined) {
            graph.setNodeAttribute(node, 'size', prev);
            graph.removeNodeAttribute(node, '_prevNodeSize');
          }
          graph.setNodeAttribute(node, 'lodSimplified', false);
        });
        graph.forEachEdge((edge) => {
          const prev = graph.getEdgeAttribute(edge, '_prevEdgeSize') as number | undefined;
          if (prev !== undefined) {
            graph.setEdgeAttribute(edge, 'size', prev);
            graph.removeEdgeAttribute(edge, '_prevEdgeSize');
          }
          graph.setEdgeAttribute(edge, 'lodSimplified', false);
        });
      }
      currentTierRef.current = null;
    };
  }, [sigma, graph]);
}

export default useLOD;
