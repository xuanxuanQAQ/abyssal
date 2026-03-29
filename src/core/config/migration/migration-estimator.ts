// ═══ 迁移费用/时间预估 ═══
// §4.2: 迁移前向用户展示费用和时间预估

import type { AbyssalConfig } from '../../types/config';

// ─── 预估结果 ───

export interface MigrationEstimate {
  totalChunks: number;
  estimatedCost: string;
  estimatedMinutes: number;
  newDim: number;
  newModel: string;
  oldDim?: number;
  oldModel?: string;
}

// ─── 预估逻辑 ───

/**
 * 根据 chunk 数量和嵌入后端估算迁移的费用和时间。
 *
 * API 模式：
 *   - OpenAI text-embedding-3-small: ~$0.02 / 1M tokens
 *   - 平均 500 tokens/chunk
 *   - 速率约 3000 req/min → 批量 100 chunk/req → ~50 batch/min
 *
 * 本地 ONNX 模式：
 *   - 无 API 费用
 *   - 速率约 200 chunk/sec（GPU 依赖）
 */
export function estimateMigration(
  config: AbyssalConfig,
  totalChunks: number,
  oldDim?: number,
  oldModel?: string,
): MigrationEstimate {
  let estimatedCost = 0;
  let estimatedMinutes = 0;

  if (config.rag.embeddingBackend === 'api') {
    const avgTokensPerChunk = 500;
    const totalTokens = totalChunks * avgTokensPerChunk;
    // OpenAI text-embedding-3-small: $0.02 / 1M tokens
    estimatedCost = (totalTokens / 1_000_000) * 0.02;

    // 速率: ~3000 req/min, batch size 100 → ~50 batches/min
    const batchSize = 100;
    const batches = Math.ceil(totalChunks / batchSize);
    estimatedMinutes = Math.ceil(batches / 50);
  } else {
    // 本地 ONNX: ~200 chunk/sec（无 API 费用）
    estimatedCost = 0;
    estimatedMinutes = Math.ceil(totalChunks / (200 * 60));
  }

  // 至少 1 分钟
  if (estimatedMinutes < 1 && totalChunks > 0) estimatedMinutes = 1;

  return {
    totalChunks,
    estimatedCost: estimatedCost.toFixed(4),
    estimatedMinutes,
    newDim: config.rag.embeddingDimension,
    newModel: config.rag.embeddingModel,
    oldDim,
    oldModel,
  };
}
