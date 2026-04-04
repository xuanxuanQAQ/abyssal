/**
 * SectionMaterials — 写作素材卡片列表（§9.3）
 *
 * 包含 RAG 结果 + 私有知识库匹配
 * 顶部有"刷新素材"按钮
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { RAGResultCard } from './RAGResultCard';
import type { WritingContext, WritingContextRequest } from '../../../../shared-types/models';
import { buildWritingContextQueryKey } from '../../../core/ipc/hooks/useRAG';

interface SectionMaterialsProps {
  request: WritingContextRequest;
  sectionTitle?: string;
  writingContext: WritingContext;
}

// ── Static styles ──

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 12px',
  borderBottom: '1px solid var(--border-subtle)',
};

const headerLabelStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  color: 'var(--text-secondary)',
};

const refreshButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  background: 'none',
  border: 'none',
  color: 'var(--text-muted)',
  fontSize: 'var(--text-xs)',
  cursor: 'pointer',
};

const emptyStyle: React.CSSProperties = {
  padding: 16,
  textAlign: 'center',
  color: 'var(--text-muted)',
  fontSize: 'var(--text-sm)',
};

const subHeaderStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 'var(--text-xs)',
  color: 'var(--text-muted)',
};

const privateKBCardStyle: React.CSSProperties = {
  margin: '4px 12px',
  padding: '8px 10px',
  backgroundColor: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--text-xs)',
};

const privateKBHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  marginBottom: 4,
};

const privateKBTitleStyle: React.CSSProperties = {
  fontWeight: 500,
};

const privateKBScoreStyle: React.CSSProperties = {
  marginLeft: 'auto',
  color: 'var(--text-muted)',
};

const privateKBTextStyle: React.CSSProperties = {
  color: 'var(--text-secondary)',
  lineHeight: 1.5,
};

export const SectionMaterials = React.memo(function SectionMaterials({
  request,
  sectionTitle,
  writingContext,
}: SectionMaterialsProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const handleRefresh = () => {
    queryClient.invalidateQueries({
      queryKey: buildWritingContextQueryKey(request),
    });
  };

  const hasResults =
    writingContext.ragPassages.length > 0 || writingContext.privateKBMatches.length > 0;

  return (
    <div>
      {/* 标题 + 刷新 */}
      <div style={headerStyle}>
        <span style={headerLabelStyle}>
          {t('context.sectionMaterials.title')}
        </span>
        <button
          onClick={handleRefresh}
          style={refreshButtonStyle}
        >
          <RefreshCw size={10} /> {t('context.sectionMaterials.refresh')}
        </button>
      </div>

      {!hasResults ? (
        <div style={emptyStyle}>
          {t('context.sectionMaterials.empty')}
        </div>
      ) : (
        <>
          {/* RAG 结果 */}
          {writingContext.ragPassages.length > 0 && (
            <div>
              <div style={subHeaderStyle}>
                {t('context.sectionMaterials.literatureSearch', { count: writingContext.ragPassages.length })}
              </div>
              {writingContext.ragPassages.map((r) => (
                <RAGResultCard key={r.chunkId} result={r} sectionTitle={sectionTitle} />
              ))}
            </div>
          )}

          {/* 私有知识库匹配 */}
          {writingContext.privateKBMatches.length > 0 && (
            <div>
              <div style={subHeaderStyle}>
                {t('context.sectionMaterials.privateKB', { count: writingContext.privateKBMatches.length })}
              </div>
              {writingContext.privateKBMatches.map((match) => (
                <div key={match.docId} style={privateKBCardStyle}>
                  <div style={privateKBHeaderStyle}>
                    <span style={privateKBTitleStyle}>{match.docId}</span>
                    <span style={privateKBScoreStyle}>
                      {t('context.rag.relevance')}: {match.score.toFixed(2)}
                    </span>
                  </div>
                  <div style={privateKBTextStyle}>
                    "{match.text.slice(0, 160)}{match.text.length > 160 ? '…' : ''}"
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
});
