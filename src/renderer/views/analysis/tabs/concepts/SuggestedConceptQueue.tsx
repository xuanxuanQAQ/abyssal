/**
 * SuggestedConceptQueue — AI 概念建议队列（§2.3）
 */

import React from 'react';
import { Lightbulb, Check, X, Clock } from 'lucide-react';
import { useSuggestedConceptList, useDismissSuggestedConcept } from '../../../../core/ipc/hooks/useSuggestedConcepts';
import { MaturityBadge } from '../../../../shared/MaturityBadge';
import type { SuggestedConcept } from '../../../../../shared-types/models';

export function SuggestedConceptQueue() {
  const { data: suggestions } = useSuggestedConceptList();
  const dismissMutation = useDismissSuggestedConcept();

  const pending = suggestions?.filter((s) => s.status === 'pending') ?? [];

  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)', flexShrink: 0 }}>
      <div style={{
        padding: '8px 12px', fontSize: 11, fontWeight: 600,
        color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
        display: 'flex', alignItems: 'center', gap: 4,
      }}>
        <Lightbulb size={12} /> AI 建议
      </div>

      {pending.length === 0 ? (
        <div style={{ padding: '8px 12px 12px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          AI 尚未产生新概念建议。继续分析更多论文后，系统会识别概念框架中可能缺少的术语。
        </div>
      ) : (
        <div style={{ maxHeight: 200, overflow: 'auto' }}>
          {pending.map((s) => (
            <SuggestionItem key={s.id} suggestion={s} onDismiss={() => dismissMutation.mutate(s.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function SuggestionItem({ suggestion, onDismiss }: { suggestion: SuggestedConcept; onDismiss: () => void }) {
  return (
    <div style={{
      padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6,
      borderBottom: '1px solid var(--border-subtle)',
    }}>
      <span style={{ fontSize: 14 }}>💡</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
          {suggestion.term}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {suggestion.paperCount} 篇论文提到
        </div>
        {suggestion.closestExisting && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginTop: 2 }}>
            <MaturityBadge maturity={suggestion.closestExisting.maturity} size="sm" />
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{suggestion.closestExisting.conceptName}</span>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
        <button title="采纳" style={iconBtnStyle} onClick={() => { /* TODO: open CreateConceptDialog */ }}>
          <Check size={12} />
        </button>
        <button title="忽略" style={iconBtnStyle} onClick={onDismiss}>
          <X size={12} />
        </button>
        <button title="稍后" style={iconBtnStyle}>
          <Clock size={12} />
        </button>
      </div>
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 22, height: 22, border: '1px solid var(--border-subtle)',
  borderRadius: 4, backgroundColor: 'transparent', cursor: 'pointer',
  color: 'var(--text-secondary)',
};
