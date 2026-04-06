/**
 * WritingSectionPane — 写作上下文（§9）
 *
 * SectionContextWindow → SectionMaterials (RAG + PrivateKB)
 *
 * 使用 core/ipc/hooks/useRAG 中的 useWritingContext 获取写作素材。
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useWritingContext } from '../../../core/ipc/hooks/useRAG';
import { SectionContextWindow } from '../cards/SectionContextWindow';
import { SectionMaterials } from '../cards/SectionMaterials';
import { useEditorStore } from '../../../core/store/useEditorStore';
import { useSectionTitle } from '../../../views/writing/hooks/useSectionTitle';
import type { WritingContextRequest } from '../../../../shared-types/models';

const scrollContainerStyle: React.CSSProperties = { overflowY: 'auto', height: '100%' };
const errorStyle: React.CSSProperties = { padding: 16, color: 'var(--danger)', fontSize: 'var(--text-sm)', textAlign: 'center' };
const loadingStyle: React.CSSProperties = { padding: 16, color: 'var(--text-muted)', fontSize: 'var(--text-sm)', textAlign: 'center' };
const ragWarningStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 'var(--text-xs)',
  color: 'var(--text-muted)',
  background: 'var(--surface-raised, var(--bg-secondary))',
  borderBottom: '1px solid var(--border)',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

interface WritingSectionPaneProps {
  articleId: string;
  sectionId: string;
  draftId?: string;
}

export const WritingSectionPane = React.memo(function WritingSectionPane({ articleId, sectionId, draftId }: WritingSectionPaneProps) {
  const { t } = useTranslation();
  const liveArticleId = useEditorStore((s) => s.liveArticleId);
  const liveDraftId = useEditorStore((s) => s.liveDraftId);
  const liveDocumentJson = useEditorStore((s) => s.liveDocumentJson);
  const resolvedSectionTitle = useSectionTitle(articleId, sectionId);
  const sectionTitle = resolvedSectionTitle ?? t('context.header.section');

  const request = React.useMemo<WritingContextRequest>(() => ({
    articleId,
    ...(draftId ? { draftId } : {}),
    sectionId,
    ...(draftId ? { mode: 'draft' as const } : { mode: 'article' as const }),
    ...(liveDocumentJson && liveArticleId === articleId && liveDraftId === (draftId ?? null)
      ? { documentJson: liveDocumentJson }
      : {}),
  }), [articleId, draftId, liveArticleId, liveDocumentJson, liveDraftId, sectionId]);

  const { data: writingContext, isLoading, isError, error } = useWritingContext(request);

  if (isError) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return (
      <div style={errorStyle}>
        加载写作上下文失败
        <div style={{ marginTop: 6, fontSize: 'var(--text-xs)', opacity: 0.7, wordBreak: 'break-all' }}>
          {errMsg}
        </div>
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
      {writingContext.ragStatus !== 'ok' && (
        <div style={ragWarningStyle}>
          <span>{writingContext.ragStatus === 'unavailable' ? '⚠ 向量检索未启用（未配置 Embedding）' : `⚠ 向量检索异常: ${writingContext.ragStatusDetail ?? '未知错误'}`}</span>
        </div>
      )}
      <SectionContextWindow
        sectionId={sectionId}
        sectionTitle={sectionTitle}
        writingContext={writingContext}
      />
      <SectionMaterials
        request={request}
        sectionTitle={sectionTitle}
        writingContext={writingContext}
      />
    </div>
  );
});
