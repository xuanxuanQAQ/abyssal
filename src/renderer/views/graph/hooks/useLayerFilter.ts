import { useEffect } from 'react';
import type Sigma from 'sigma';
import type Graph from 'graphology';
import type { LayerVisibility } from '../../../../shared-types/models';
import { useAppStore } from '../../../core/store';
import { safeSigmaRefresh } from '../canvas/sigmaGuard';

// ---------------------------------------------------------------------------
// useLayerFilter -- [D-3] Layer filtering logic (SS5.3)
// ---------------------------------------------------------------------------

/**
 * Applies layer-visibility, similarity-threshold, and concept-node filters
 * to the graph by toggling the `forceHidden` attribute on edges and nodes.
 *
 * **Important (D-3):** This hook never touches the `hidden` attribute, which
 * is owned by the layout layer. Only `forceHidden` is modified, keeping
 * layout and visual filtering cleanly separated.
 */
export function useLayerFilter(
  sigma: Sigma | null,
  graph: Graph | null,
): void {
  const layerVisibility = useAppStore((s) => s.layerVisibility);
  const similarityThreshold = useAppStore((s) => s.similarityThreshold);
  const showConceptNodes = useAppStore((s) => s.showConceptNodes);
  const showNoteNodes = useAppStore((s) => s.showNoteNodes);
  const focusedGraphNodeId = useAppStore((s) => s.focusedGraphNodeId);

  useEffect(() => {
    if (!graph) return;

    // -------------------------------------------------------------------
    // Edge filtering
    // -------------------------------------------------------------------
    graph.forEachEdge((_edge, attrs, _source, _target, _sa, _ta, undirected) => {
      const layer = (attrs.layer ?? attrs.edgeType) as string | undefined;
      const weight = (attrs.weight ?? 1) as number;

      let shouldHide = false;

      // Hide edges whose layer is not currently visible
      if (layer !== undefined && layerVisibility[layer as keyof LayerVisibility] === false) {
        shouldHide = true;
      }

      // Hide semanticNeighbor edges below the similarity threshold
      // (layer name matches EdgeLayer type: 'semanticNeighbor', not snake_case)
      if (layer === 'semanticNeighbor' && weight < similarityThreshold) {
        shouldHide = true;
      }

      graph.setEdgeAttribute(_edge, 'forceHidden', shouldHide);
    });

    // -------------------------------------------------------------------
    // Node filtering -- concept nodes
    // -------------------------------------------------------------------
    graph.forEachNode((node, attrs) => {
      const nodeType = (attrs.nodeType ?? attrs.type) as string | undefined;

      if (nodeType === 'concept' && !showConceptNodes && node !== focusedGraphNodeId) {
        graph.setNodeAttribute(node, 'forceHidden', true);
      } else if (nodeType === 'concept') {
        graph.setNodeAttribute(node, 'forceHidden', false);
      }

      if ((nodeType === 'memo' || nodeType === 'note') && !showNoteNodes && node !== focusedGraphNodeId) {
        graph.setNodeAttribute(node, 'forceHidden', true);
      } else if (nodeType === 'memo' || nodeType === 'note') {
        graph.setNodeAttribute(node, 'forceHidden', false);
      }
    });

    // -------------------------------------------------------------------
    // Refresh rendering (guard against lost WebGL context)
    // -------------------------------------------------------------------
    safeSigmaRefresh(sigma);
  }, [sigma, graph, layerVisibility, similarityThreshold, showConceptNodes, showNoteNodes, focusedGraphNodeId]);
}

export default useLayerFilter;
