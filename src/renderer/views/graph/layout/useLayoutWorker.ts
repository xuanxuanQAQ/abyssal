/**
 * Worker management hook (§4.3).
 */

import { useRef, useEffect, useCallback } from 'react';
import type Graph from 'graphology';
import { useAppStore } from '../../../core/store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NodeData {
  id: string;
  x: number;
  y: number;
  size: number;
}

interface EdgeData {
  source: string;
  target: string;
  weight: number;
}

export interface LayoutWorkerControls {
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  pinNode: (nodeId: string, x: number, y: number) => void;
  unpinNode: (nodeId: string) => void;
  addNodes: (nodes: NodeData[], edges: EdgeData[]) => void;
  isRunning: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLayoutWorker(
  graph: Graph | null,
  onPositionsUpdate: (positions: Float32Array, globalSpeed: number) => void,
): LayoutWorkerControls {
  const workerRef = useRef<Worker | null>(null);
  const isRunningRef = useRef(false);
  const isConvergedRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);
  const onPositionsUpdateRef = useRef(onPositionsUpdate);

  // Keep callback ref fresh without re-triggering effects
  onPositionsUpdateRef.current = onPositionsUpdate;

  // -------------------------------------------------------------------------
  // Worker lifecycle
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!graph) return;

    const worker = new Worker(
      new URL('./layoutWorker.ts', import.meta.url),
      { type: 'module' },
    );

    workerRef.current = worker;

    // Build init payload from graph
    const nodes: NodeData[] = [];
    graph.forEachNode((nodeId, attrs) => {
      nodes.push({
        id: nodeId,
        x: (attrs.x as number) ?? 0,
        y: (attrs.y as number) ?? 0,
        size: (attrs.size as number) ?? 1,
      });
    });

    const edges: EdgeData[] = [];
    graph.forEachEdge((_edgeId, attrs, source, target) => {
      edges.push({
        source,
        target,
        weight: (attrs.weight as number) ?? 1,
      });
    });

    worker.postMessage({ type: 'init', nodes, edges });

    // ----- Message handling ------------------------------------------------

    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data;

      switch (msg.type) {
        case 'positions': {
          const buffer: Float32Array = msg.buffer;
          const globalSpeed: number = msg.globalSpeed;

          // Schedule position update in a requestAnimationFrame
          if (rafIdRef.current !== null) {
            cancelAnimationFrame(rafIdRef.current);
          }
          rafIdRef.current = requestAnimationFrame(() => {
            onPositionsUpdateRef.current(buffer, globalSpeed);

            // [Δ-7] Return the buffer to the worker for reuse
            workerRef.current?.postMessage(
              { type: 'returnBuffer', buffer },
              [buffer.buffer],
            );
          });
          break;
        }

        case 'converged': {
          isRunningRef.current = false;
          isConvergedRef.current = true;
          useAppStore.getState().setLayoutPaused?.(true);
          break;
        }

        case 'error': {
          console.error('[LayoutWorker]', msg.message);
          break;
        }
      }
    };

    worker.onerror = (err) => {
      console.error('[LayoutWorker] Unhandled error:', err);
    };

    // ----- Cleanup ---------------------------------------------------------

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      worker.terminate();
      workerRef.current = null;
      isRunningRef.current = false;
    };
  }, [graph]);

  // -------------------------------------------------------------------------
  // [Δ-3] Subscribe to focusedGraphNodeId
  // -------------------------------------------------------------------------

  useEffect(() => {
    const unsubscribe = useAppStore.subscribe(
      (state) => state.focusedGraphNodeId,
      (focusedId, previousId) => {
        if (!workerRef.current) return;

        if (focusedId != null && previousId == null) {
          // A node just got focused — pause layout
          workerRef.current.postMessage({
            type: 'control',
            action: 'pause',
          });
        } else if (focusedId == null && previousId != null) {
          // Focus cleared — resume if not converged
          if (!isConvergedRef.current) {
            workerRef.current.postMessage({
              type: 'control',
              action: 'resume',
            });
          }
        }
      },
    );

    return unsubscribe;
  }, []);

  // -------------------------------------------------------------------------
  // Controls
  // -------------------------------------------------------------------------

  const start = useCallback(() => {
    workerRef.current?.postMessage({ type: 'control', action: 'start' });
    isRunningRef.current = true;
    isConvergedRef.current = false;
  }, []);

  const pause = useCallback(() => {
    workerRef.current?.postMessage({ type: 'control', action: 'pause' });
    isRunningRef.current = false;
  }, []);

  const resume = useCallback(() => {
    workerRef.current?.postMessage({ type: 'control', action: 'resume' });
    isRunningRef.current = true;
  }, []);

  const stop = useCallback(() => {
    workerRef.current?.postMessage({ type: 'control', action: 'stop' });
    isRunningRef.current = false;
  }, []);

  const pinNode = useCallback((nodeId: string, x: number, y: number) => {
    workerRef.current?.postMessage({ type: 'pinNode', nodeId, x, y });
  }, []);

  const unpinNode = useCallback((nodeId: string) => {
    workerRef.current?.postMessage({ type: 'unpinNode', nodeId });
  }, []);

  const addNodes = useCallback((nodes: NodeData[], edges: EdgeData[]) => {
    workerRef.current?.postMessage({
      type: 'addNodes',
      newNodes: nodes,
      newEdges: edges,
    });
  }, []);

  return {
    start,
    pause,
    resume,
    stop,
    pinNode,
    unpinNode,
    addNodes,
    isRunning: isRunningRef.current,
  };
}
