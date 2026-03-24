/**
 * Web Worker 版图数据解码器
 *
 * 在独立线程中执行 DataView 解码，彻底解放 UI 线程。
 * 解码逻辑复用 graphDecoderShared.ts。
 *
 * 通信协议：
 * 主线程 → Worker: { buffer: ArrayBuffer, nodes: GraphNode[] }
 * Worker → 主线程: { edges: GraphEdge[] }
 */

import type { GraphNode } from '../../../../shared-types/models';
import { decodeEdgesFromBuffer } from './graphDecoderShared';

self.onmessage = (
  e: MessageEvent<{ buffer: ArrayBuffer; nodes: GraphNode[] }>
) => {
  const { buffer, nodes } = e.data;
  const edges = decodeEdgesFromBuffer(buffer, nodes);
  self.postMessage({ edges });
};
