// ═══ Paper ID 生成（委托层） ═══
// 核心实现在 search/paper-id.ts（单一来源）。
// 本模块仅添加碰撞重试的 nonce 机制。

import { createHash } from 'node:crypto';
import type { PaperId } from '../types/common';
import { asPaperId } from '../types/common';

// 重导出核心函数——确保全项目使用同一份实现和 stop words 列表
export {
  generatePaperId,
  titleNormalize as normalizeTitle,
  normalizeDoi,
  normalizeArxivId,
} from '../search/paper-id';

import { titleNormalize as titleNormalizeFn } from '../search/paper-id';

/**
 * 碰撞重试：在 canonical 末尾追加自增 nonce 后重新计算 SHA-1。
 *
 * 当 UPSERT 的 ON CONFLICT(id) 触发但 doi/arxivId 不匹配时调用。
 * 仅延长 hex 截取无法解决同源 canonical 碰撞（输入相同 → SHA-1 全部相同），
 * 必须通过 nonce 错开哈希空间。
 *
 * @param nonce - 自增计数器（1, 2, 3, ...），由调用方管理
 */
export function generatePaperIdWithNonce(
  input: {
    doi?: string | null;
    arxivId?: string | null;
    title: string;
    year: number;
  },
  nonce: number,
): PaperId {
  // 与 search/paper-id.ts 的 canonical 构建保持一致
  let canonical: string;
  if (input.doi) {
    canonical = input.doi.toLowerCase();
  } else if (input.arxivId) {
    canonical = input.arxivId;
  } else {
    canonical = titleNormalizeFn(input.title);
  }

  canonical += '::' + String(nonce);
  const hash = createHash('sha1').update(canonical).digest('hex');
  return asPaperId(hash.slice(0, 12));
}
