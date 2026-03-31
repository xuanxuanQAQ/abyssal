// ═══ 事务化索引 ═══
// §2: indexChunks — 批量写入 chunks + chunks_vec，每 500 chunk 拆分事务
//
// 改进：
//   - Fix #13: 批量 IN 查询替代逐条 SELECT 幂等检查
//   - Fix #14: chunks.length !== embeddings.length 前置断言

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
 * - 幂等性：已存在的 chunk_id 自动跳过（批量 IN 查询）
 * - 事务间 setImmediate 释放事件循环
 */
export async function indexChunks(
  chunks: TextChunk[],
  embeddings: Float32Array[],
  dbService: DatabaseService,
  logger: Logger,
  isApiBackend: boolean = false,
): Promise<IndexResult> {
  // Fix #14: 前置长度校验
  if (chunks.length !== embeddings.length) {
    throw new Error(
      `chunks.length (${chunks.length}) !== embeddings.length (${embeddings.length})`,
    );
  }

  let indexed = 0;
  let skipped = 0;
  let totalTokens = 0;

  for (let batchStart = 0; batchStart < chunks.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, chunks.length);
    const batchChunks = chunks.slice(batchStart, batchEnd);
    const batchEmbeddings = embeddings.slice(batchStart, batchEnd);

    // Fix #13: 批量查询已存在的 chunk_id（替代逐条 SELECT）
    const chunkIds = batchChunks.map((c) => c.chunkId as string);
    const existingSet = dbService.getExistingChunkIds(chunkIds);

    const newChunks: TextChunk[] = [];
    const newEmbeddings: Float32Array[] = [];

    for (let i = 0; i < batchChunks.length; i++) {
      const chunk = batchChunks[i]!;
      if (existingSet.has(chunk.chunkId as string)) {
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
