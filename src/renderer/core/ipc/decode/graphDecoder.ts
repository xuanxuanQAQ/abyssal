/**
 * 图数据二进制解码器
 *
 * 将主进程通过 IPC 传输的 ArrayBuffer 解码为 GraphData 结构。
 * 核心解码逻辑在 graphDecoderShared.ts 中，主线程和 Worker 共享。
 */

import type { GraphData, GraphEdge, GraphNode } from '../../../../shared-types/models';
import { EDGE_BYTE_SIZE, decodeEdgesFromBuffer } from './graphDecoderShared';

// Re-export for backwards compatibility
export { decodeEdgesFromBuffer } from './graphDecoderShared';

/**
 * 判断是否应使用 Web Worker 解码
 *
 * 阈值：节点数 > 500 或边数 > 2000
 */
export function shouldUseWorker(
  nodeCount: number,
  edgeByteLength: number
): boolean {
  const edgeCount = Math.floor(edgeByteLength / EDGE_BYTE_SIZE);
  return nodeCount > 500 || edgeCount > 2000;
}

/**
 * 通过 Web Worker 解码图数据（异步）
 *
 * 将 ArrayBuffer 通过 Transferable 传给 Worker，
 * 解码完成后回传结构化结果。
 */
export function decodeEdgesInWorker(
  buffer: ArrayBuffer,
  nodes: GraphNode[]
): Promise<GraphEdge[]> {
  return new Promise((resolve, reject) => {
    const workerPath = new URL('./graphDecoder.worker.js', globalThis.location?.href ?? 'file:///');
    const worker = new Worker(workerPath);

    worker.onmessage = (e: MessageEvent<{ edges: GraphEdge[] }>) => {
      resolve(e.data.edges);
      worker.terminate();
    };

    worker.onerror = (err) => {
      reject(new Error(`Graph decoder worker error: ${err.message}`));
      worker.terminate();
    };

    worker.postMessage({ buffer, nodes }, [buffer]);
  });
}

/**
 * 解码完整图数据（自动选择主线程或 Worker）
 */
export async function decodeGraphData(
  raw: GraphData & { binaryPayload?: ArrayBuffer; format?: 'json' | 'binary' }
): Promise<GraphData> {
  if (raw.format === 'binary' && raw.binaryPayload) {
    const useWorker = shouldUseWorker(
      raw.nodes.length,
      raw.binaryPayload.byteLength
    );

    const edges = useWorker
      ? await decodeEdgesInWorker(raw.binaryPayload, raw.nodes)
      : decodeEdgesFromBuffer(raw.binaryPayload, raw.nodes);

    return { nodes: raw.nodes, edges };
  }

  return { nodes: raw.nodes, edges: raw.edges };
}
