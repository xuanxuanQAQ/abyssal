/**
 * MultiPaperPane — Library 多选论文上下文面板
 *
 * 紧凑列表展示多篇选中论文的标题、作者、年份、状态。
 * 新增论文有独立淡入动画，已有论文不重渲染。
 */

import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueries } from '@tanstack/react-query';
import { FileText, CheckCircle, Clock } from 'lucide-react';
import { getAPI } from '../../../core/ipc/bridge';
import { useAuthorDisplayThreshold, formatAuthorShort } from '../../../core/hooks/useAuthorDisplay';

const scrollContainerStyle: React.CSSProperties = { overflowY: 'auto', height: '100%' };
const headerStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  borderBottom: '1px solid var(--border-subtle)',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};
const accentIconStyle: React.CSSProperties = { color: 'var(--accent-color)' };
const loadingStyle: React.CSSProperties = { padding: 12, fontSize: 'var(--text-xs)', color: 'var(--text-muted)' };
const paperItemStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid var(--border-subtle)',
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
};
const paperItemNewStyle: React.CSSProperties = {
  ...paperItemStyle,
  animation: 'ctx-enter var(--duration-normal) var(--easing-default)',
};
const titleStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  color: 'var(--text-primary)',
  lineHeight: 1.4,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};
const metaRowStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-muted)',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};
const statusGroupStyle: React.CSSProperties = { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 3 };
const successIconStyle: React.CSSProperties = { color: 'var(--success)' };
const warningIconStyle: React.CSSProperties = { color: 'var(--warning)' };
const hintStyle: React.CSSProperties = {
  padding: '12px',
  fontSize: 'var(--text-xs)',
  color: 'var(--text-muted)',
  textAlign: 'center',
  lineHeight: 1.5,
};

interface MultiPaperPaneProps {
  paperIds: string[];
}

export const MultiPaperPane = React.memo(function MultiPaperPane({ paperIds }: MultiPaperPaneProps) {
  const { t } = useTranslation();
  const authorThreshold = useAuthorDisplayThreshold();

  // 追踪上一帧已有的 ID，用于判断哪些是新增的
  const prevIdsRef = useRef<Set<string>>(new Set());

  const queries = useQueries({
    queries: paperIds.map((id) => ({
      queryKey: ['papers', 'detail', id],
      queryFn: () => getAPI().db.papers.get(id),
      staleTime: 60_000,
    })),
  });

  const allLoading = queries.every((q) => q.isLoading);
  const papers = queries
    .map((q) => q.data)
    .filter((p): p is NonNullable<typeof p> => p != null);

  // 计算新增 ID 集合（本帧有、上一帧没有）
  const currentIds = new Set(paperIds);
  const newIds = new Set(paperIds.filter((id) => !prevIdsRef.current.has(id)));

  // commit：下一帧开始时这些就不算"新"了
  useEffect(() => {
    prevIdsRef.current = currentIds;
  });

  return (
    <div style={scrollContainerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <FileText size={13} style={accentIconStyle} />
        {t('context.multiPaper.title', { count: paperIds.length })}
      </div>

      {allLoading && (
        <div style={loadingStyle}>
          {t('context.paperInfo.loading')}
        </div>
      )}

      {/* Paper list */}
      {papers.map((paper) => {
        const authorStr = formatAuthorShort(
          paper.authors.map((a) => a.name),
          authorThreshold,
        ) || t('context.paperInfo.unknownAuthor');
        const analyzed = paper.analysisStatus === 'completed';
        const isNew = newIds.has(paper.id);
        return (
          <div key={paper.id} style={isNew ? paperItemNewStyle : paperItemStyle}>
            {/* Title */}
            <div style={titleStyle}>
              {paper.title}
            </div>

            {/* Author + year + status */}
            <div style={metaRowStyle}>
              <span>
                {authorStr}
                {paper.year ? `, ${paper.year}` : ''}
              </span>
              <span style={statusGroupStyle}>
                {analyzed ? (
                  <CheckCircle size={11} style={successIconStyle} />
                ) : (
                  <Clock size={11} style={warningIconStyle} />
                )}
                <span
                  style={{
                    fontSize: 10,
                    padding: '0 4px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: analyzed ? 'rgba(34,197,94,0.12)' : 'rgba(234,179,8,0.12)',
                    color: analyzed ? 'var(--success)' : 'var(--warning)',
                  }}
                >
                  {paper.analysisStatus}
                </span>
              </span>
            </div>
          </div>
        );
      })}

      {/* Hint */}
      <div style={hintStyle}>
        {t('context.multiPaper.hint')}
      </div>
    </div>
  );
});
