/**
 * WritingSelectionPane — 写作选区上下文面板
 *
 * 当 ContextSource 为 writing-selection 时渲染。
 * 在原有 section materials 上方显示"当前操作对象"描述，
 * 实现非破坏性展开（Accordion 式），不整体替换 section 内容。
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { PenTool } from 'lucide-react';
import { WritingSectionPane } from './WritingSectionPane';
import { useSectionTitle } from '../../../views/writing/hooks/useSectionTitle';

interface WritingSelectionPaneProps {
  articleId: string;
  sectionId: string;
  from: number;
  to: number;
  selectedText: string;
  draftId?: string;
}

export const WritingSelectionPane = React.memo(function WritingSelectionPane({
  articleId,
  sectionId,
  from: _from,
  to: _to,
  selectedText,
  draftId,
}: WritingSelectionPaneProps) {
  const { t } = useTranslation();
  const resolvedSectionTitle = useSectionTitle(articleId, sectionId);
  const sectionLabel = resolvedSectionTitle ?? t('context.header.section');

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 选区摘要区 — 非破坏性展开在 section materials 上方 */}
      <div
        className="writing-selection-summary"
        style={{
          flexShrink: 0,
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'color-mix(in srgb, var(--accent-color) 4%, var(--bg-surface))',
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 8,
        }}>
          <PenTool size={13} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />
          <span style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-primary)',
            letterSpacing: '0.01em',
          }}>
            {t('context.writingSelection.title', { defaultValue: '当前选中段落' })}
          </span>
          <span style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            marginLeft: 'auto',
          }}>
            {sectionLabel}
          </span>
        </div>

        <div
          style={{
            fontSize: 12,
            lineHeight: 1.6,
            color: 'var(--text-secondary)',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 4,
            WebkitBoxOrient: 'vertical',
            padding: '8px 10px',
            background: 'color-mix(in srgb, var(--bg-surface-lowest) 60%, transparent)',
            borderRadius: 8,
            border: '1px solid color-mix(in srgb, var(--accent-color) 10%, var(--border-subtle))',
          }}
        >
          {selectedText || t('context.writingSelection.empty', { defaultValue: '（空选区）' })}
        </div>
      </div>

      {/* 下方继续展示 section materials */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <WritingSectionPane
          articleId={articleId}
          sectionId={sectionId}
          {...(draftId ? { draftId } : {})}
        />
      </div>
    </div>
  );
});
