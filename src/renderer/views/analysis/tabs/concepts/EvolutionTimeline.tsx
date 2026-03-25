/**
 * EvolutionTimeline — 概念演化时间线（§2.4）
 */

import React, { useState } from 'react';
import type { HistoryEntry } from '../../../../../shared-types/models';
import type { ConceptHistoryEventType } from '../../../../../shared-types/enums';

const EVENT_ICONS: Record<ConceptHistoryEventType, string> = {
  created: '🌱',
  definition_refined: '✏️',
  keywords_added: '🏷️',
  keywords_removed: '🏷️',
  maturity_upgraded: '⬆️',
  maturity_downgraded: '⬇️',
  merged_from: '🔗',
  split_into: '✂️',
  parent_changed: '📂',
  deprecated: '🗑️',
};

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

function getSummary(entry: HistoryEntry): string {
  const d = entry.details as Record<string, string | undefined>;
  switch (entry.type) {
    case 'created': return '创建';
    case 'definition_refined': return `定义修改：'${(d.old ?? '').slice(0, 20)}...' → '${(d.new ?? '').slice(0, 20)}...'`;
    case 'keywords_added': return `新增关键词：${d.keywords ?? ''}`;
    case 'keywords_removed': return `移除关键词：${d.keywords ?? ''}`;
    case 'maturity_upgraded': return `成熟度提升：${d.old ?? ''} → ${d.new ?? ''}`;
    case 'maturity_downgraded': return `成熟度降级：${d.old ?? ''} → ${d.new ?? ''}`;
    case 'merged_from': return `合并自概念 '${d.source_concept_name ?? ''}'`;
    case 'split_into': return `拆分为 '${d.child1 ?? ''}' 和 '${d.child2 ?? ''}'`;
    case 'parent_changed': return `层级调整：父概念从 '${d.old_parent ?? ''}' 变为 '${d.new_parent ?? ''}'`;
    case 'deprecated': return '已废弃';
    default: return entry.type;
  }
}

interface EvolutionTimelineProps {
  history: HistoryEntry[];
}

export function EvolutionTimeline({ history }: EvolutionTimelineProps) {
  const [showAll, setShowAll] = useState(false);
  const sorted = [...history].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const visible = showAll ? sorted : sorted.slice(0, 5);
  const hiddenCount = sorted.length - 5;

  if (sorted.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>暂无历史记录</div>;
  }

  return (
    <div style={{ position: 'relative', paddingLeft: 20 }}>
      {/* Vertical line */}
      <div style={{ position: 'absolute', left: 7, top: 4, bottom: 4, width: 2, backgroundColor: 'var(--border-subtle)' }} />

      {visible.map((entry, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10, position: 'relative' }}>
          {/* Dot */}
          <span style={{ position: 'absolute', left: -17, top: 2, fontSize: 12 }}>
            {EVENT_ICONS[entry.type] ?? '●'}
          </span>

          <div>
            <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.4 }}>
              {getSummary(entry)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }} title={entry.timestamp}>
              {formatRelativeTime(entry.timestamp)}
            </div>
          </div>
        </div>
      ))}

      {!showAll && hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(true)}
          style={{
            background: 'none', border: 'none', color: 'var(--accent-color)',
            fontSize: 12, cursor: 'pointer', padding: 0,
          }}
        >
          查看更早 {hiddenCount} 条记录
        </button>
      )}
    </div>
  );
}
