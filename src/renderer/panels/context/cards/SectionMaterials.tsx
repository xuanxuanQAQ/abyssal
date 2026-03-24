/**
 * SectionMaterials — 写作素材卡片列表（§9.3）
 *
 * 包含 RAG 结果 + 私有知识库匹配
 * 顶部有"刷新素材"按钮
 */

import React from 'react';
import { RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { RAGResultCard } from './RAGResultCard';
import type { WritingContext } from '../../../../shared-types/models';

interface SectionMaterialsProps {
  sectionId: string;
  sectionTitle?: string;
  writingContext: WritingContext;
}

export function SectionMaterials({
  sectionId,
  sectionTitle,
  writingContext,
}: SectionMaterialsProps) {
  const queryClient = useQueryClient();

  const handleRefresh = () => {
    queryClient.invalidateQueries({
      queryKey: ['rag', 'writingContext', sectionId],
    });
  };

  const hasResults =
    writingContext.ragPassages.length > 0 || writingContext.privateKBMatches.length > 0;

  return (
    <div>
      {/* 标题 + 刷新 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)' }}>
          写作素材
        </span>
        <button
          onClick={handleRefresh}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            fontSize: 'var(--text-xs)',
            cursor: 'pointer',
          }}
        >
          <RefreshCw size={10} /> 刷新素材
        </button>
      </div>

      {!hasResults ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
          暂无相关素材
        </div>
      ) : (
        <>
          {/* RAG 结果 */}
          {writingContext.ragPassages.length > 0 && (
            <div>
              <div style={{ padding: '6px 12px', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                文献检索 ({writingContext.ragPassages.length})
              </div>
              {writingContext.ragPassages.map((r) => (
                <RAGResultCard key={r.chunkId} result={r} sectionTitle={sectionTitle} />
              ))}
            </div>
          )}

          {/* 私有知识库匹配 */}
          {writingContext.privateKBMatches.length > 0 && (
            <div>
              <div style={{ padding: '6px 12px', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                私有知识库 ({writingContext.privateKBMatches.length})
              </div>
              {writingContext.privateKBMatches.map((match) => (
                <div
                  key={match.docId}
                  style={{
                    margin: '4px 12px',
                    padding: '8px 10px',
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 'var(--text-xs)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                    <span style={{ fontWeight: 500 }}>{match.docId}</span>
                    <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>
                      相关度: {match.score.toFixed(2)}
                    </span>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
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
}
