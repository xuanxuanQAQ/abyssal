/**
 * contextSourceKey — ContextSource → string key 转换（§5.1.4）
 *
 * 将 ContextSource 值对象转换为唯一字符串键，
 * 用于 ChatSession 索引和缓存键。
 */

import type { ContextSource } from '../../../../shared-types/models';

export function contextSourceKey(source: ContextSource): string {
  switch (source.type) {
    case 'paper':
      return `paper:${source.paperId}`;
    case 'papers':
      // 排序后拼接，保证相同论文集合得到相同 key
      return `papers:${[...source.paperIds].sort().join('+')}`;
    case 'concept':
      return `concept:${source.conceptId}`;
    case 'mapping':
      return `mapping:${source.mappingId}`;
    case 'section':
      return `section:${source.sectionId}`;
    case 'graphNode':
      return `graphNode:${source.nodeId}`;
    case 'memo':
      return `memo:${source.memoId}`;
    case 'note':
      return `note:${source.noteId}`;
    case 'allSelected':
      return `allSelected:${source.excludedCount}`;
    case 'empty':
      return 'global';
  }
}
