import { useEffect, useCallback } from 'react';
import type Sigma from 'sigma';
import type Graph from 'graphology';
import { useAppStore } from '../../../core/store';
import { safeSigmaRefresh } from './sigmaGuard';

// ---------------------------------------------------------------------------
// useSigmaEvents -- Node/edge interaction events (SS7.1, SS7.2)
// ---------------------------------------------------------------------------

export interface SigmaEventCallbacks {
  onNodeRightClick: (nodeId: string, nodeType: 'paper' | 'concept' | 'memo' | 'note', position: { x: number; y: number }) => void;
  onEdgeHover: (edgeId: string | null, position: { x: number; y: number } | null) => void;
}

/**
 * Wires up all Sigma mouse/touch interaction events.
 *
 * - `enterNode` / `leaveNode` -- highlight node & connected edges, update
 *   ContextPanel peek via store.
 * - `clickNode` -- focus the node via `focusGraphNode`.
 * - `rightClickNode` -- delegate to `callbacks.onNodeRightClick`.
 * - `enterEdge` / `leaveEdge` -- delegate to `callbacks.onEdgeHover`.
 * - `clickEdge` -- if concept_agree / conflict, navigate to mapping evidence.
 */
export function useSigmaEvents(
  sigma: Sigma | null,
  graph: Graph | null,
  callbacks: SigmaEventCallbacks,
): void {
  const focusGraphNode = useAppStore((s) => s.focusGraphNode);

  const resolveNodeType = useCallback(
    (nodeId: string): 'paper' | 'concept' | 'memo' | 'note' => {
      const rawType = graph?.getNodeAttribute(nodeId, 'nodeType') as
        | 'paper'
        | 'concept'
        | 'memo'
        | 'note'
        | undefined;
      return rawType ?? 'paper';
    },
    [graph],
  );

  // -----------------------------------------------------------------------
  // Highlight helpers
  // -----------------------------------------------------------------------

  const highlightNode = useCallback(
    (nodeId: string) => {
      if (!graph) return;

      // Mark the node itself
      graph.setNodeAttribute(nodeId, 'highlighted', true);

      // Highlight connected edges -- boost opacity & size
      graph.forEachEdge(nodeId, (edge, attrs) => {
        graph.setEdgeAttribute(edge, '_prevSize', attrs.size);
        graph.setEdgeAttribute(edge, '_prevOpacity', attrs.opacity);
        graph.setEdgeAttribute(edge, 'size', (attrs.size ?? 1) * 1.8);
        graph.setEdgeAttribute(edge, 'opacity', 1);
      });
    },
    [graph],
  );

  const unhighlightNode = useCallback(
    (nodeId: string) => {
      if (!graph) return;

      graph.setNodeAttribute(nodeId, 'highlighted', false);

      // Restore edge styles
      graph.forEachEdge(nodeId, (edge) => {
        const prevSize = graph.getEdgeAttribute(edge, '_prevSize') as number | undefined;
        const prevOpacity = graph.getEdgeAttribute(edge, '_prevOpacity') as number | undefined;
        if (prevSize !== undefined) {
          graph.setEdgeAttribute(edge, 'size', prevSize);
          graph.removeEdgeAttribute(edge, '_prevSize');
        }
        if (prevOpacity !== undefined) {
          graph.setEdgeAttribute(edge, 'opacity', prevOpacity);
          graph.removeEdgeAttribute(edge, '_prevOpacity');
        }
      });
    },
    [graph],
  );

  // -----------------------------------------------------------------------
  // Event wiring
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!sigma || !graph) return;

    // -- enterNode --------------------------------------------------------
    const onEnterNode = ({ node }: { node: string }) => {
      highlightNode(node);
      safeSigmaRefresh(sigma);
    };

    // -- leaveNode --------------------------------------------------------
    const onLeaveNode = ({ node }: { node: string }) => {
      unhighlightNode(node);
      safeSigmaRefresh(sigma);
    };

    // -- clickNode --------------------------------------------------------
    const onClickNode = ({ node }: { node: string }) => {
      focusGraphNode(node, resolveNodeType(node));
    };

    // -- rightClickNode ---------------------------------------------------
    const onRightClickNode = ({
      node,
      event,
    }: {
      node: string;
      event: { x: number; y: number; original: MouseEvent | TouchEvent };
    }) => {
      event.original.preventDefault();
      callbacks.onNodeRightClick(node, resolveNodeType(node), { x: event.x, y: event.y });
    };

    // -- enterEdge --------------------------------------------------------
    const onEnterEdge = ({
      edge,
      event,
    }: {
      edge: string;
      event: { x: number; y: number };
    }) => {
      callbacks.onEdgeHover(edge, { x: event.x, y: event.y });
    };

    // -- leaveEdge --------------------------------------------------------
    const onLeaveEdge = () => {
      callbacks.onEdgeHover(null, null);
    };

    // -- clickEdge --------------------------------------------------------
    const onClickEdge = ({ edge }: { edge: string }) => {
      const edgeType = graph.getEdgeAttribute(edge, 'edgeType') as string | undefined;
      if (edgeType === 'conceptAgree' || edgeType === 'conceptConflict') {
        // TODO: ContextPanel integration -- navigate to mapping evidence
      }
    };

    // -- Register ---------------------------------------------------------
    sigma.on('enterNode', onEnterNode);
    sigma.on('leaveNode', onLeaveNode);
    sigma.on('clickNode', onClickNode);
    sigma.on('rightClickNode', onRightClickNode);
    sigma.on('enterEdge', onEnterEdge);
    sigma.on('leaveEdge', onLeaveEdge);
    sigma.on('clickEdge', onClickEdge);

    // -- Cleanup ----------------------------------------------------------
    return () => {
      sigma.off('enterNode', onEnterNode);
      sigma.off('leaveNode', onLeaveNode);
      sigma.off('clickNode', onClickNode);
      sigma.off('rightClickNode', onRightClickNode);
      sigma.off('enterEdge', onEnterEdge);
      sigma.off('leaveEdge', onLeaveEdge);
      sigma.off('clickEdge', onClickEdge);
    };
  }, [sigma, graph, highlightNode, unhighlightNode, focusGraphNode, callbacks, resolveNodeType]);
}

export default useSigmaEvents;
