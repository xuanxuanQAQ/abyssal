// ═══ 双栈嵌入生成器 ═══
// §1: API / Local-ONNX 路由 + L2 归一化 + 维度校验

import type { EmbedFunction } from '../types/common';
import type { RagConfig } from '../types/config';
import { DimensionMismatchError } from '../types/errors';
import type { Logger } from '../infra/logger';

// ─── L2 归一化 (§1.4) ───

function l2Normalize(vec: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    sumSq += vec[i]! * vec[i]!;
  }
  const norm = Math.sqrt(sumSq);
  if (norm < 1e-12) return vec; // 零向量保护

  const result = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    result[i] = vec[i]! / norm;
  }
  return result;
}

// ─── Embedder 类 ───

export class Embedder {
  private readonly dimension: number;
  private readonly embedFn: EmbedFunction;
  private readonly logger: Logger;

  /**
   * @param embedFn API 或 Local-ONNX 的嵌入实现
   * @param config RAG 配置
   * @param logger 日志器
   */
  constructor(embedFn: EmbedFunction, config: RagConfig, logger: Logger) {
    this.embedFn = embedFn;
    this.dimension = config.embeddingDimension;
    this.logger = logger;
  }

  /** 返回当前嵌入维度 */
  getDimension(): number {
    return this.dimension;
  }

  /** 批量嵌入 + L2 归一化 + 维度校验 */
  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];

    // §1.2: 自动分批（API batch 上限 2048）
    const BATCH_SIZE = 2048;
    const allResults: Float32Array[] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const raw = await this.embedFn.embed(batch);

      for (const vec of raw) {
        // §1.5: 维度校验
        if (vec.length !== this.dimension) {
          throw new DimensionMismatchError({
            message: `Embedding dimension mismatch: expected ${this.dimension}, got ${vec.length}`,
            context: {
              expected: this.dimension,
              actual: vec.length,
            },
          });
        }
        // §1.4: L2 归一化
        allResults.push(l2Normalize(vec));
      }
    }

    this.logger.debug('Embeddings generated', {
      count: allResults.length,
      dimension: this.dimension,
    });

    return allResults;
  }

  /** 单条文本嵌入 */
  async embedSingle(text: string): Promise<Float32Array> {
    const results = await this.embed([text]);
    return results[0]!;
  }
}
