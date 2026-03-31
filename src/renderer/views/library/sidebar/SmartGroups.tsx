/**
 * SmartGroups — 智能分组列表（§2.2）
 *
 * 9 个预定义动态过滤器，使用 usePaperCounts() 聚合计数。
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Folder, Star, AlertTriangle, Clock, Paperclip } from 'lucide-react';
import { useAppStore } from '../../../core/store';
import type { PaperCounts } from '../../../../shared-types/models';

interface SmartGroupItem {
  id: string;
  labelKey: string;
  icon: React.ReactNode;
  getCount: (counts: PaperCounts | null) => number | null;
}

const SMART_GROUPS: SmartGroupItem[] = [
  {
    id: 'all',
    labelKey: 'library.smartGroups.all',
    icon: <Folder size={14} />,
    getCount: (c) => c?.total ?? null,
  },
  {
    id: 'seeds',
    labelKey: 'library.smartGroups.seeds',
    icon: <Star size={14} style={{ color: '#3B82F6' }} />,
    getCount: (c) => c?.byRelevance.seed ?? null,
  },
  {
    id: 'high',
    labelKey: 'library.smartGroups.high',
    icon: <Folder size={14} style={{ color: '#22C55E' }} />,
    getCount: (c) => c?.byRelevance.high ?? null,
  },
  {
    id: 'medium',
    labelKey: 'library.smartGroups.medium',
    icon: <Folder size={14} style={{ color: '#F59E0B' }} />,
    getCount: (c) => c?.byRelevance.medium ?? null,
  },
  {
    id: 'low',
    labelKey: 'library.smartGroups.low',
    icon: <Folder size={14} style={{ color: '#9CA3AF' }} />,
    getCount: (c) => c?.byRelevance.low ?? null,
  },
  {
    id: 'excluded',
    labelKey: 'library.smartGroups.excluded',
    icon: <Folder size={14} style={{ color: '#EF4444' }} />,
    getCount: (c) => c?.byRelevance.excluded ?? null,
  },
  {
    id: 'pending_analysis',
    labelKey: 'library.smartGroups.pendingAnalysis',
    icon: <Clock size={14} style={{ color: '#F59E0B' }} />,
    getCount: (c) => c?.byAnalysisStatus.not_started ?? null,
  },
  {
    id: 'needs_review',
    labelKey: 'library.smartGroups.needsReview',
    icon: <AlertTriangle size={14} style={{ color: '#F59E0B' }} />,
    getCount: (c) => c?.byAnalysisStatus.needs_review ?? null,
  },
  {
    id: 'no_fulltext',
    labelKey: 'library.smartGroups.noFulltext',
    icon: <Paperclip size={14} style={{ color: '#9CA3AF' }} />,
    getCount: (c) =>
      c ? (c.byFulltextStatus.failed + c.byFulltextStatus.not_attempted) : null,
  },
];

interface SmartGroupsProps {
  counts: PaperCounts | null;
}

export function SmartGroups({ counts }: SmartGroupsProps) {
  const { t } = useTranslation();
  const activeGroupId = useAppStore((s) => s.activeGroupId);
  const activeGroupType = useAppStore((s) => s.activeGroupType);
  const setActiveGroup = useAppStore((s) => s.setActiveGroup);
  const deselectAllPapers = useAppStore((s) => s.deselectAllPapers);

  const handleClick = (groupId: string) => {
    setActiveGroup(groupId, 'smart');
    deselectAllPapers();
  };

  return (
    <div role="listbox" aria-label={t('library.sidebar.smartGroups')}>
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
            <span style={{ flex: 1 }}>{t(group.labelKey)}</span>
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
