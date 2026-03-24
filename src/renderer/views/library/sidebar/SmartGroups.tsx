/**
 * SmartGroups — 智能分组列表（§2.2）
 *
 * 9 个预定义动态过滤器，使用 usePaperCounts() 聚合计数。
 */

import React from 'react';
import { Folder, Star, AlertTriangle, Clock, Paperclip } from 'lucide-react';
import { useAppStore } from '../../../core/store';
import type { PaperCounts } from '../../../../shared-types/models';

interface SmartGroupItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  getCount: (counts: PaperCounts | null) => number | null;
}

const SMART_GROUPS: SmartGroupItem[] = [
  {
    id: 'all',
    label: 'All Papers',
    icon: <Folder size={14} />,
    getCount: (c) => c?.total ?? null,
  },
  {
    id: 'seeds',
    label: 'Seeds',
    icon: <Star size={14} style={{ color: '#3B82F6' }} />,
    getCount: (c) => c?.byRelevance.seed ?? null,
  },
  {
    id: 'high',
    label: 'High',
    icon: <Folder size={14} style={{ color: '#22C55E' }} />,
    getCount: (c) => c?.byRelevance.high ?? null,
  },
  {
    id: 'medium',
    label: 'Medium',
    icon: <Folder size={14} style={{ color: '#F59E0B' }} />,
    getCount: (c) => c?.byRelevance.medium ?? null,
  },
  {
    id: 'low',
    label: 'Low',
    icon: <Folder size={14} style={{ color: '#9CA3AF' }} />,
    getCount: (c) => c?.byRelevance.low ?? null,
  },
  {
    id: 'excluded',
    label: 'Excluded',
    icon: <Folder size={14} style={{ color: '#EF4444' }} />,
    getCount: (c) => c?.byRelevance.excluded ?? null,
  },
  {
    id: 'pending_analysis',
    label: 'Pending Analysis',
    icon: <Clock size={14} style={{ color: '#F59E0B' }} />,
    getCount: (c) => c?.byAnalysisStatus.not_started ?? null,
  },
  {
    id: 'needs_review',
    label: 'Needs Review',
    icon: <AlertTriangle size={14} style={{ color: '#F59E0B' }} />,
    getCount: (c) => c?.byAnalysisStatus.needs_review ?? null,
  },
  {
    id: 'no_fulltext',
    label: 'No Fulltext',
    icon: <Paperclip size={14} style={{ color: '#9CA3AF' }} />,
    getCount: (c) =>
      c ? (c.byFulltextStatus.failed + c.byFulltextStatus.not_attempted) : null,
  },
];

interface SmartGroupsProps {
  counts: PaperCounts | null;
}

export function SmartGroups({ counts }: SmartGroupsProps) {
  const activeGroupId = useAppStore((s) => s.activeGroupId);
  const activeGroupType = useAppStore((s) => s.activeGroupType);
  const setActiveGroup = useAppStore((s) => s.setActiveGroup);
  const deselectAllPapers = useAppStore((s) => s.deselectAllPapers);

  const handleClick = (groupId: string) => {
    setActiveGroup(groupId, 'smart');
    deselectAllPapers();
  };

  return (
    <div role="listbox" aria-label="智能分组">
      {SMART_GROUPS.map((group) => {
        const isActive = activeGroupType === 'smart' && activeGroupId === group.id;
        const count = group.getCount(counts);

        return (
          <button
            key={group.id}
            role="option"
            aria-selected={isActive}
            onClick={() => handleClick(group.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '5px 12px 5px 20px',
              background: isActive ? 'var(--accent-color-10)' : 'none',
              border: 'none',
              color: isActive ? 'var(--accent-color)' : 'var(--text-primary)',
              fontSize: 'var(--text-sm)',
              cursor: 'pointer',
              textAlign: 'left',
              borderRadius: 0,
            }}
          >
            {group.icon}
            <span style={{ flex: 1 }}>{group.label}</span>
            {count !== null && (
              <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
