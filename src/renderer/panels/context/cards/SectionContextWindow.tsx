/**
 * SectionContextWindow — 写作论证上下文（§9.2）
 *
 * 显示：前序节摘要 / 当前节 / 后续节标题
 */

import React from 'react';
import { ChevronUp, ChevronDown, Minus } from 'lucide-react';
import type { WritingContext } from '../../../../shared-types/models';

interface SectionContextWindowProps {
  sectionId: string;
  sectionTitle: string;
  writingContext: WritingContext;
}

export function SectionContextWindow({
  sectionId: _sectionId,
  sectionTitle,
  writingContext,
}: SectionContextWindowProps) {
  return (
    <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
      <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
        📋 论证上下文
      </div>

      {/* 前序节摘要 */}
      {writingContext.precedingSummary && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 2 }}>
            <ChevronUp size={10} /> 前序节摘要:
          </div>
          <div
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
              maxHeight: 48,
              overflow: 'hidden',
              padding: '4px 8px',
              backgroundColor: 'var(--bg-surface-low)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {writingContext.precedingSummary}
          </div>
        </div>
      )}

      {/* 当前节 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)', marginBottom: 8 }}>
        <Minus size={10} style={{ color: 'var(--accent-color)' }} />
        <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
          当前节: {sectionTitle}
        </span>
      </div>

      {/* 后续节 */}
      {writingContext.followingSectionTitles.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 2 }}>
            <ChevronDown size={10} /> 后续节:
          </div>
          {writingContext.followingSectionTitles.map((title, i) => (
            <div
              key={i}
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--text-muted)',
                padding: '2px 8px 2px 16px',
              }}
            >
              {title}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
