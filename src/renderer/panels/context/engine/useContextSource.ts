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
 * 7. Library + 选中论文（多选 / allExcept 模式）
 * 8. Notes + 选中 memo/note
 * 9. EmptyContext
 */

import { useMemo, useRef } from 'react';
import { useAppStore } from '../../../core/store';
import { useShallow } from 'zustand/react/shallow';
import type { ContextSource } from '../../../../shared-types/models';
import type { ViewType } from '../../../../shared-types/enums';
import type { PaperSelectionMode } from '../../../core/store/slices/selectionSlice';

const EMPTY_CONTEXT: ContextSource = { type: 'empty' };

/**
 * 从 explicitIds 提取排序后的 ID 列表。
 * 排序保证顺序稳定（immer 每次产生新对象，key 顺序可能不同）。
 */
function getSortedExplicitIds(explicitIds: Record<string, true>): string[] {
  return Object.keys(explicitIds).sort();
}

/** 浅比较两个 string[] 是否内容相同 */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ─── 纯函数：派生逻辑（可单独测试） ───

export interface DeriveContextInput {
  activeView: ViewType;
  selectedPaperId: string | null;
  selectionMode: PaperSelectionMode;
  multiIds: string[];
  selectedConceptId: string | null;
  selectedMappingId: string | null;
  selectedMappingPaperId: string | null;
  selectedMappingConceptId: string | null;
  selectedSectionId: string | null;
  selectedArticleId: string | null;
  focusedGraphNodeId: string | null;
  focusedGraphNodeType: 'paper' | 'concept' | 'memo' | 'note' | null;
  selectedMemoId: string | null;
  selectedNoteId: string | null;
  excludedCount: number;
}

/**
 * 纯函数版本的 ContextSource 派生逻辑。
 * 供 hook 内部使用，也可在测试中直接调用。
 */
export function deriveContextSource(input: DeriveContextInput): ContextSource {
  const {
    activeView, selectedPaperId, selectionMode, multiIds,
    selectedConceptId, selectedMappingId, selectedMappingPaperId,
    selectedMappingConceptId, selectedSectionId, selectedArticleId,
    focusedGraphNodeId, focusedGraphNodeType, selectedMemoId, selectedNoteId,
  } = input;

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

  // 优先级 7: Library + 选中论文（多选 / allExcept 模式）
  if (activeView === 'library') {
    // allExcept 模式（Ctrl+A 全选）：展示批量摘要上下文
    if (selectionMode === 'allExcept') {
      return { type: 'allSelected', excludedCount: input.excludedCount ?? 0 };
    }
    if (selectedPaperId) {
      if (multiIds.length > 1) {
        return { type: 'papers', paperIds: multiIds, originView: 'library' };
      }
      return { type: 'paper', paperId: selectedPaperId, originView: 'library' };
    }
  }

  // 优先级 8: Notes + 选中 memo/note
  if (activeView === 'notes') {
    if (selectedNoteId) {
      return { type: 'note', noteId: selectedNoteId };
    }
    if (selectedMemoId) {
      return { type: 'memo', memoId: selectedMemoId };
    }
  }

  // 优先级 9: 无选中
  return EMPTY_CONTEXT;
}

// ─── React Hook ───

/**
 * 派生 ContextSource（不考虑 pin/peek，纯粹从当前选择派生）
 */
/** 单一 shallow selector，将 14 个独立订阅合并为 1 个 */
const contextInputSelector = (s: import('../../../core/store/useAppStore').AppStoreState) => ({
  activeView: s.activeView,
  selectedPaperId: s.selectedPaperId,
  selectionMode: s.selectionMode,
  explicitIds: s.explicitIds,
  excludedIds: s.excludedIds,
  selectedConceptId: s.selectedConceptId,
  selectedMappingId: s.selectedMappingId,
  selectedMappingPaperId: s.selectedMappingPaperId,
  selectedMappingConceptId: s.selectedMappingConceptId,
  selectedSectionId: s.selectedSectionId,
  selectedArticleId: s.selectedArticleId,
  focusedGraphNodeId: s.focusedGraphNodeId,
  focusedGraphNodeType: s.focusedGraphNodeType,
  selectedMemoId: s.selectedMemoId,
  selectedNoteId: s.selectedNoteId,
});

export function useDerivedContextSource(): ContextSource {
  const {
    activeView, selectedPaperId, selectionMode, explicitIds, excludedIds,
    selectedConceptId, selectedMappingId, selectedMappingPaperId,
    selectedMappingConceptId, selectedSectionId, selectedArticleId,
    focusedGraphNodeId, focusedGraphNodeType, selectedMemoId, selectedNoteId,
  } = useAppStore(useShallow(contextInputSelector));

  // 稳定化 multiIds：只在内容真正变化时更新引用
  const prevMultiIdsRef = useRef<string[]>([]);
  const multiIds = useMemo(() => {
    if (selectionMode !== 'explicit') return prevMultiIdsRef.current = [];
    const sorted = getSortedExplicitIds(explicitIds);
    if (arraysEqual(sorted, prevMultiIdsRef.current)) {
      return prevMultiIdsRef.current;
    }
    prevMultiIdsRef.current = sorted;
    return sorted;
  }, [selectionMode, explicitIds]);

  const excludedCount = useMemo(
    () => Object.keys(excludedIds).length,
    [excludedIds],
  );

  return useMemo(
    () => deriveContextSource({
      activeView, selectedPaperId, selectionMode, multiIds,
      selectedConceptId, selectedMappingId, selectedMappingPaperId,
      selectedMappingConceptId, selectedSectionId, selectedArticleId,
      focusedGraphNodeId, focusedGraphNodeType, selectedMemoId, selectedNoteId,
      excludedCount,
    }),
    [
      activeView, selectedPaperId, selectionMode, multiIds,
      selectedConceptId, selectedMappingId, selectedMappingPaperId,
      selectedMappingConceptId, selectedSectionId, selectedArticleId,
      focusedGraphNodeId, focusedGraphNodeType, selectedMemoId, selectedNoteId,
      excludedCount,
    ],
  );
}
