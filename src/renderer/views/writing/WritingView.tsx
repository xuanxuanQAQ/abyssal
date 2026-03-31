/**
 * WritingView — Writing 视图顶层容器（§2.1）
 *
 * 水平 PanelGroup：OutlineTree（220px 默认）+ SectionEditor（弹性填满）。
 *
 * 状态管理：
 *   - activeArticleId 本地 state：当前编辑的文章 ID
 *   - selectedSectionId / selectSection 来自全局 AppStore
 *
 * 空态：
 *   - 无文章 → "创建您的第一篇文章" + "新建文章" 按钮
 *   - 有文章但未选中节 → "选择一个节开始编辑"
 *
 * 快捷键：
 *   - Ctrl+Shift+E → 打开/关闭 ExportDialog
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useAppStore } from '../../core/store';
import { useCreateArticle } from '../../core/ipc/hooks/useArticles';
import { useHotkey } from '../../core/hooks/useHotkey';
import { OutlineTree } from './outline/OutlineTree';
import { UnifiedEditor } from './editor/UnifiedEditor';
import { ExportDialog } from './export/ExportDialog';
import { VersionHistoryDialog } from './history/VersionHistoryDialog';
import { useArticle, useArticleList } from './hooks/useArticle';
import { useSectionContent } from './hooks/useSectionContent';

// ── Styles ──

const rootStyle: React.CSSProperties = {
  height: '100%',
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
};

const resizeHandleStyle: React.CSSProperties = {
  width: 1,
  backgroundColor: 'var(--border-subtle)',
  cursor: 'col-resize',
  flexShrink: 0,
  transition: 'background-color 150ms',
};

const outlinePanelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  overflow: 'hidden',
};

const editorPanelStyle: React.CSSProperties = {
  height: '100%',
  overflow: 'hidden',
};

const emptyStateContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  gap: 16,
  color: 'var(--text-muted)',
  fontSize: 'var(--text-base)',
  userSelect: 'none',
};

const emptyStateButtonStyle: React.CSSProperties = {
  padding: '8px 20px',
  fontSize: 'var(--text-sm)',
  fontWeight: 500,
  color: 'var(--text-on-accent)',
  backgroundColor: 'var(--accent-color)',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
};

const emptyStateMessageStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  color: 'var(--text-muted)',
  fontSize: 'var(--text-base)',
  userSelect: 'none',
};

// ── Component ──

export function WritingView(): React.JSX.Element {
  const { t } = useTranslation();
  // ── Local state ──
  const [activeArticleId, setActiveArticleId] = useState<string | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);

  // ── Store selectors ──
  const selectedSectionId = useAppStore((s) => s.selectedSectionId);

  // ── Data hooks ──
  const { articles, isLoading: isLoadingList } = useArticleList();
  const { article } = useArticle(activeArticleId);
  const createArticle = useCreateArticle();
  const { content: currentSectionContent } = useSectionContent(selectedSectionId);

  // ── Callbacks ──

  const handleCreateArticle = useCallback(() => {
    createArticle.mutate('未命名文章', {
      onSuccess: (created) => {
        setActiveArticleId(created.id);
      },
    });
  }, [createArticle]);

  const toggleExportDialog = useCallback(() => {
    setExportDialogOpen((prev) => !prev);
  }, []);

  const handleExportOpenChange = useCallback((open: boolean) => {
    setExportDialogOpen(open);
  }, []);

  const handleVersionHistoryOpenChange = useCallback((open: boolean) => {
    setVersionHistoryOpen(open);
  }, []);

  // ── Auto-select first article when list loads and none is active ──
  const resolvedArticleId = useMemo(() => {
    if (activeArticleId !== null) return activeArticleId;
    if (articles.length > 0) return articles[0]?.id ?? null;
    return null;
  }, [activeArticleId, articles]);

  // Sync local state if auto-resolved
  useEffect(() => {
    if (activeArticleId === null && resolvedArticleId !== null) {
      setActiveArticleId(resolvedArticleId);
    }
  }, [activeArticleId, resolvedArticleId]);

  // ── Keyboard shortcuts ──
  useHotkey('Ctrl+Shift+E', toggleExportDialog);

  // ── Empty state: no article exists ──
  if (!isLoadingList && articles.length === 0) {
    return (
      <div style={rootStyle}>
        <div style={emptyStateContainerStyle}>
          <span>{t('writing.createFirst')}</span>
          <button
            type="button"
            style={emptyStateButtonStyle}
            onClick={handleCreateArticle}
            disabled={createArticle.isPending}
          >
            {t('writing.newArticle')}
          </button>
        </div>
      </div>
    );
  }

  // ── Main layout ──
  return (
    <div style={rootStyle}>
      <PanelGroup
        direction="horizontal"
        autoSaveId="abyssal-writing"
      >
        {/* ── Left panel: Outline ── */}
        <Panel
          id="writing-outline"
          defaultSize={20}
          minSize={10}
          maxSize={30}
          collapsible
          order={1}
        >
          <div style={outlinePanelStyle}>
            {article !== null ? (
              <OutlineTree article={article} />
            ) : (
              <div style={emptyStateContainerStyle}>
                <span>{t('writing.loading')}</span>
              </div>
            )}
          </div>
        </Panel>

        {/* ── Resize handle ── */}
        <PanelResizeHandle style={resizeHandleStyle} />

        {/* ── Right panel: Section editor ── */}
        <Panel
          id="writing-editor"
          order={2}
          minSize={50}
        >
          <div style={editorPanelStyle}>
            {article !== null && resolvedArticleId !== null ? (
              <UnifiedEditor articleId={resolvedArticleId} />
            ) : (
              <div style={emptyStateMessageStyle}>
                {t('writing.selectSection')}
              </div>
            )}
          </div>
        </Panel>
      </PanelGroup>

      {/* ── Dialogs ── */}
      {activeArticleId !== null && (
        <ExportDialog
          articleId={activeArticleId}
          articleTitle={article?.title ?? ''}
          open={exportDialogOpen}
          onOpenChange={handleExportOpenChange}
        />
      )}
      {selectedSectionId !== null && (
        <VersionHistoryDialog
          sectionId={selectedSectionId}
          currentContent={currentSectionContent}
          open={versionHistoryOpen}
          onOpenChange={handleVersionHistoryOpenChange}
        />
      )}
    </div>
  );
}
