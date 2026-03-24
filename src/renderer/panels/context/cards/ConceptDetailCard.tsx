/**
 * ConceptDetailCard — 概念详情卡片
 *
 * 从 useConceptFramework 缓存中读取概念的名称、描述、
 * 关联论文数等信息。替代之前在 ConceptPane / GraphConceptNodePane 中的占位符。
 */

import React from 'react';
import { Lightbulb } from 'lucide-react';
import { useConceptFramework } from '../../../core/ipc/hooks/useConcepts';

interface ConceptDetailCardProps {
  conceptId: string;
}

export function ConceptDetailCard({ conceptId }: ConceptDetailCardProps) {
  const { data: framework, isLoading, isError } = useConceptFramework();

  const concept = framework?.concepts?.find(
    (c) => c.id === conceptId
  );

  return (
    <div style={{ padding: 12, borderBottom: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <Lightbulb size={14} style={{ color: 'var(--accent-color)' }} />
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
          {concept?.name ?? conceptId}
        </span>
      </div>

      {isLoading && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          加载概念信息…
        </div>
      )}

      {isError && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)' }}>
          加载概念信息失败
        </div>
      )}

      {concept && (
        <>
          {concept.description && (
            <p style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--text-secondary)',
              lineHeight: 'var(--leading-sm)',
              marginTop: 4,
            }}>
              {concept.description}
            </p>
          )}
          {concept.parentId && (
            <div style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--text-muted)',
              marginTop: 6,
            }}>
              父概念: {concept.parentId}
            </div>
          )}
        </>
      )}

      {!isLoading && !isError && !concept && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          概念框架中未找到此概念
        </div>
      )}
    </div>
  );
}
