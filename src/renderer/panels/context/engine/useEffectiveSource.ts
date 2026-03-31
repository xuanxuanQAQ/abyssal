/**
 * useEffectiveSource — 整合 pin/peek/derived 三者优先级（§2.4、§12.3）
 *
 * 渲染优先级：peekSource > pinnedSource > derivedSource
 *
 * 包含 150ms 防抖处理，防止 Library 键盘快速导航时
 * ContextSource 频繁变化导致不必要的 ContentPane 卸载/重挂载。
 * 视图切换（activeView 变化）不防抖。
 */

import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../../../core/store';
import { useDerivedContextSource } from './useContextSource';
import { contextSourceKey } from './contextSourceKey';
import type { ContextSource } from '../../../../shared-types/models';

const DEBOUNCE_MS = 150;

/**
 * 比较两个 ContextSource 是否逻辑相等
 */
function sourceEquals(a: ContextSource, b: ContextSource): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'paper':
      return b.type === 'paper' && a.paperId === b.paperId && a.originView === b.originView;
    case 'papers':
      // paperIds 已排序（useContextSource 保证），直接逐位比较
      return b.type === 'papers' && a.paperIds.length === b.paperIds.length
        && a.paperIds.every((id, i) => b.paperIds[i] === id);
    case 'concept':
      return b.type === 'concept' && a.conceptId === b.conceptId;
    case 'mapping':
      return b.type === 'mapping' && a.mappingId === b.mappingId;
    case 'section':
      return b.type === 'section' && a.sectionId === b.sectionId;
    case 'graphNode':
      return b.type === 'graphNode' && a.nodeId === b.nodeId;
    case 'memo':
      return b.type === 'memo' && a.memoId === b.memoId;
    case 'note':
      return b.type === 'note' && a.noteId === b.noteId;
    case 'allSelected':
      return b.type === 'allSelected' && a.excludedCount === b.excludedCount;
    case 'empty':
      return b.type === 'empty';
  }
}

export function useEffectiveSource(): ContextSource {
  const pinnedSource = useAppStore((s) => s.pinnedSource);
  const peekSource = useAppStore((s) => s.peekSource);
  const contextPanelPinned = useAppStore((s) => s.contextPanelPinned);
  const activeView = useAppStore((s) => s.activeView);
  const derivedSource = useDerivedContextSource();

  // 上一次的 activeView，用于检测视图切换
  const prevViewRef = useRef(activeView);

  // 防抖后的实际生效 ContextSource
  const [debouncedSource, setDebouncedSource] = useState<ContextSource>(derivedSource);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // 计算即时 ContextSource（不经防抖）
  const immediateSource: ContextSource =
    peekSource ?? (contextPanelPinned && pinnedSource ? pinnedSource : derivedSource);

  // 用 ref 追踪 immediateSource，避免对象引用变化导致 effect 反复触发
  const immediateRef = useRef(immediateSource);
  immediateRef.current = immediateSource;

  // 仅当 immediateSource 内容真正变化时才触发防抖
  // 用序列化 key 做变化检测（比对象引用更可靠）
  const sourceKey = contextSourceKey(immediateSource);
  const prevSourceKeyRef = useRef(sourceKey);

  useEffect(() => {
    const viewChanged = prevViewRef.current !== activeView;
    prevViewRef.current = activeView;

    // 内容没变——跳过
    if (prevSourceKeyRef.current === sourceKey && !viewChanged) {
      return;
    }
    prevSourceKeyRef.current = sourceKey;

    // 已经等于当前值——跳过
    if (sourceEquals(immediateRef.current, debouncedSource)) {
      return;
    }

    if (viewChanged) {
      // 视图切换：不防抖，立即响应
      clearTimeout(debounceRef.current);
      setDebouncedSource(immediateRef.current);
      return;
    }

    // 同一视图内的选择变化：防抖 150ms
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSource(immediateRef.current);
    }, DEBOUNCE_MS);

    return () => clearTimeout(debounceRef.current);
  }, [sourceKey, activeView, debouncedSource]);

  return debouncedSource;
}
