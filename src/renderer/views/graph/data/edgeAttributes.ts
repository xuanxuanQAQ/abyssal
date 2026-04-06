export type EdgeLayer =
  | 'citation'
  | 'conceptAgree'
  | 'conceptConflict'
  | 'conceptExtend'
  | 'semanticNeighbor'
  | 'conceptMapping'
  | 'notes';

export const EDGE_COLORS: Record<EdgeLayer, string> = {
  citation: '#9CA3AF',
  conceptAgree: '#22C55E',
  conceptConflict: '#EF4444',
  conceptExtend: '#F59E0B',
  semanticNeighbor: '#3B82F6',
  conceptMapping: '#8B5CF6',
  notes: '#14B8A6',
};

export const EDGE_OPACITIES: Record<EdgeLayer, number | ((weight: number) => number)> = {
  citation: 0.6,
  conceptAgree: 0.5,
  conceptConflict: 0.7,
  conceptExtend: 0.65,
  semanticNeighbor: (w: number) => w * 0.6,
  conceptMapping: 0.55,
  notes: 0.6,
};

export function computeEdgeColor(layer: EdgeLayer): string {
  return EDGE_COLORS[layer];
}

export function computeEdgeSize(layer: EdgeLayer, weight: number): number {
  switch (layer) {
    case 'citation':
      return 1;
    case 'conceptAgree':
      return 1.5 * weight;
    case 'conceptConflict':
      return 1.5 * weight;
    case 'conceptExtend':
      return 1.5 * weight;
    case 'semanticNeighbor':
      return 1;
    case 'conceptMapping':
      return 1.1;
    case 'notes':
      return 1.2;
  }
}

export function computeEdgeOpacity(layer: EdgeLayer, weight: number): number {
  const opacity = EDGE_OPACITIES[layer];
  if (typeof opacity === 'function') {
    return opacity(weight);
  }
  return opacity;
}

export const CURVATURE_STEP = 0.3;

export function assignCurvatures(
  edges: Array<{ source: string; target: string; id?: string }>,
): Map<string, number> {
  const groups = new Map<string, number[]>();

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]!;
    const sortedPair =
      edge.source < edge.target
        ? `${edge.source}\0${edge.target}`
        : `${edge.target}\0${edge.source}`;

    let group = groups.get(sortedPair);
    if (group === undefined) {
      group = [];
      groups.set(sortedPair, group);
    }
    group.push(i);
  }

  const result = new Map<string, number>();

  for (const indices of groups.values()) {
    const k = indices.length;
    for (let j = 0; j < k; j++) {
      const curvature = (j - (k - 1) / 2) * CURVATURE_STEP;
      const idx = indices[j]!;
      const edge = edges[idx]!;
      const key = edge.id ?? String(idx);
      result.set(key, curvature);
    }
  }

  return result;
}
