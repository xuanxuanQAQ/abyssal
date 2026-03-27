/**
 * NoteNodeProgram — Note/memo node rendering configuration.
 *
 * Since Sigma.js v3's custom WebGL NodeProgram API requires complex shader
 * authoring (GLSL vertex/fragment programs), we use Sigma's built-in circle
 * program with distinctive visual parameters as a pragmatic fallback.
 *
 * The node is differentiated by:
 * - Purple color (#a78bfa for memos, #7c3aed for notes)
 * - Smaller size (6-8px for memos, 10-12px for notes)
 * - Reduced opacity (60-80%)
 *
 * When Sigma renders these nodes, GraphCanvas applies the visual params
 * from getNodeAttributes() using the constants exported here.
 *
 * See spec: section 2.4, 2.9
 */

// ─── Layout parameters (satellite clustering) ───

/** Satellite clustering — pulls memo/note nodes close to their linked entities */
export const NOTE_LAYOUT_PARAMS = {
  /** Edge weight for memo↔entity links (high = strong attraction) */
  edgeWeight: 5.0,
  /** Spring length ratio — 40% of normal distance */
  springLengthRatio: 0.4,
  /** Repulsion ratio — 20% of normal repulsion */
  repulsionRatio: 0.2,
} as const;

// ─── Visual parameters ───

/** Memo node: small purple circle */
export const MEMO_NODE_VISUAL = {
  color: '#a78bfa',
  size: 6,
  opacity: 0.6,
  /** Label hidden by default — shown only on hover */
  showLabel: false,
  /** Sigma node type — uses built-in circle program */
  sigmaType: 'circle' as const,
} as const;

/** Research note node: larger purple circle */
export const NOTE_NODE_VISUAL = {
  color: '#7c3aed',
  size: 10,
  opacity: 0.8,
  showLabel: true,
  sigmaType: 'circle' as const,
} as const;

/** Edge from memo/note → paper or concept */
export const NOTE_EDGE_STYLE = {
  color: '#a78bfa',
  size: 1,
  /** Sigma edge type — dotted lines via built-in program or custom */
  sigmaType: 'line' as const,
} as const;

// ─── Node attribute resolver ───

/**
 * Resolve Sigma node attributes for a memo or note graph node.
 * Called from graphSynchronizer or getNodeAttributes.
 */
export function getNoteNodeAttributes(nodeType: 'memo' | 'note'): {
  color: string;
  size: number;
  type: string;
  label: string;
  forceLabel: boolean;
} {
  const visual = nodeType === 'memo' ? MEMO_NODE_VISUAL : NOTE_NODE_VISUAL;
  return {
    color: visual.color,
    size: visual.size,
    type: visual.sigmaType,
    label: '', // Labels set per-node from memo text or note title
    forceLabel: visual.showLabel,
  };
}

/**
 * Resolve Sigma edge attributes for a note↔entity link.
 */
export function getNoteEdgeAttributes(): {
  color: string;
  size: number;
  type: string;
} {
  return {
    color: NOTE_EDGE_STYLE.color,
    size: NOTE_EDGE_STYLE.size,
    type: NOTE_EDGE_STYLE.sigmaType,
  };
}
