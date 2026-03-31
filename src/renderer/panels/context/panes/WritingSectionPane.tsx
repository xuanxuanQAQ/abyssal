/**
 * WritingSectionPane — 写作上下文（§9）
 *
 * SectionContextWindow → SectionMaterials (RAG + PrivateKB)
 *
 * 使用 core/ipc/hooks/useRAG 中的 useWritingContext 获取写作素材。
 */

import React from 'react';
import { useWritingContext } from '../../../core/ipc/hooks/useRAG';
import { SectionContextWindow } from '../cards/SectionContextWindow';
import { SectionMaterials } from '../cards/SectionMaterials';

const scrollContainerStyle: React.CSSProperties = { overflowY: 'auto', height: '100%' };
const errorStyle: React.CSSProperties = { padding: 16, color: 'var(--danger)', fontSize: 'var(--text-sm)', textAlign: 'center' };
const loadingStyle: React.CSSProperties = { padding: 16, color: 'var(--text-muted)', fontSize: 'var(--text-sm)', textAlign: 'center' };

interface WritingSectionPaneProps {
  articleId: string;
  sectionId: string;
}

export const WritingSectionPane = React.memo(function WritingSectionPane({ articleId: _articleId, sectionId }: WritingSectionPaneProps) {
  const { data: writingContext, isLoading, isError } = useWritingContext(sectionId);

  if (isError) {
    return (
      <div style={errorStyle}>
        加载写作上下文失败
      </div>
    );
  }

  if (isLoading || !writingContext) {
    return (
      <div style={loadingStyle}>
        加载写作上下文…
      </div>
    );
  }

  return (
    <div style={scrollContainerStyle}>
      <SectionContextWindow
        sectionId={sectionId}
        sectionTitle={`§${sectionId}`}
        writingContext={writingContext}
      />
      <SectionMaterials
        sectionId={sectionId}
        sectionTitle={`§${sectionId}`}
        writingContext={writingContext}
      />
    </div>
  );
});
