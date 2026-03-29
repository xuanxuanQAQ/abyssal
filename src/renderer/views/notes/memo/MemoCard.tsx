/**
 * MemoCard — 碎片笔记卡片（§3.2）
 */

import React, { useState } from 'react';
import { Pencil, Trash2, FileUp, Lightbulb } from 'lucide-react';
import type { Memo } from '../../../../shared-types/models';
import { useDeleteMemo, useUpgradeMemoToNote, useUpgradeMemoToConcept } from '../../../core/ipc/hooks/useMemos';

interface MemoCardProps {
  memo: Memo;
}

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

export function MemoCard({ memo }: MemoCardProps) {
  const [hovered, setHovered] = useState(false);
  const deleteMutation = useDeleteMemo();
  const upgradeToNoteMutation = useUpgradeMemoToNote();

  const handleDelete = () => {
    if (confirm('确定删除此碎片笔记？')) {
      deleteMutation.mutate(memo.id);
    }
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '10px 12px', marginBottom: 6,
        backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-md, 6px)',
        border: '1px solid var(--border-subtle)', position: 'relative',
        borderLeft: `3px solid ${memo.conceptIds.length > 0 ? 'var(--accent-color)' : 'var(--border-subtle)'}`,
      }}
    >
      {/* Text */}
      <div style={{
        fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5,
        display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        {memo.text}
      </div>

      {/* Tags row */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
        {memo.paperIds.map((pid) => (
          <span key={pid} style={tagStyle('#3B82F6')}>📄 {pid.slice(0, 8)}</span>
        ))}
        {memo.conceptIds.map((cid) => (
          <span key={cid} style={tagStyle('#10B981')}>◇ {cid.slice(0, 8)}</span>
        ))}
        {memo.tags.map((t) => (
          <span key={t} style={tagStyle('#6B7280')}>#{t}</span>
        ))}
      </div>

      {/* Linked note indicator */}
      {memo.linkedNoteIds.length > 0 && (
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--accent-color)' }}>
          已展开为笔记 →
        </div>
      )}

      {/* Timestamp */}
      <div style={{ position: 'absolute', top: 8, right: 10, fontSize: 11, color: 'var(--text-muted)' }}>
        {formatRelativeTime(memo.createdAt)}
      </div>

      {/* Hover actions */}
      {hovered && (
        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
          <ActionBtn icon={<Pencil size={12} />} label="编辑" onClick={() => { /* TODO: inline edit */ }} />
          <ActionBtn icon={<Trash2 size={12} />} label="删除" onClick={handleDelete} />
          <ActionBtn icon={<FileUp size={12} />} label="展开为笔记" onClick={() => upgradeToNoteMutation.mutate(memo.id)} />
          <ActionBtn icon={<Lightbulb size={12} />} label="升级为概念" onClick={() => { /* TODO: open UpgradeToConceptDialog */ }} />
        </div>
      )}
    </div>
  );
}

function ActionBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      title={label}
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 3, padding: '2px 6px',
        border: '1px solid var(--border-subtle)', borderRadius: 4,
        backgroundColor: 'var(--bg-surface)', color: 'var(--text-secondary)',
        fontSize: 11, cursor: 'pointer',
      }}
    >
      {icon} {label}
    </button>
  );
}

function tagStyle(color: string): React.CSSProperties {
  return {
    display: 'inline-block', padding: '1px 6px', borderRadius: 10,
    fontSize: 10, color, backgroundColor: `${color}12`, border: `1px solid ${color}30`,
  };
}
