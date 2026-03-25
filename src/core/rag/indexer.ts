// ═══ 事务化索引 ═══
// §2: indexChunks — 批量写入 chunks + chunks_vec，每 500 chunk 拆分事务

import type { TextChunk } from '../types/chunk';
import type { DatabaseService } from '../database';
import type { Logger } from '../infra/logger';

// ─── §2.1 IndexResult ───

export interface IndexResult {
  indexed: number;
  skipped: number;
  totalTokens: number;
  estimatedCost: number | null;
}

// ─── 常量 ───

const BATCH_SIZE = 500;
// OpenAI text-embedding-3-small: $0.02 / 1M tokens
const PRICE_PER_TOKEN = 0.00002 / 1000;

/**
 * 将 TextChunk 数组及其嵌入向量事务化写入数据库。
 *
 * - 每 500 chunk 一个事务（避免长事务阻塞 UI）
 * - 幂等性：已存在的 chunk_id 自动跳过
 * - 事务间 setImmediate 释放事件循环
 */
export async function indexChunks(
  chunks: TextChunk[],
  embeddings: Float32Array[],
  dbService: DatabaseService,
  logger: Logger,
  isApiBackend: boolean = false,
): Promise<IndexResult> {
  let indexed = 0;
  let skipped = 0;
  let totalTokens = 0;

  for (let batchStart = 0; batchStart < chunks.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, chunks.length);
    const batchChunks = chunks.slice(batchStart, batchEnd);
    const batchEmbeddings = embeddings.slice(batchStart, batchEnd);

    // 过滤已存在的 chunk（幂等性）
    const newChunks: TextChunk[] = [];
    const newEmbeddings: Float32Array[] = [];

    for (let i = 0; i < batchChunks.length; i++) {
      const chunk = batchChunks[i]!;
      const existing = dbService.getChunkByChunkId(chunk.chunkId);
      if (existing) {
        skipped++;
      } else {
        newChunks.push(chunk);
        newEmbeddings.push(batchEmbeddings[i]!);
        totalTokens += chunk.tokenCount;
      }
    }

    if (newChunks.length > 0) {
      // 使用 DatabaseService 的批量写入（内部在单事务中）
      dbService.insertChunksBatch(
        newChunks,
        newEmbeddings.map((e) => e as Float32Array | null),
      );
      indexed += newChunks.length;
    }

    // 事务间释放事件循环
    if (batchEnd < chunks.length) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  const estimatedCost = isApiBackend ? totalTokens * PRICE_PER_TOKEN : null;

  logger.info('Index complete', {
    indexed,
    skipped,
    totalTokens,
    estimatedCost,
  });

  return { indexed, skipped, totalTokens, estimatedCost };
}
