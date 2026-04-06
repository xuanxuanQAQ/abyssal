/**
 * WritingView — Writing 视图顶层容器（§2.1）
 *
 * 水平 PanelGroup：OutlineTree（220px 默认）+ UnifiedEditor（弹性填满）。
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

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { JSONContent } from '@tiptap/core';
import { useTranslation } from 'react-i18next';
import { Panel, Group, Separator } from 'react-resizable-panels';
import { useAppStore } from '../../core/store';
import { useCreateArticle, useDeleteArticle, useUpdateArticle } from '../../core/ipc/hooks/useArticles';
import { useCreateDraft, useDeleteDraft, useDraftList, useDraftOutline, useDraftSectionContent } from '../../core/ipc/hooks/useDrafts';
import { useHotkey } from '../../core/hooks/useHotkey';
import { useEditorStore } from '../../core/store/useEditorStore';
import { OutlineTree } from './outline/OutlineTree';
import { UnifiedEditor } from './editor/UnifiedEditor';
import { ExportDialog } from './export/ExportDialog';
import { VersionHistoryDialog } from './history/VersionHistoryDialog';
import { useArticleList } from './hooks/useArticle';
import { useAppDialog } from '../../shared/useAppDialog';
import type { SectionNode } from '../../../shared-types/models';
import { buildDocumentProjection } from '../../../shared/writing/documentOutline';
import { ARTICLE_STYLES, ARTICLE_STYLE_LABELS } from '../../../core/types/article';
import type { ArticleStyle } from '../../../core/types/article';

// ── Route style helpers ──

const ROUTE_STYLE_OPTIONS = ARTICLE_STYLES.map((v) => ({ value: v, label: ARTICLE_STYLE_LABELS[v] }));

function getStyleLabel(value: string | undefined): string {
  if (!value) return '';
  return ARTICLE_STYLE_LABELS[value as ArticleStyle] ?? '';
}

// ── Styles ──

const rootStyle: React.CSSProperties = {
  height: '100%',
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
};

const panelGroupStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
};

const toolbarShellStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '10px 16px 8px',
  borderBottom: '1px solid var(--border-subtle)',
  background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg-surface) 96%, white 4%) 0%, var(--bg-base) 100%)',
};

const toolbarTopRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  flexWrap: 'wrap',
};

const toolbarSelectStyle: React.CSSProperties = {
  minWidth: 160,
  padding: '4px 8px',
  borderRadius: 6,
  border: '1px solid var(--border-subtle)',
  backgroundColor: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  fontSize: '12px',
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: 6,
  border: '1px solid var(--border-subtle)',
  backgroundColor: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  fontSize: '12px',
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

const headerActionsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
};

const dangerActionsStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
  marginLeft: 8,
  paddingLeft: 12,
  borderLeft: '1px solid var(--border-subtle)',
};

const dangerTextActionStyle: React.CSSProperties = {
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: 'var(--danger, #c53b3b)',
  cursor: 'pointer',
  fontSize: '12px',
  lineHeight: 1.2,
  whiteSpace: 'nowrap',
};

const statusTextStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '12px',
  whiteSpace: 'nowrap',
};

const metaRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'nowrap',
  minWidth: 0,
  overflow: 'hidden',
};

const metaTextStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '12px',
  whiteSpace: 'nowrap',
};

const routeTabsViewportStyle: React.CSSProperties = {
  width: 'min(600px, 48vw)',
  maxWidth: 'min(600px, 48vw)',
  minWidth: 0,
  overflowX: 'auto',
  overflowY: 'hidden',
  scrollbarWidth: 'none',
  paddingBottom: 1,
  maskImage: 'linear-gradient(to right, black calc(100% - 56px), rgba(0,0,0,0.72) calc(100% - 24px), transparent 100%)',
  WebkitMaskImage: 'linear-gradient(to right, black calc(100% - 56px), rgba(0,0,0,0.72) calc(100% - 24px), transparent 100%)',
};

const routeTabsListStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  width: 'max-content',
  paddingBottom: 2,
};

const routeTabButtonBaseStyle: React.CSSProperties = {
  maxWidth: 280,
  padding: '5px 10px 6px',
  border: 'none',
  borderBottom: '2px solid transparent',
  background: 'transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontSize: '12px',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  transition: 'opacity 120ms ease',
};

const routeTabsRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  flex: '1 1 0',
  justifyContent: 'flex-end',
};

// ── Create Route Dialog Styles ──

const dialogOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0,0,0,0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const dialogPanelStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: '24px 28px',
  width: 420,
  maxWidth: '90vw',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

const dialogTitleStyle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 600,
  color: 'var(--text-primary)',
  margin: 0,
};

const dialogDescStyle: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--text-muted)',
  lineHeight: 1.5,
  margin: 0,
};

const dialogFieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const dialogLabelStyle: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--text-muted)',
};

const dialogInputStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid var(--border-subtle)',
  backgroundColor: 'var(--bg-base)',
  color: 'var(--text-primary)',
  fontSize: '13px',
};

const dialogSelectStyle: React.CSSProperties = {
  ...dialogInputStyle,
};

const dialogFooterStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 4,
};

const dialogPrimaryButtonStyle: React.CSSProperties = {
  padding: '6px 16px',
  borderRadius: 6,
  border: 'none',
  backgroundColor: 'var(--accent-color)',
  color: 'var(--text-on-accent)',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 500,
};

// ── Helpers ──

function buildOutlineStructureKey(sections: SectionNode[]): string {
  const parts: string[] = [];
  const stack = [...sections].reverse();

  while (stack.length > 0) {
    const node = stack.pop()!;
    parts.push(`${node.id}:${node.parentId ?? 'root'}:${node.sortIndex}`);
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push(node.children[index]!);
    }
  }

  return parts.join('|');
}

function flattenSections(sections: SectionNode[]): Map<string, SectionNode> {
  const map = new Map<string, SectionNode>();
  const stack = [...sections];
  while (stack.length > 0) {
    const current = stack.pop()!;
    map.set(current.id, current);
    for (const child of current.children) {
      stack.push(child);
    }
  }
  return map;
}

function buildLiveOutlineSections(baseSections: SectionNode[], documentJson: JSONContent | null): SectionNode[] {
  if (!documentJson) return baseSections;

  const projection = buildDocumentProjection(documentJson);
  const baseMap = flattenSections(baseSections);

  const mapProjected = (section: (typeof projection.rootSections)[number]): SectionNode => {
    const base = baseMap.get(section.id);
    return {
      id: section.id,
      title: section.title,
      parentId: section.parentId,
      sortIndex: section.sortIndex,
      status: base?.status ?? 'pending',
      wordCount: section.wordCount,
      writingInstructions: base?.writingInstructions ?? null,
      conceptIds: base?.conceptIds ?? [],
      paperIds: base?.paperIds ?? [],
      aiModel: base?.aiModel ?? null,
      evidenceStatus: base?.evidenceStatus,
      evidenceGaps: base?.evidenceGaps,
      children: section.children.map(mapProjected),
    };
  };

  return projection.rootSections.map(mapProjected);
}

function summarizeSections(sections: SectionNode[]): { totalSections: number; totalWords: number } {
  let totalSections = 0;
  let totalWords = 0;
  const stack = [...sections];

  while (stack.length > 0) {
    const current = stack.pop()!;
    totalSections += 1;
    totalWords += current.wordCount;
    for (const child of current.children) {
      stack.push(child);
    }
  }

  return { totalSections, totalWords };
}

// ── Component ──

export function WritingView(): React.JSX.Element {
  const { t } = useTranslation();
  // ── Local state ──
  const [activeArticleId, setActiveArticleId] = useState<string | null>(null);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [liveDocumentJson, setLiveDocumentJson] = useState<JSONContent | null>(null);
  const [createRouteDialogOpen, setCreateRouteDialogOpen] = useState(false);
  const [newRouteTitle, setNewRouteTitle] = useState('');
  const [newRouteStyle, setNewRouteStyle] = useState('formal_paper');
  const [newRouteCopyFromCurrent, setNewRouteCopyFromCurrent] = useState(true);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [articleSwitcherOpen, setArticleSwitcherOpen] = useState(false);
  const articleSwitcherRef = useRef<HTMLDivElement | null>(null);

  // ── Store selectors ──
  const selectedSectionId = useAppStore((s) => s.selectedSectionId);
  const selectSection = useAppStore((s) => s.selectSection);
  const unsavedChanges = useEditorStore((s) => s.unsavedChanges);

  const routeTabsViewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = routeTabsViewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0) {
        el.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  // Close article switcher on outside click
  useEffect(() => {
    if (!articleSwitcherOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (articleSwitcherRef.current && !articleSwitcherRef.current.contains(e.target as Node)) {
        setArticleSwitcherOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [articleSwitcherOpen]);

  // ── Data hooks ──
  const { articles, isLoading: isLoadingList } = useArticleList();
  const createArticle = useCreateArticle();
  const deleteArticle = useDeleteArticle();
  const updateArticle = useUpdateArticle();
  const createDraft = useCreateDraft();
  const deleteDraft = useDeleteDraft();
  const resolvedArticleId = useMemo(() => {
    if (activeArticleId !== null) return activeArticleId;
    if (articles.length > 0) return articles[0]?.id ?? null;
    return null;
  }, [activeArticleId, articles]);
  const { data: drafts, isSuccess: draftsLoaded } = useDraftList(resolvedArticleId);
  const draftList = drafts ?? [];
  const resolvedDraftId = useMemo(() => {
    if (activeDraftId !== null) {
      // Once drafts have loaded, verify the active draft still exists (handles deletion)
      if (draftsLoaded && draftList.length > 0 && !draftList.some((c) => c.id === activeDraftId)) {
        return draftList[0]?.id ?? null;
      }
      // Drafts not loaded or list empty — trust the active selection
      return activeDraftId;
    }
    return draftList[0]?.id ?? null;
  }, [activeDraftId, draftList, draftsLoaded]);
  const { data: draft } = useDraftOutline(resolvedDraftId);
  const { data: currentSectionContent } = useDraftSectionContent(resolvedDraftId, selectedSectionId);
  const outlineStructureKey = useMemo(
    () => buildOutlineStructureKey(draft?.sections ?? []),
    [draft?.sections],
  );
  const currentArticle = useMemo(
    () => articles.find((candidate) => candidate.id === resolvedArticleId) ?? null,
    [articles, resolvedArticleId],
  );
  const displaySections = useMemo(
    () => buildLiveOutlineSections(draft?.sections ?? [], liveDocumentJson),
    [draft?.sections, liveDocumentJson],
  );
  const displayDraft = useMemo(
    () => (draft ? { ...draft, sections: displaySections } : null),
    [draft, displaySections],
  );
  const { totalSections, totalWords } = useMemo(
    () => summarizeSections(displaySections),
    [displaySections],
  );
  const { confirm, dialog } = useAppDialog();

  // ── Callbacks ──

  const handleCreateArticle = useCallback(() => {
    createArticle.mutate('未命名文章', {
      onSuccess: (created) => {
        setActiveArticleId(created.id);
        setActiveDraftId(created.defaultDraftId ?? null);
      },
    });
  }, [createArticle]);

  const openCreateRouteDialog = useCallback(() => {
    setNewRouteTitle('');
    setNewRouteStyle('formal_paper');
    setNewRouteCopyFromCurrent(true);
    setCreateRouteDialogOpen(true);
  }, []);

  const handleCreateRoute = useCallback(() => {
    if (!resolvedArticleId) return;
    const title = newRouteTitle.trim() || getStyleLabel(newRouteStyle) || '新变体';
    createDraft.mutate({
      articleId: resolvedArticleId,
      seed: {
        title,
        basedOnDraftId: newRouteCopyFromCurrent ? resolvedDraftId : null,
        metadata: { writingStyle: newRouteStyle },
      },
    }, {
      onSuccess: (created) => {
        setActiveDraftId(created.id);
        setCreateRouteDialogOpen(false);
      },
    });
  }, [createDraft, newRouteCopyFromCurrent, newRouteStyle, newRouteTitle, resolvedArticleId, resolvedDraftId]);

  const handleDeleteArticle = useCallback(async () => {
    if (!resolvedArticleId || !currentArticle) return;
    const confirmed = await confirm({
      title: '删除文章',
      description: `确定删除文章“${currentArticle.title}”吗？相关变体也会一并删除。`,
      confirmLabel: '删除文章',
      confirmTone: 'danger',
    });
    if (!confirmed) return;

    const remainingArticles = articles.filter((candidate) => candidate.id !== resolvedArticleId);
    deleteArticle.mutate(resolvedArticleId, {
      onSuccess: () => {
        setActiveArticleId(remainingArticles[0]?.id ?? null);
        setActiveDraftId(null);
      },
    });
  }, [articles, confirm, currentArticle, deleteArticle, resolvedArticleId]);

  const handleDeleteRoute = useCallback(async () => {
    if (!resolvedDraftId || !draft) return;
    const confirmed = await confirm({
      title: '删除变体',
      description: `确定删除变体“${draft.title}”吗？此操作不影响其他变体和文章本体。`,
      confirmLabel: '删除变体',
      confirmTone: 'danger',
    });
    if (!confirmed) return;

    const remainingDrafts = draftList.filter((candidate) => candidate.id !== resolvedDraftId);
    deleteDraft.mutate(resolvedDraftId, {
      onSuccess: () => {
        setActiveDraftId(remainingDrafts[0]?.id ?? null);
        if (remainingDrafts.length === 0) {
          selectSection(null);
        }
      },
    });
  }, [confirm, deleteDraft, draft, draftList, resolvedDraftId, selectSection]);

  const toggleExportDialog = useCallback(() => {
    setExportDialogOpen((prev) => !prev);
  }, []);

  const handleExportOpenChange = useCallback((open: boolean) => {
    setExportDialogOpen(open);
  }, []);

  const handleVersionHistoryOpenChange = useCallback((open: boolean) => {
    setVersionHistoryOpen(open);
  }, []);

  // Sync local state if auto-resolved
  useEffect(() => {
    if (activeArticleId === null && resolvedArticleId !== null) {
      setActiveArticleId(resolvedArticleId);
    }
  }, [activeArticleId, resolvedArticleId]);

  useEffect(() => {
    if (resolvedDraftId !== null && activeDraftId !== resolvedDraftId) {
      setActiveDraftId(resolvedDraftId);
    }
  }, [activeDraftId, resolvedDraftId]);

  useEffect(() => {
    setLiveDocumentJson(null);
    // Draft 切换时清空 sectionId 但保留 articleId/draftId，否则整个写作
    // 上下文链路（ContextSource → ChatContext → copilotBridge）都会丢失文章信息。
    selectSection(null, resolvedArticleId ?? undefined, resolvedDraftId ?? undefined);
  }, [resolvedArticleId, resolvedDraftId, selectSection]);

  // ── Clear writing-specific state when leaving writing view ──
  // WritingView is keepAlive so it never unmounts — we watch activeView instead.
  const activeView = useAppStore((s) => s.activeView);
  useEffect(() => {
    if (activeView !== 'writing') {
      useEditorStore.getState().clearPersistedWritingTarget();
      useEditorStore.getState().clearDraftStreamText();
    }
  }, [activeView]);

  // ── Keyboard shortcuts ──
  useHotkey('Ctrl+Shift+E', toggleExportDialog);

  // ── Listen for version history open events from OutlineContextMenu ──
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { sectionId: string } | undefined;
      if (detail?.sectionId) {
        setVersionHistoryOpen(true);
      }
    };
    window.addEventListener('abyssal:openVersionHistory', handler);
    return () => window.removeEventListener('abyssal:openVersionHistory', handler);
  }, []);

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
      <div style={toolbarShellStyle}>
        {/* Row 1: actions */}
        <div style={toolbarTopRowStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, position: 'relative' }} ref={articleSwitcherRef}>
            {editingTitle ? (
              <input
                autoFocus
                style={{
                  fontSize: 'clamp(16px, 2vw, 20px)',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  background: 'var(--bg-base)',
                  border: '1px solid var(--accent-color)',
                  borderRadius: 6,
                  padding: '2px 8px',
                  outline: 'none',
                  minWidth: 120,
                  maxWidth: 320,
                }}
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => {
                  const trimmed = titleDraft.trim();
                  if (trimmed && resolvedArticleId && trimmed !== currentArticle?.title) {
                    updateArticle.mutate({ articleId: resolvedArticleId, patch: { title: trimmed } });
                  }
                  setEditingTitle(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                  }
                  if (e.key === 'Escape') {
                    setEditingTitle(false);
                  }
                }}
                aria-label="编辑文章名称"
              />
            ) : (
              <span
                style={{
                  fontSize: 'clamp(16px, 2vw, 20px)',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  cursor: 'default',
                  userSelect: 'none',
                  borderBottom: '1px dashed transparent',
                  transition: 'border-color 150ms',
                }}
                title="双击编辑文章名称"
                onDoubleClick={() => {
                  setTitleDraft(currentArticle?.title ?? '');
                  setEditingTitle(true);
                }}
              >
                {currentArticle?.title ?? '未命名文章'}
              </span>
            )}
            {articles.length > 1 && (
              <button
                type="button"
                aria-label="切换文章"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 22,
                  height: 22,
                  borderRadius: 4,
                  border: 'none',
                  background: articleSwitcherOpen ? 'var(--bg-surface-high, var(--bg-surface))' : 'transparent',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: '10px',
                  flexShrink: 0,
                }}
                onClick={() => setArticleSwitcherOpen((prev) => !prev)}
              >
                ▾
              </button>
            )}
            {articleSwitcherOpen && articles.length > 1 && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: 4,
                  minWidth: 200,
                  maxWidth: 320,
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                  boxShadow: 'var(--shadow-md, 0 4px 12px rgba(0,0,0,0.12))',
                  zIndex: 100,
                  padding: '4px 0',
                  maxHeight: 240,
                  overflowY: 'auto',
                }}
              >
                {articles.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '7px 14px',
                      border: 'none',
                      background: candidate.id === resolvedArticleId ? 'var(--accent-color-muted, rgba(59,130,246,0.1))' : 'transparent',
                      color: candidate.id === resolvedArticleId ? 'var(--accent-color)' : 'var(--text-primary)',
                      fontWeight: candidate.id === resolvedArticleId ? 600 : 400,
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontSize: '13px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    onClick={() => {
                      setActiveArticleId(candidate.id);
                      setActiveDraftId(null);
                      setArticleSwitcherOpen(false);
                    }}
                  >
                    {candidate.title}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={headerActionsStyle}>
            <span style={statusTextStyle}>{unsavedChanges ? '● 未保存' : '已保存'}</span>
            <span style={statusTextStyle}>{totalWords.toLocaleString()} 字</span>
            <button type="button" style={secondaryButtonStyle} onClick={toggleExportDialog} disabled={!resolvedArticleId}>
              导出
            </button>
            <button type="button" style={secondaryButtonStyle} onClick={handleCreateArticle}>
              {t('writing.newArticle')}
            </button>
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={openCreateRouteDialog}
              disabled={!resolvedArticleId || createDraft.isPending}
              aria-label="新建变体"
            >
              新建变体
            </button>
            <div style={dangerActionsStyle}>
              <button
                type="button"
                style={dangerTextActionStyle}
                onClick={handleDeleteArticle}
                aria-label="删除文章"
                disabled={!currentArticle || deleteArticle.isPending}
              >
                {deleteArticle.isPending ? '删除中…' : '删除文章'}
              </button>
              {resolvedDraftId ? (
                <button
                  type="button"
                  style={dangerTextActionStyle}
                  onClick={handleDeleteRoute}
                  aria-label="删除变体"
                  disabled={deleteDraft.isPending}
                >
                  {deleteDraft.isPending ? '删除中…' : '删除变体'}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {/* Row 2: meta info + route tabs */}
        <div style={metaRowStyle}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={metaTextStyle}>{draftList.length} 个变体</span>
            <span style={metaTextStyle}>{totalSections} 个章节</span>
          </div>
          {draftList.length > 0 ? (
            <div style={routeTabsRowStyle}>
              <div
                ref={routeTabsViewportRef}
                className="hide-scrollbar"
                style={routeTabsViewportStyle}
                data-draft-tabs-viewport="true"
              >
                <div style={routeTabsListStyle}>
                  {draftList.map((candidate) => {
                    const isSelected = candidate.id === resolvedDraftId;
                    const styleLabel = getStyleLabel(candidate.metadata?.writingStyle);
                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        onClick={() => setActiveDraftId(candidate.id)}
                        style={{
                          ...routeTabButtonBaseStyle,
                          color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                          borderBottom: isSelected ? '2px solid var(--text-primary)' : '2px solid transparent',
                          fontWeight: isSelected ? 600 : 400,
                        }}
                        aria-label={isSelected ? '当前变体' : `切换到变体 ${candidate.title}`}
                        title={styleLabel || candidate.title}
                      >
                        {candidate.title}
                        {styleLabel ? <span style={{ marginLeft: 4, opacity: 0.5, fontSize: '11px' }}>{styleLabel}</span> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <Group
        orientation="horizontal"
        style={panelGroupStyle}
      >
        {/* ── Left panel: Outline ── */}
        <Panel
          id="writing-outline"
          defaultSize="20%"
          minSize="10%"
          maxSize="30%"
          collapsible
        >
          <div style={outlinePanelStyle}>
            {draft !== undefined && draft !== null && resolvedArticleId !== null ? (
              <OutlineTree articleId={resolvedArticleId} draft={displayDraft ?? draft} />
            ) : (
              <div style={emptyStateContainerStyle}>
                <span>{t('writing.loading')}</span>
              </div>
            )}
          </div>
        </Panel>
        <Separator
          style={{
            width: 4,
            backgroundColor: 'transparent',
            cursor: 'col-resize',
            transition: 'background-color 150ms',
          }}
          className="panel-resize-handle"
        />

        {/* ── Right panel: Section editor ── */}
        <Panel
          id="writing-editor"
          minSize="50%"
        >
          <div style={editorPanelStyle}>
            {draft !== undefined && draft !== null && resolvedArticleId !== null && resolvedDraftId !== null ? (
              <UnifiedEditor
                articleId={resolvedArticleId}
                draftId={resolvedDraftId}
                outlineStructureKey={outlineStructureKey}
                onDocumentJsonChange={setLiveDocumentJson}
              />
            ) : (
              <div style={emptyStateMessageStyle}>
                {t('writing.selectSection')}
              </div>
            )}
          </div>
        </Panel>
      </Group>

      {/* ── Dialogs ── */}
      {resolvedArticleId !== null && (
        <ExportDialog
          articleId={resolvedArticleId}
          draftId={resolvedDraftId}
          articleTitle={currentArticle?.title ?? ''}
          open={exportDialogOpen}
          onOpenChange={handleExportOpenChange}
        />
      )}
      {selectedSectionId !== null && resolvedDraftId !== null && (
        <VersionHistoryDialog
          draftId={resolvedDraftId}
          sectionId={selectedSectionId}
          currentContent={currentSectionContent?.content ?? ''}
          open={versionHistoryOpen}
          onOpenChange={handleVersionHistoryOpenChange}
        />
      )}

      {/* ── Create Route Dialog ── */}
      {createRouteDialogOpen && (
        <div style={dialogOverlayStyle} onClick={() => setCreateRouteDialogOpen(false)}>
          <div style={dialogPanelStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={dialogTitleStyle}>新建写作变体</h3>
            <p style={dialogDescStyle}>
              为不同输出场景创建并行变体，例如学术论文、项目汇报或博客文章。新变体会复制当前内容，后续编辑彼此独立。
            </p>
            <div style={dialogFieldStyle}>
              <label style={dialogLabelStyle}>变体名称</label>
              <input
                style={dialogInputStyle}
                type="text"
                value={newRouteTitle}
                onChange={(e) => setNewRouteTitle(e.target.value)}
                placeholder={getStyleLabel(newRouteStyle) || '正式论文版'}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCreateRoute();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setCreateRouteDialogOpen(false);
                  }
                }}
              />
            </div>
            <div style={dialogFieldStyle}>
              <label style={dialogLabelStyle}>目标场景 / 风格</label>
              <select
                style={dialogSelectStyle}
                value={newRouteStyle}
                onChange={(e) => setNewRouteStyle(e.target.value)}
              >
                {ROUTE_STYLE_OPTIONS.map((rs) => (
                  <option key={rs.value} value={rs.value}>{rs.label}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '13px' }}>
              <input
                type="checkbox"
                id="copy-from-current"
                checked={newRouteCopyFromCurrent}
                onChange={(e) => setNewRouteCopyFromCurrent(e.target.checked)}
              />
              <label htmlFor="copy-from-current" style={{ color: 'var(--text-secondary)' }}>
                基于当前变体复制内容
              </label>
            </div>
            <div style={dialogFooterStyle}>
              <button type="button" style={secondaryButtonStyle} onClick={() => setCreateRouteDialogOpen(false)}>
                取消
              </button>
              <button
                type="button"
                style={dialogPrimaryButtonStyle}
                onClick={handleCreateRoute}
                disabled={createDraft.isPending}
              >
                {createDraft.isPending ? '创建中…' : '创建变体'}
              </button>
            </div>
          </div>
        </div>
      )}
      {dialog}
    </div>
  );
}
