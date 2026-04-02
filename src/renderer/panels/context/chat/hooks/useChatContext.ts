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
import { contextSourceKey } from '../../engine/contextSourceKey';
import type { ChatContext, ChatImageClip } from '../../../../../shared-types/ipc';

export function useChatContext(): () => ChatContext {
  const source = useEffectiveSource();

  return useCallback((): ChatContext => {
    const appState = useAppStore.getState();
    const readerState = useReaderStore.getState();

    const context: ChatContext = {
      activeView: appState.activeView,
      contextKey: contextSourceKey(source),
    };

    // 注入阅读器中选取的引用文本
    if (readerState.quotedSelection) {
      context.selectedQuote = readerState.quotedSelection.text;
      context.pdfPage = readerState.quotedSelection.page;
    }

    // 注入 DLA 智能选取的图片截图
    if (readerState.selectionPayload?.images?.length) {
      context.imageClips = readerState.selectionPayload.images.map(
        (img): ChatImageClip => ({
          type: img.type,
          dataUrl: img.dataUrl,
          pageNumber: img.pageNumber,
          bbox: img.bbox,
        }),
      );
      // Use first image's page as pdfPage if not already set
      const firstSourcePage = readerState.selectionPayload.sourcePages[0];
      if (!context.pdfPage && firstSourcePage !== undefined) {
        context.pdfPage = firstSourcePage;
      }
    }

    // 从当前 ContextSource 注入实体信息
    switch (source.type) {
      case 'paper':
        context.selectedPaperId = source.paperId;
        if (source.originView === 'reader' && !context.pdfPage) {
          context.pdfPage = readerState.currentPage;
        }
        break;
      case 'papers':
        context.selectedPaperIds = source.paperIds;
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
      case 'allSelected':
        // allSelected context — library-wide, no specific entity to inject
        break;
      case 'empty':
        break;
    }

    return context;
  }, [source]);
}
