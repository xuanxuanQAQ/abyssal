// ═══ 桥梁论文识别 ═══
// §10.1: 被 ≥2 篇种子论文引用的论文标记为桥梁论文

import type { PaperId } from '../types/common';

/**
 * 识别桥梁论文——被多篇种子论文共同引用的论文。
 *
 * @param seedIds 种子论文 ID 列表
 * @param citationMap 每篇种子论文的引用列表（被引论文 ID 数组）
 * @returns Map<被引论文 ID, bridgeScore>，仅包含 score ≥ 2 的论文
 */
export function detectBridgePapers(
  seedIds: PaperId[],
  citationMap: Map<PaperId, PaperId[]>,
): Map<PaperId, number> {
  // citedBySeeds: 被引论文 → 引用它的种子论文集合
  const citedBySeeds = new Map<PaperId, Set<PaperId>>();

  for (const seedId of seedIds) {
    const citations = citationMap.get(seedId) ?? [];
    for (const citedId of citations) {
      const seedSet = citedBySeeds.get(citedId) ?? new Set();
      seedSet.add(seedId);
      citedBySeeds.set(citedId, seedSet);
    }
  }

  // 过滤 bridgeScore ≥ 2
  const bridgePapers = new Map<PaperId, number>();
  for (const [paperId, seedSet] of citedBySeeds) {
    if (seedSet.size >= 2) {
      bridgePapers.set(paperId, seedSet.size);
    }
  }

  return bridgePapers;
}
