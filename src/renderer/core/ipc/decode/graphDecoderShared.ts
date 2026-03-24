/**
 * 图数据二进制解码 — 共享逻辑
 *
 * 由主线程 graphDecoder.ts 和 Worker graphDecoder.worker.ts 共同引用，
 * 消除重复代码。
 *
 * 二进制编码格式（每条边 13 字节）：
 * - 2 × uint32 node_id (source, target)
 * - 1 × float32 weight
 * - 1 × uint8 edge_type
 */

import type { GraphEdge, GraphNode } from '../../../../shared-types/models';

export const EDGE_BYTE_SIZE = 13; // 4 + 4 + 4 + 1

export const EDGE_TYPE_MAP = [
  'citation',
  'conceptAgree',
  'conceptConflict',
  'semanticNeighbor',
] as const;

/**
 * 解码二进制边数据
 */
export function decodeEdgesFromBuffer(
  buffer: ArrayBuffer,
  nodes: GraphNode[]
): GraphEdge[] {
  const edgeCount = Math.floor(buffer.byteLength / EDGE_BYTE_SIZE);
  const view = new DataView(buffer);
  const edges: GraphEdge[] = [];

  for (let i = 0; i < edgeCount; i++) {
    const offset = i * EDGE_BYTE_SIZE;
    const sourceIdx = view.getUint32(offset, true);
    const targetIdx = view.getUint32(offset + 4, true);
    const weight = view.getFloat32(offset + 8, true);
    const edgeTypeIdx = view.getUint8(offset + 12);

    const sourceNode = nodes[sourceIdx];
    const targetNode = nodes[targetIdx];

    if (!sourceNode || !targetNode) continue;

    edges.push({
      source: sourceNode.id,
      target: targetNode.id,
      weight,
      type: EDGE_TYPE_MAP[edgeTypeIdx] ?? 'citation',
    });
  }

  return edges;
}
