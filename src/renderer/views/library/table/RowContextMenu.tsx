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
import { useUpdatePaper, useDeletePaper, useResetProcess, useResetFulltext, useResetAnalysis } from '../../../core/ipc/hooks/usePapers';
import { useAcquireFulltext, useLinkLocalPdf } from '../../../core/ipc/hooks/useAcquire';
import { useStartPipeline } from '../../../core/ipc/hooks/usePipeline';
import { useDeferredMenuAction } from '../../../shared/useDeferredMenuAction';
import { useAppDialog } from '../../../shared/useAppDialog';
import type { Paper } from '../../../../shared-types/models';
import type { Relevance } from '../../../../shared-types/enums';
import { RELEVANCE_CONFIG as RELEVANCE_OPTIONS } from '../shared/relevanceConfig';

interface RowContextMenuProps {
  paper: Paper;
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

export function RowContextMenu({ paper, children }: RowContextMenuProps) {
  const { t } = useTranslation();
  const navigateTo = useAppStore((s) => s.navigateTo);
  const updatePaper = useUpdatePaper();
  const deletePaper = useDeletePaper();
  const acquireFulltext = useAcquireFulltext();
  const linkLocalPdf = useLinkLocalPdf();
  const resetProcess = useResetProcess();
  const resetFulltext = useResetFulltext();
  const resetAnalysis = useResetAnalysis();
  const startPipeline = useStartPipeline();
  const deferMenuAction = useDeferredMenuAction();
  const { confirm, dialog } = useAppDialog();

  // ── 状态派生 ──
  const hasFulltext = paper.fulltextStatus === 'available' || !!paper.fulltextPath;
  const hasText = !!paper.textPath;
  const hasAnalysis = paper.analysisStatus === 'completed';
  const isAcquiring = paper.fulltextStatus === 'pending';
  const isAnalyzing = paper.analysisStatus === 'in_progress';
  const paperTitle = typeof paper.title === 'string' && paper.title.trim().length > 0
    ? paper.title.trim()
    : t('common.paper');

  const handleSetRelevance = (rel: Relevance) => {
    deferMenuAction(() => {
      updatePaper.mutate({ id: paper.id, patch: { relevance: rel } });
    });
  };

  const handleDelete = () => {
    deferMenuAction(async () => {
      const confirmed = await confirm({
        title: t('common.delete'),
        description: t('library.contextMenu.deleteConfirm', { title: paperTitle }),
        confirmLabel: t('common.delete'),
        confirmTone: 'danger',
      });
      if (!confirmed) return;
      deletePaper.mutate(paper.id);
    });
  };

  const handleCopyBibtex = () => {
    deferMenuAction(() => {
      const pr = paper as unknown as Record<string, unknown>;
      const key = (pr['bibtexKey'] as string) ?? (pr['id'] as string) ?? 'unknown';
      const title = (pr['title'] as string) ?? '';
      const authors = (pr['authors'] as string) ?? '';
      const year = (pr['year'] as number) ?? 0;
      const doi = (pr['doi'] as string) ?? '';
      const bibtex = `@article{${key},\n  title = {${title}},\n  author = {${authors}},\n  year = {${year}}${doi ? `,\n  doi = {${doi}}` : ''}\n}`;
      navigator.clipboard.writeText(bibtex).then(() => {
        toast.success(t('library.contextMenu.bibtexCopied'));
      });
    });
  };

  const separatorStyle: React.CSSProperties = { height: 1, backgroundColor: 'var(--border-subtle)', margin: '4px 0' };
  const dangerStyle: React.CSSProperties = { ...menuItemStyle, color: 'var(--danger)' };

  return (
    <>
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content style={menuContentStyle}>
          {/* ── 导航区 ── */}
          {hasFulltext && (
            <ContextMenu.Item
              style={menuItemStyle}
              onSelect={() => deferMenuAction(() => navigateTo({ type: 'paper', id: paper.id, view: 'reader' }))}
            >
              {t('library.contextMenu.openInReader')}
            </ContextMenu.Item>
          )}
          {hasAnalysis && (
            <ContextMenu.Item
              style={menuItemStyle}
              onSelect={() => deferMenuAction(() => navigateTo({ type: 'paper', id: paper.id, view: 'analysis' }))}
            >
              {t('library.contextMenu.viewAnalysisReport')}
            </ContextMenu.Item>
          )}
          <ContextMenu.Item
            style={menuItemStyle}
            onSelect={() => deferMenuAction(() => navigateTo({ type: 'graph', focusNodeId: paper.id }))}
          >
            {t('library.contextMenu.locateInGraph')}
          </ContextMenu.Item>

          <ContextMenu.Separator style={separatorStyle} />

          {/* ── 属性 ── */}
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

          {/* ── 操作区：仅显示当前可执行的操作 ── */}
          {!hasFulltext && !isAcquiring && (
            <ContextMenu.Item
              style={menuItemStyle}
              onSelect={() => deferMenuAction(() => acquireFulltext.mutate(paper.id))}
            >
              {t('library.contextMenu.acquireFulltext')}
            </ContextMenu.Item>
          )}
          {!hasFulltext && !isAcquiring && (
            <ContextMenu.Item
              style={menuItemStyle}
              onSelect={() => deferMenuAction(() => linkLocalPdf.mutate({ paperId: paper.id }))}
            >
              {t('library.contextMenu.linkLocalPdf')}
            </ContextMenu.Item>
          )}
          {hasFulltext && !hasText && (
            <ContextMenu.Item
              style={menuItemStyle}
              onSelect={() => deferMenuAction(() => startPipeline.mutate({ workflow: 'process', config: { paperIds: [paper.id] } }))}
            >
              {t('library.contextMenu.triggerProcess')}
            </ContextMenu.Item>
          )}
          {hasFulltext && !hasAnalysis && !isAnalyzing && (
            <ContextMenu.Item
              style={menuItemStyle}
              onSelect={() => deferMenuAction(() => startPipeline.mutate({ workflow: 'analyze', config: { paperIds: [paper.id] } }))}
            >
              {t('library.contextMenu.triggerAnalysis')}
            </ContextMenu.Item>
          )}

          <ContextMenu.Separator style={separatorStyle} />

          <ContextMenu.Item style={menuItemStyle}>
            {t('library.contextMenu.editTags')}
          </ContextMenu.Item>
          <ContextMenu.Item style={menuItemStyle} onSelect={handleCopyBibtex}>
            {t('library.contextMenu.copyBibtex')}
          </ContextMenu.Item>

          <ContextMenu.Separator style={separatorStyle} />

          {/* ── 危险区：仅显示有东西可删的选项 ── */}
          {hasAnalysis && (
            <ContextMenu.Item
              style={dangerStyle}
              onSelect={() => deferMenuAction(async () => {
                const confirmed = await confirm({
                  title: t('library.contextMenu.resetAnalysis'),
                  description: t('library.contextMenu.resetAnalysisConfirm', { title: paperTitle }),
                  confirmLabel: t('library.contextMenu.resetAnalysis'),
                  confirmTone: 'danger',
                });
                if (!confirmed) return;
                resetAnalysis.mutate(paper.id);
              })}
            >
              {t('library.contextMenu.resetAnalysis')}
            </ContextMenu.Item>
          )}
          {hasText && (
            <ContextMenu.Item
              style={dangerStyle}
              onSelect={() => deferMenuAction(async () => {
                const confirmed = await confirm({
                  title: t('library.contextMenu.resetProcess'),
                  description: t('library.contextMenu.resetProcessConfirm', { title: paperTitle }),
                  confirmLabel: t('library.contextMenu.resetProcess'),
                  confirmTone: 'danger',
                });
                if (!confirmed) return;
                resetProcess.mutate(paper.id);
              })}
            >
              {t('library.contextMenu.resetProcess')}
            </ContextMenu.Item>
          )}
          {hasFulltext && (
            <ContextMenu.Item
              style={dangerStyle}
              onSelect={() => deferMenuAction(async () => {
                const confirmed = await confirm({
                  title: t('library.contextMenu.resetFulltext'),
                  description: t('library.contextMenu.resetFulltextConfirm', { title: paperTitle }),
                  confirmLabel: t('library.contextMenu.resetFulltext'),
                  confirmTone: 'danger',
                });
                if (!confirmed) return;
                resetFulltext.mutate(paper.id);
              })}
            >
              {t('library.contextMenu.resetFulltext')}
            </ContextMenu.Item>
          )}
          <ContextMenu.Item
            style={dangerStyle}
            onSelect={handleDelete}
          >
            {t('common.delete')}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
    {dialog}
    </>
  );
}
