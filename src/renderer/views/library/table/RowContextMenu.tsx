/**
 * RowContextMenu — 右键上下文菜单（§6.2）
 *
 * Radix ContextMenu。多选时变为批量操作。
 */

import React from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { useAppStore } from '../../../core/store';
import { useUpdatePaper, useDeletePaper } from '../../../core/ipc/hooks/usePapers';
import { useAcquireFulltext, useLinkLocalPdf } from '../../../core/ipc/hooks/useAcquire';
import { useStartPipeline } from '../../../core/ipc/hooks/usePipeline';
import type { Paper } from '../../../../shared-types/models';
import type { Relevance } from '../../../../shared-types/enums';
import { RELEVANCE_CONFIG as RELEVANCE_OPTIONS } from '../shared/relevanceConfig';

interface RowContextMenuProps {
  paper: Paper;
  isSelected: boolean;
  children: React.ReactNode;
}

const menuContentStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  padding: 4,
  minWidth: 200,
  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
  zIndex: 35,
};

const menuItemStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  fontSize: 'var(--text-sm)',
  color: 'var(--text-primary)',
  outline: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

export function RowContextMenu({ paper, isSelected, children }: RowContextMenuProps) {
  const { t } = useTranslation();
  const navigateTo = useAppStore((s) => s.navigateTo);
  const updatePaper = useUpdatePaper();
  const deletePaper = useDeletePaper();
  const acquireFulltext = useAcquireFulltext();
  const linkLocalPdf = useLinkLocalPdf();
  const startPipeline = useStartPipeline();

  const handleNavigateReader = () => {
    navigateTo({ type: 'paper', id: paper.id, view: 'reader' });
  };

  const handleNavigateAnalysis = () => {
    navigateTo({ type: 'paper', id: paper.id, view: 'analysis' });
  };

  const handleNavigateGraph = () => {
    navigateTo({ type: 'graph', focusNodeId: paper.id });
  };

  const handleSetRelevance = (rel: Relevance) => {
    updatePaper.mutate({ id: paper.id, patch: { relevance: rel } });
  };

  const handleDelete = () => {
    // TODO: 确认 Dialog
    deletePaper.mutate(paper.id);
  };

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content style={menuContentStyle}>
          <ContextMenu.Item
            style={menuItemStyle}
            onSelect={handleNavigateReader}
            disabled={paper.fulltextStatus !== 'available'}
          >
            {t('library.contextMenu.openInReader')}
          </ContextMenu.Item>
          <ContextMenu.Item
            style={menuItemStyle}
            onSelect={handleNavigateAnalysis}
            disabled={paper.analysisStatus !== 'completed'}
          >
            {t('library.contextMenu.viewAnalysisReport')}
          </ContextMenu.Item>
          <ContextMenu.Item
            style={menuItemStyle}
            onSelect={handleNavigateGraph}
          >
            {t('library.contextMenu.locateInGraph')}
          </ContextMenu.Item>

          <ContextMenu.Separator style={{ height: 1, backgroundColor: 'var(--border-subtle)', margin: '4px 0' }} />

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger style={menuItemStyle}>
              {t('library.contextMenu.setRelevance')}
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent style={menuContentStyle}>
                {RELEVANCE_OPTIONS.map((opt) => (
                  <ContextMenu.Item
                    key={opt.value}
                    style={menuItemStyle}
                    onSelect={() => handleSetRelevance(opt.value)}
                  >
                    {opt.label}
                    {paper.relevance === opt.value && ' ✓'}
                  </ContextMenu.Item>
                ))}
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Item
            style={menuItemStyle}
            onSelect={() => {
              if (paper.fulltextStatus === 'available') {
                toast(t('library.contextMenu.alreadyAcquired'));
                return;
              }
              if (paper.fulltextStatus === 'pending') {
                toast(t('library.contextMenu.acquireInProgress'));
                return;
              }
              acquireFulltext.mutate(paper.id);
            }}
          >
            {t('library.contextMenu.acquireFulltext')}
          </ContextMenu.Item>
          <ContextMenu.Item
            style={menuItemStyle}
            onSelect={() => {
              if (paper.fulltextStatus === 'available') {
                toast(t('library.contextMenu.alreadyAcquired'));
                return;
              }
              linkLocalPdf.mutate({ paperId: paper.id });
            }}
          >
            {t('library.contextMenu.linkLocalPdf')}
          </ContextMenu.Item>
          <ContextMenu.Item
            style={menuItemStyle}
            onSelect={() => {
              if (paper.analysisStatus === 'completed') {
                toast(t('library.contextMenu.alreadyAnalyzed'));
                return;
              }
              if (paper.analysisStatus === 'in_progress') {
                toast(t('library.contextMenu.analysisInProgress'));
                return;
              }
              if (paper.fulltextStatus !== 'available') {
                toast(t('library.contextMenu.fulltextRequired'));
                return;
              }
              startPipeline.mutate({ workflow: 'analyze', config: { paperIds: [paper.id] } });
            }}
          >
            {t('library.contextMenu.triggerAnalysis')}
          </ContextMenu.Item>

          <ContextMenu.Separator style={{ height: 1, backgroundColor: 'var(--border-subtle)', margin: '4px 0' }} />

          <ContextMenu.Item style={menuItemStyle}>
            {t('library.contextMenu.editTags')}
          </ContextMenu.Item>
          <ContextMenu.Item style={menuItemStyle}>
            {/* TODO: 需要 bibliography 模块 */}
            {t('library.contextMenu.copyBibtex')}
          </ContextMenu.Item>

          <ContextMenu.Separator style={{ height: 1, backgroundColor: 'var(--border-subtle)', margin: '4px 0' }} />

          <ContextMenu.Item
            style={{ ...menuItemStyle, color: 'var(--danger)' }}
            onSelect={handleDelete}
          >
            {t('common.delete')}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
