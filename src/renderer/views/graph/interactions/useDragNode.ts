import { useRef, useEffect, useCallback, useState } from 'react';
import type Sigma from 'sigma';
import type Graph from 'graphology';
import { safeSigmaRefresh } from '../canvas/sigmaGuard';

interface DragState {
  pinnedNodes: Set<string>;
}

function useDragNode(
  sigma: Sigma | null,
  graph: Graph | null,
  onPinNode: (nodeId: string, x: number, y: number) => void,
  onUnpinNode: (nodeId: string) => void,
): DragState {
  const isDraggingRef = useRef(false);
  const draggedNodeRef = useRef<string | null>(null);
  const [pinnedNodes, setPinnedNodes] = useState<Set<string>>(new Set());
  const pinnedNodesRef = useRef<Set<string>>(pinnedNodes);

  // Keep ref in sync with state
  useEffect(() => {
    pinnedNodesRef.current = pinnedNodes;
  }, [pinnedNodes]);

  const handleDownNode = useCallback(
    (event: { node: string }) => {
      if (!sigma) return;
      isDraggingRef.current = true;
      draggedNodeRef.current = event.node;

      // Disable camera dragging while dragging a node
      const camera = sigma.getCamera();
      camera.disable();
    },
    [sigma],
  );

  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      if (!isDraggingRef.current || !draggedNodeRef.current || !sigma || !graph) return;

      const container = sigma.getContainer();
      const rect = container.getBoundingClientRect();

      // Convert viewport coordinates to graph coordinates
      const viewportPos = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      const graphPos = sigma.viewportToGraph(viewportPos);

      // Update node position in graph
      graph.setNodeAttribute(draggedNodeRef.current, 'x', graphPos.x);
      graph.setNodeAttribute(draggedNodeRef.current, 'y', graphPos.y);

      // Mark as pinned
      onPinNode(draggedNodeRef.current, graphPos.x, graphPos.y);

      // Refresh rendering
      safeSigmaRefresh(sigma);
    },
    [sigma, graph, onPinNode],
  );

  const handleMouseUp = useCallback(() => {
    if (!sigma) return;

    if (isDraggingRef.current && draggedNodeRef.current) {
      // Add to pinned set
      setPinnedNodes((prev) => {
        const next = new Set(prev);
        next.add(draggedNodeRef.current!);
        return next;
      });
    }

    isDraggingRef.current = false;
    draggedNodeRef.current = null;

    // Re-enable camera dragging
    const camera = sigma.getCamera();
    camera.enable();
  }, [sigma]);

  const handleDoubleClickNode = useCallback(
    (event: { node: string; preventSigmaDefault: () => void }) => {
      event.preventSigmaDefault();

      const nodeId = event.node;

      // Unpin the node
      setPinnedNodes((prev) => {
        const next = new Set(prev);
        next.delete(nodeId);
        return next;
      });

      onUnpinNode(nodeId);
    },
    [onUnpinNode],
  );

  useEffect(() => {
    if (!sigma || !graph) return;

    sigma.on('downNode', handleDownNode);
    sigma.on('doubleClickNode', handleDoubleClickNode);

    const container = sigma.getContainer();
    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mouseup', handleMouseUp);

    return () => {
      sigma.off('downNode', handleDownNode);
      sigma.off('doubleClickNode', handleDoubleClickNode);

      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mouseup', handleMouseUp);
    };
  }, [sigma, graph, handleDownNode, handleMouseMove, handleMouseUp, handleDoubleClickNode]);

  return { pinnedNodes };
}

export { useDragNode };
export type { DragState };
