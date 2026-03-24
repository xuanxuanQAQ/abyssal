import { useRef, useEffect, useCallback } from 'react';
import Sigma from 'sigma';
import type Graph from 'graphology';
import { useAppStore } from '../../../core/store';
import { safeSigmaRefresh } from './sigmaGuard';

// ---------------------------------------------------------------------------
// useSigmaInstance -- Sigma.js instance lifecycle (SS10.1, SS3.2, D-5)
// ---------------------------------------------------------------------------

/** Sigma settings aligned with SS3.2 visual spec. */
const SIGMA_SETTINGS = {
  renderEdgeLabels: false,
  labelFont: 'Inter, system-ui, sans-serif',
  labelSize: 12,
  labelWeight: '500' as const,
  labelRenderedSizeThreshold: 8,
  allowInvalidContainer: true,
  enableEdgeEvents: true,
  zIndex: true,
} as const;

/** Throttle helper -- returns a wrapped fn that fires at most once per `ms`. */
function throttle(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, ms);
  };
}

/**
 * Creates and manages a Sigma.js instance bound to the given container and
 * graphology graph. Handles WebGL context loss/restoration (D-5) and
 * container resize.
 *
 * @returns The current Sigma instance, or `null` when unavailable.
 */
export function useSigmaInstance(
  containerRef: React.RefObject<HTMLDivElement | null>,
  graph: Graph | null,
): Sigma | null {
  const sigmaRef = useRef<Sigma | null>(null);

  // We keep a stable ref to the graph so the context-restored handler can
  // re-create the instance with the same data.
  const graphRef = useRef<Graph | null>(graph);
  graphRef.current = graph;

  const setGraphContextStatus = useAppStore((s) => s.setGraphContextStatus);
  const setLayoutPaused = useAppStore((s) => s.setLayoutPaused);

  // -----------------------------------------------------------------------
  // Sigma factory -- extracted so context-restored can reuse it.
  // -----------------------------------------------------------------------
  const createSigma = useCallback(
    (container: HTMLDivElement, g: Graph): Sigma => {
      const instance = new Sigma(g, container, {
        ...SIGMA_SETTINGS,

        // Node reducer -- merge `hidden || forceHidden` into final hidden
        nodeReducer(node, attrs) {
          return {
            ...attrs,
            hidden: !!(attrs.hidden || attrs.forceHidden),
          };
        },

        // Edge reducer -- same logic
        edgeReducer(_edge, attrs) {
          return {
            ...attrs,
            hidden: !!(attrs.hidden || attrs.forceHidden),
          };
        },
      });

      return instance;
    },
    [],
  );

  // -----------------------------------------------------------------------
  // Main effect -- create / tear-down Sigma
  // -----------------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !graph) return;

    // --- Create Sigma ---------------------------------------------------
    const sigma = createSigma(container, graph);
    sigmaRef.current = sigma;

    // --- WebGL context-loss handling (D-5) --------------------------------
    // Sigma renders into a <canvas> it appends to the container.  We grab
    // the first canvas child to attach context listeners.
    const canvas = container.querySelector('canvas');

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setGraphContextStatus('lost');
      setLayoutPaused(true);
    };

    const onContextRestored = () => {
      setGraphContextStatus('restoring');

      // Kill the old (broken) instance
      try {
        sigmaRef.current?.kill();
      } catch {
        // May already be dead -- ignore
      }

      const currentGraph = graphRef.current;
      if (container && currentGraph) {
        const newSigma = createSigma(container, currentGraph);
        sigmaRef.current = newSigma;
      }

      setGraphContextStatus('ready');
    };

    if (canvas) {
      canvas.addEventListener('webglcontextlost', onContextLost);
      canvas.addEventListener('webglcontextrestored', onContextRestored);
    }

    // --- Resize observer -------------------------------------------------
    const handleResize = throttle(() => {
      safeSigmaRefresh(sigmaRef.current);
    }, 100);

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    // --- Cleanup ---------------------------------------------------------
    return () => {
      resizeObserver.disconnect();

      if (canvas) {
        canvas.removeEventListener('webglcontextlost', onContextLost);
        canvas.removeEventListener('webglcontextrestored', onContextRestored);
      }

      try {
        sigmaRef.current?.kill();
      } catch {
        // Ignore errors during teardown
      }
      sigmaRef.current = null;
    };
  }, [containerRef, graph, createSigma, setGraphContextStatus, setLayoutPaused]);

  return sigmaRef.current;
}

export default useSigmaInstance;
