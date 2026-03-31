/**
 * BatchActionBar — 多选批量操作栏（§9）
 *
 * 选中 ≥ 2 时底部滑入（200ms translateY）。
 * 操作：取消选择 / 设置相关性 / 获取全文 / 触发分析 / 导出 / 删除。
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { X, ChevronDown } from 'lucide-react';
import { useBatchUpdateRelevance, useBatchDeletePapers } from '../../../core/ipc/hooks/usePapers';
import { useAcquireBatch } from '../../../core/ipc/hooks/useAcquire';
import { useStartPipeline } from '../../../core/ipc/hooks/usePipeline';
import { useAppStore } from '../../../core/store';
import type { Paper } from '../../../../shared-types/models';
import type { Relevance } from '../../../../shared-types/enums';
import { RELEVANCE_CONFIG } from '../shared/relevanceConfig';

interface BatchActionBarProps {
  selectedCount: number;
  onDeselect: () => void;
  getSelectedIds: () => string[];
  papers: Paper[];
}

const RELEVANCE_OPTIONS = RELEVANCE_CONFIG;

export function BatchActionBar({
  selectedCount,
  onDeselect,
  getSelectedIds,
  papers,
}: BatchActionBarProps) {
  const { t } = useTranslation();
  const batchUpdateRelevance = useBatchUpdateRelevance();
  const batchDelete = useBatchDeletePapers();
  const acquireBatch = useAcquireBatch();
  const startPipeline = useStartPipeline();
  const activeTasks = useAppStore((s) => s.activeTasks);

  // 检查是否有正在运行的批量任务
  const runningTasks = Object.values(activeTasks).filter(
    (t) => t.status === 'running'
  );

  const handleSetRelevance = (rel: Relevance) => {
    const ids = getSelectedIds();
    batchUpdateRelevance.mutate({ ids, rel });
  };

  const handleDelete = () => {
    // TODO: 确认 Dialog
    const ids = getSelectedIds();
    batchDelete.mutate(ids);
    onDeselect();
  };

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 56,
        backgroundColor: 'var(--bg-surface)',
        borderTop: '1px solid var(--border-subtle)',
        boxShadow: '0 -2px 8px rgba(0,0,0,0.08)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 12,
        animation: 'slideUp 200ms ease-out',
        zIndex: 25,
      }}
    >
      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>
        {t('library.batch.selected', { count: selectedCount })}
      </span>

      <button
        onClick={onDeselect}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 10px',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          background: 'none',
          color: 'var(--text-secondary)',
          fontSize: 'var(--text-sm)',
          cursor: 'pointer',
        }}
      >
        <X size={12} /> {t('library.batch.deselect')}
      </button>

      <div style={{ flex: 1 }} />

      {/* 设置相关性 */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button style={actionButtonStyle}>
            {t('library.batch.setRelevance')} <ChevronDown size={10} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            sideOffset={4}
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: 4,
              minWidth: 140,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              zIndex: 35,
            }}
          >
            {RELEVANCE_OPTIONS.map((opt) => (
              <DropdownMenu.Item
                key={opt.value}
                onSelect={() => handleSetRelevance(opt.value)}
                style={{
                  padding: '6px 8px',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  fontSize: 'var(--text-sm)',
                  outline: 'none',
                }}
              >
                {opt.label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <button
        style={actionButtonStyle}
        disabled={acquireBatch.isPending}
        onClick={() => {
          const ids = getSelectedIds();
          acquireBatch.mutate(ids);
        }}
      >
        {acquireBatch.isPending ? t('library.batch.acquiring') : t('library.batch.acquireFulltext')}
      </button>
      <button
        style={actionButtonStyle}
        disabled={startPipeline.isPending}
        onClick={() => {
          const ids = getSelectedIds();
          startPipeline.mutate({ workflow: 'analyze', config: { paperIds: ids } });
        }}
      >
        {startPipeline.isPending ? t('library.batch.analyzing') : t('library.batch.triggerAnalysis')}
      </button>
      <button style={actionButtonStyle}>
        {/* TODO: 导出 BibTeX 功能 */}
        {t('library.batch.exportBibtex')}
      </button>
      <button
        onClick={handleDelete}
        style={{ ...actionButtonStyle, color: 'var(--danger)', borderColor: 'var(--danger)' }}
      >
        {t('common.delete')}
      </button>
    </div>
  );
}

const actionButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 10px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  background: 'none',
  color: 'var(--text-primary)',
  fontSize: 'var(--text-sm)',
  cursor: 'pointer',
};
