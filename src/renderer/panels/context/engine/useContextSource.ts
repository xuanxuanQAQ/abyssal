/**
 * useContextSource — 从 useAppStore 派生 ContextSource（§2.3）
 *
 * 派生优先级（从高到低）：
 * 1. contextPanelPinned + pinnedSource
 * 2. Reader + 论文打开
 * 3. Writing + 选中节
 * 4. Analysis + 选中映射
 * 5. Analysis + 选中概念
 * 6. Graph + 焦点节点
 * 7. Library + 选中论文
 * 8. EmptyContext
 */

import { useAppStore } from '../../../core/store';
import type { ContextSource } from '../../../../shared-types/models';

const EMPTY_CONTEXT: ContextSource = { type: 'empty' };

/**
 * 派生 ContextSource（不考虑 pin/peek，纯粹从当前选择派生）
 */
export function useDerivedContextSource(): ContextSource {
  const activeView = useAppStore((s) => s.activeView);
  const selectedPaperId = useAppStore((s) => s.selectedPaperId);
  const selectedConceptId = useAppStore((s) => s.selectedConceptId);
  const selectedMappingId = useAppStore((s) => s.selectedMappingId);
  const selectedMappingPaperId = useAppStore((s) => s.selectedMappingPaperId);
  const selectedMappingConceptId = useAppStore((s) => s.selectedMappingConceptId);
  const selectedSectionId = useAppStore((s) => s.selectedSectionId);
  const selectedArticleId = useAppStore((s) => s.selectedArticleId);
  const focusedGraphNodeId = useAppStore((s) => s.focusedGraphNodeId);
  const focusedGraphNodeType = useAppStore((s) => s.focusedGraphNodeType);

  // 优先级 2: Reader + 论文
  if (activeView === 'reader' && selectedPaperId) {
    return { type: 'paper', paperId: selectedPaperId, originView: 'reader' };
  }

  // 优先级 3: Writing + 选中节
  if (activeView === 'writing' && selectedSectionId) {
    return {
      type: 'section',
      articleId: selectedArticleId ?? '',
      sectionId: selectedSectionId,
    };
  }

  // 优先级 4: Analysis + 选中映射
  if (activeView === 'analysis' && selectedMappingId) {
    return {
      type: 'mapping',
      mappingId: selectedMappingId,
      paperId: selectedMappingPaperId ?? '',
      conceptId: selectedMappingConceptId ?? '',
    };
  }

  // 优先级 5: Analysis + 选中概念
  if (activeView === 'analysis' && selectedConceptId) {
    return { type: 'concept', conceptId: selectedConceptId };
  }

  // 优先级 6: Graph + 焦点节点
  if (activeView === 'graph' && focusedGraphNodeId) {
    return {
      type: 'graphNode',
      nodeId: focusedGraphNodeId,
      nodeType: focusedGraphNodeType ?? 'paper',
    };
  }

  // 优先级 7: Library + 选中论文
  if (activeView === 'library' && selectedPaperId) {
    return { type: 'paper', paperId: selectedPaperId, originView: 'library' };
  }

  // 优先级 8: 无选中
  return EMPTY_CONTEXT;
}
