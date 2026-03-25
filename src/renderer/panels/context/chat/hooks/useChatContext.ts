/**
 * useChatContext — 自动构建 ChatContext（§5.6）
 *
 * 每次用户发送消息时，自动从当前 ContextSource + Store 状态
 * 组装 ChatContext 对象，注入到 IPC 调用中。
 */

import { useCallback } from 'react';
import { useAppStore } from '../../../../core/store';
import { useReaderStore } from '../../../../core/store/useReaderStore';
import { useEffectiveSource } from '../../engine/useEffectiveSource';
import type { ChatContext } from '../../../../../shared-types/ipc';

export function useChatContext(): () => ChatContext {
  const source = useEffectiveSource();

  return useCallback((): ChatContext => {
    const appState = useAppStore.getState();
    const readerState = useReaderStore.getState();

    const context: ChatContext = {
      activeView: appState.activeView,
    };

    // 从当前 ContextSource 注入实体信息
    switch (source.type) {
      case 'paper':
        context.selectedPaperId = source.paperId;
        if (source.originView === 'reader') {
          context.pdfPage = readerState.currentPage;
        }
        break;
      case 'concept':
        context.selectedConceptId = source.conceptId;
        break;
      case 'mapping':
        context.selectedPaperId = source.paperId;
        context.selectedConceptId = source.conceptId;
        break;
      case 'section':
        context.selectedSectionId = source.sectionId;
        break;
      case 'graphNode':
        // graphNode 根据 nodeType 注入对应 ID
        if (source.nodeType === 'paper') {
          context.selectedPaperId = source.nodeId;
        } else {
          context.selectedConceptId = source.nodeId;
        }
        break;
      case 'memo':
        // memo context — no specific ChatContext field to populate
        break;
      case 'note':
        // note context — no specific ChatContext field to populate
        break;
      case 'empty':
        break;
    }

    return context;
  }, [source]);
}
