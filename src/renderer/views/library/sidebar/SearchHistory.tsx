/**
 * SearchHistory — 搜索历史分组（§2.4）
 *
 * 每次 discover 工作流后系统自动创建的历史分组。
 * TODO: 需要 discover_runs 表
 */

import React from 'react';
import { Search } from 'lucide-react';
import { useDiscoverRunList } from '../../../core/ipc/hooks/useDiscoverRuns';
import { useAppStore } from '../../../core/store';

export function SearchHistory() {
  const { data: runs } = useDiscoverRunList();
  const activeGroupId = useAppStore((s) => s.activeGroupId);
  const activeGroupType = useAppStore((s) => s.activeGroupType);
  const setActiveGroup = useAppStore((s) => s.setActiveGroup);
  const deselectAllPapers = useAppStore((s) => s.deselectAllPapers);

  if (!runs || runs.length === 0) {
    return (
      <div style={{ padding: '8px 20px', color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
        暂无搜索历史
      </div>
    );
  }

  return (
    <div>
      {runs.map((run) => {
        const isActive = activeGroupType === 'search' && activeGroupId === run.runId;

        return (
          <button
            key={run.runId}
            onClick={() => {
              setActiveGroup(run.runId, 'search');
              deselectAllPapers();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              width: '100%',
              padding: '4px 12px 4px 20px',
              background: isActive ? 'var(--accent-color-10)' : 'none',
              border: 'none',
              color: isActive ? 'var(--accent-color)' : 'var(--text-primary)',
              fontSize: 'var(--text-sm)',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <Search size={12} style={{ color: 'var(--text-muted)' }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              &quot;{run.query}&quot;
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
              ({run.resultCount})
            </span>
          </button>
        );
      })}
    </div>
  );
}
