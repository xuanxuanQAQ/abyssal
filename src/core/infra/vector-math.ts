// ═══ sqlite-vec 距离-相似度映射 ═══
//
// sqlite-vec 返回 L2 距离 d。
// 对 L2 归一化向量：d² = 2(1 - cosθ)
// score = max(0, 1 - d²/4)
//
// d_max = 2（反向向量），d_max² = 4

/**
 * 将 sqlite-vec 的 L2 距离转换为 [0, 1] 相似度分数。
 *
 *  | 向量关系   | cosθ | d²  | score |
 *  |-----------|------|-----|-------|
 *  | 完全相同   | 1.0  | 0   | 1.0   |
 *  | 高度相似   | 0.8  | 0.4 | 0.9   |
 *  | 中等相似   | 0.5  | 1.0 | 0.75  |
 *  | 正交       | 0.0  | 2.0 | 0.5   |
 *  | 反向       | -1.0 | 4.0 | 0.0   |
 */
export function l2DistanceToScore(d: number): number {
  return Math.max(0, 1 - (d * d) / 4);
}

/** 将 [0, 1] 相似度分数转换为 L2 距离 */
export function scoreToL2Distance(s: number): number {
  return Math.sqrt(4 * (1 - s));
}

/** 计算向量的 L2 范数（欧氏长度） */
export function l2Norm(vec: Float32Array): number {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    sumSq += vec[i]! * vec[i]!;
  }
  return Math.sqrt(sumSq);
}

/** 计算两个向量的 L2 距离 */
export function l2Distance(a: Float32Array, b: Float32Array): number {
  let sumSq = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i]! - b[i]!;
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq);
}
