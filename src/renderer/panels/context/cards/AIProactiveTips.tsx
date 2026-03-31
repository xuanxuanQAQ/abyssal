/**
 * AIProactiveTips — Reader 专属 AI 主动提示卡片列表（§3.5）
 *
 * 数据源：useAppStore.proactiveTips
 * 事件源：pipeline:readerPageChanged（TODO: Sub-Doc 5 Reader 视图翻页事件）
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Lightbulb, X, BookmarkPlus } from 'lucide-react';
import { useAppStore } from '../../../core/store';

const containerStyle: React.CSSProperties = { padding: '8px 0' };
const sectionHeaderStyle: React.CSSProperties = { padding: '4px 12px', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 600 };
const cardStyle: React.CSSProperties = {
  margin: '4px 12px',
  padding: '8px 10px',
  backgroundColor: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--text-xs)',
};
const titleRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 };
const lightbulbStyle: React.CSSProperties = { color: 'var(--warning)' };
const titleTextStyle: React.CSSProperties = { fontWeight: 500, flex: 1 };
const dismissBtnStyle: React.CSSProperties = { background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 1 };
const descStyle: React.CSSProperties = { color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 6 };
const confidenceRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 };
const confidenceLabelStyle: React.CSSProperties = { color: 'var(--text-muted)' };
const confidenceTrackStyle: React.CSSProperties = { flex: 1, height: 4, backgroundColor: 'var(--bg-surface-low)', borderRadius: 2, overflow: 'hidden' };
const actionsRowStyle: React.CSSProperties = { display: 'flex', gap: 8 };
const primaryBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px',
  border: '1px solid var(--accent-color)', borderRadius: 'var(--radius-sm)',
  background: 'none', color: 'var(--accent-color)', fontSize: 'var(--text-xs)', cursor: 'pointer',
};
const secondaryBtnStyle: React.CSSProperties = {
  padding: '3px 8px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
  background: 'none', color: 'var(--text-secondary)', fontSize: 'var(--text-xs)', cursor: 'pointer',
};

export const AIProactiveTips = React.memo(function AIProactiveTips() {
  const { t } = useTranslation();
  const tips = useAppStore((s) => s.proactiveTips);
  const removeProactiveTip = useAppStore((s) => s.removeProactiveTip);
  const navigateTo = useAppStore((s) => s.navigateTo);

  if (tips.length === 0) return null;

  return (
    <div style={containerStyle}>
      <div style={sectionHeaderStyle}>
        {t('context.proactiveTips.sectionTitle')}
      </div>
      {tips.map((tip) => (
        <div key={tip.id} style={cardStyle}>
          {/* 标题行 */}
          <div style={titleRowStyle}>
            <Lightbulb size={12} style={lightbulbStyle} />
            <span style={titleTextStyle}>{t('context.proactiveTips.title')}</span>
            <button onClick={() => removeProactiveTip(tip.id)} title={t('context.proactiveTips.dismiss')} style={dismissBtnStyle}>
              <X size={10} />
            </button>
          </div>

          {/* 描述 */}
          <div style={descStyle}>
            {t('context.proactiveTips.description', {
              page: tip.page,
              sectionRef: tip.sectionRef,
              conceptId: tip.conceptId,
              conceptName: tip.conceptName,
            })}
          </div>

          {/* 置信度 */}
          <div style={confidenceRowStyle}>
            <span style={confidenceLabelStyle}>{t('context.proactiveTips.confidence')}:</span>
            <div style={confidenceTrackStyle}>
              <div style={{ height: '100%', width: `${tip.confidence * 100}%`, backgroundColor: 'var(--accent-color)' }} />
            </div>
            <span>{tip.confidence.toFixed(2)}</span>
          </div>

          {/* 操作按钮 */}
          <div style={actionsRowStyle}>
            <button
              onClick={() => { removeProactiveTip(tip.id); }}
              style={primaryBtnStyle}
            >
              <BookmarkPlus size={10} /> {t('context.proactiveTips.annotate')}
            </button>
            <button
              onClick={() => { navigateTo({ type: 'concept', id: tip.conceptId }); }}
              style={secondaryBtnStyle}
            >
              {t('context.proactiveTips.viewConcept')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
});
