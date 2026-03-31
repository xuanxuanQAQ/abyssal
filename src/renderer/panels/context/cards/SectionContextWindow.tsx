/**
 * SectionContextWindow — 写作论证上下文（§9.2）
 *
 * 显示：前序节摘要 / 当前节 / 后续节标题
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronUp, ChevronDown, Minus } from 'lucide-react';
import type { WritingContext } from '../../../../shared-types/models';

interface SectionContextWindowProps {
  sectionId: string;
  sectionTitle: string;
  writingContext: WritingContext;
}

// ── Static styles ──

const containerStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid var(--border-subtle)',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: 8,
};

const precedingContainerStyle: React.CSSProperties = {
  marginBottom: 8,
};

const subLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 'var(--text-xs)',
  color: 'var(--text-muted)',
  marginBottom: 2,
};

const precedingSummaryStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--text-secondary)',
  lineHeight: 1.5,
  maxHeight: 48,
  overflow: 'hidden',
  padding: '4px 8px',
  backgroundColor: 'var(--bg-surface-low)',
  borderRadius: 'var(--radius-sm)',
};

const currentSectionRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 'var(--text-xs)',
  marginBottom: 8,
};

const accentIconStyle: React.CSSProperties = {
  color: 'var(--accent-color)',
};

const currentSectionLabelStyle: React.CSSProperties = {
  fontWeight: 500,
  color: 'var(--text-primary)',
};

const followingTitleStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--text-muted)',
  padding: '2px 8px 2px 16px',
};

export const SectionContextWindow = React.memo(function SectionContextWindow({
  sectionId: _sectionId,
  sectionTitle,
  writingContext,
}: SectionContextWindowProps) {
  const { t } = useTranslation();
  return (
    <div style={containerStyle}>
      <div style={sectionTitleStyle}>
        {t('context.sectionContext.title')}
      </div>

      {/* 前序节摘要 */}
      {writingContext.precedingSummary && (
        <div style={precedingContainerStyle}>
          <div style={subLabelStyle}>
            <ChevronUp size={10} /> {t('context.sectionContext.precedingSummary')}:
          </div>
          <div style={precedingSummaryStyle}>
            {writingContext.precedingSummary}
          </div>
        </div>
      )}

      {/* 当前节 */}
      <div style={currentSectionRowStyle}>
        <Minus size={10} style={accentIconStyle} />
        <span style={currentSectionLabelStyle}>
          {t('context.sectionContext.currentSection')}: {sectionTitle}
        </span>
      </div>

      {/* 后续节 */}
      {writingContext.followingSectionTitles.length > 0 && (
        <div>
          <div style={subLabelStyle}>
            <ChevronDown size={10} /> {t('context.sectionContext.followingSections')}:
          </div>
          {writingContext.followingSectionTitles.map((title, i) => (
            <div key={i} style={followingTitleStyle}>
              {title}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
