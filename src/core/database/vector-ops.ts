// ═══ 向量操作工具 ═══
// §1.2: Float32Array → Buffer 零拷贝转换
// §2.7: L2 归一化验证 + 零向量检测 + 强制重归一化

import type { Logger } from '../infra/logger';
import { l2Norm } from '../infra/vector-math';

// ─── §1.2 Float32Array → Buffer 零拷贝转换 ───

/**
 * Float32Array → Buffer 零拷贝转换。
 *
 * Buffer 和 Float32Array 共享同一块 ArrayBuffer 内存。
 * 不分配新内存，不复制数据。
 *
 * 字节序保证：sqlite-vec 使用平台原生字节序（little-endian on x86-64/ARM64），
 * 与 Float32Array 的内存布局一致——无需字节序转换。
 */
export function embeddingToBuffer(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

// ─── §2.7 零向量检测 ───

const ZERO_VECTOR_THRESHOLD = 1e-12;

/**
 * 检测向量是否为数值零向量。
 * ‖v‖₂ < 1e-12 时为零向量——归一化会产生 NaN/Inf。
 */
export function isZeroVector(vec: Float32Array): boolean {
  const norm = l2Norm(vec);
  return norm < ZERO_VECTOR_THRESHOLD;
}

// ─── §2.7 归一化验证 ───

const NORM_EPSILON = 1e-5;

/**
 * 验证向量是否已 L2 归一化（|‖v‖₂ - 1| < ε）。
 *
 * - 合格：直接返回原向量
 * - 不合格：warn 日志 + 强制重归一化后返回
 * - 零向量：warn 日志（含文本摘要）+ 原样返回（不归一化）
 *
 * §2.7: 零向量与任何查询的 L2 距离 = ‖q‖ = 1，score ≈ 0.75，
 * 不会被排到最相关位置——安全但降级。
 */
export function validateAndNormalize(
  vec: Float32Array,
  logger?: Logger,
  debugTextHint?: string,
): Float32Array {
  // 零向量检测
  const norm = l2Norm(vec);
  if (norm < ZERO_VECTOR_THRESHOLD) {
    logger?.warn('Zero vector detected — embedding will be degraded', {
      norm,
      textHint: debugTextHint?.slice(0, 100) ?? '(no text)',
    });
    return vec; // 原样返回，不归一化
  }

  // 归一化验证
  if (Math.abs(norm - 1.0) < NORM_EPSILON) {
    return vec; // 已归一化
  }

  // 不合格——强制重归一化
  logger?.warn('Embedding not L2-normalized, forcing re-normalization', {
    norm,
    deviation: Math.abs(norm - 1.0),
  });

  const normalized = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    normalized[i] = vec[i]! / norm;
  }
  return normalized;
}

/**
 * 一体化入口：归一化 + 验证 + Buffer 转换。
 *
 * 用于写入 chunks_vec 前的最终处理。
 */
export function prepareEmbeddingForInsert(
  vec: Float32Array,
  logger?: Logger,
  debugTextHint?: string,
): Buffer {
  const validated = validateAndNormalize(vec, logger, debugTextHint);
  return embeddingToBuffer(validated);
}
