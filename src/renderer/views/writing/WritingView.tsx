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

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import type { JSONContent } from '@tiptap/core';
import { useTranslation } from 'react-i18next';
import { Panel, Group } from 'react-resizable-panels';
import { useAppStore } from '../../core/store';
import { useCreateArticle } from '../../core/ipc/hooks/useArticles';
import { useCreateDraft, useDraftList, useDraftOutline, useDraftSectionContent } from '../../core/ipc/hooks/useDrafts';
import { useHotkey } from '../../core/hooks/useHotkey';
import { OutlineTree } from './outline/OutlineTree';
import { UnifiedEditor } from './editor/UnifiedEditor';
import { ExportDialog } from './export/ExportDialog';
import { VersionHistoryDialog } from './history/VersionHistoryDialog';
import { useArticleList } from './hooks/useArticle';
import type { SectionNode } from '../../../shared-types/models';
import { buildDocumentProjection } from '../../../shared/writing/documentOutline';

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
  alignItems: 'center',
  gap: 12,
  padding: '10px 14px',
  borderBottom: '1px solid var(--border-subtle)',
  background: 'linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-base) 100%)',
};

const toolbarSelectStyle: React.CSSProperties = {
  minWidth: 180,
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  backgroundColor: 'var(--bg-surface)',
  color: 'var(--text-primary)',
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  backgroundColor: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
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

// ── Component ──

export function WritingView(): React.JSX.Element {
  const { t } = useTranslation();
  // ── Local state ──
  const [activeArticleId, setActiveArticleId] = useState<string | null>(null);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [liveDocumentJson, setLiveDocumentJson] = useState<JSONContent | null>(null);

  // ── Store selectors ──
  const selectedSectionId = useAppStore((s) => s.selectedSectionId);
  const selectSection = useAppStore((s) => s.selectSection);

  // ── Data hooks ──
  const { articles, isLoading: isLoadingList } = useArticleList();
  const createArticle = useCreateArticle();
  const createDraft = useCreateDraft();
  const resolvedArticleId = useMemo(() => {
    if (activeArticleId !== null) return activeArticleId;
    if (articles.length > 0) return articles[0]?.id ?? null;
    return null;
  }, [activeArticleId, articles]);
  const { data: drafts = [] } = useDraftList(resolvedArticleId);
  const resolvedDraftId = useMemo(() => {
    if (activeDraftId !== null && drafts.some((candidate) => candidate.id === activeDraftId)) return activeDraftId;
    return drafts[0]?.id ?? null;
  }, [activeDraftId, drafts]);
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

  // ── Callbacks ──

  const handleCreateArticle = useCallback(() => {
    createArticle.mutate('未命名文章', {
      onSuccess: (created) => {
        setActiveArticleId(created.id);
        setActiveDraftId(null);
      },
    });
  }, [createArticle]);

  const handleCreateDraft = useCallback(() => {
    if (!resolvedArticleId) return;
    createDraft.mutate({ articleId: resolvedArticleId }, {
      onSuccess: (created) => {
        setActiveDraftId(created.id);
      },
    });
  }, [createDraft, resolvedArticleId]);

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
    selectSection(null);
  }, [resolvedDraftId, selectSection]);

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
        <select
          style={toolbarSelectStyle}
          value={resolvedArticleId ?? ''}
          onChange={(event) => {
            setActiveArticleId(event.target.value || null);
            setActiveDraftId(null);
          }}
        >
          {articles.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>{candidate.title}</option>
          ))}
        </select>
        <select
          style={toolbarSelectStyle}
          value={resolvedDraftId ?? ''}
          onChange={(event) => setActiveDraftId(event.target.value || null)}
          disabled={drafts.length === 0}
        >
          {drafts.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>{candidate.title}</option>
          ))}
        </select>
        <button type="button" style={secondaryButtonStyle} onClick={handleCreateArticle}>
          {t('writing.newArticle')}
        </button>
        <button type="button" style={secondaryButtonStyle} onClick={handleCreateDraft} disabled={!resolvedArticleId || createDraft.isPending}>
          新建稿件
        </button>
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
    </div>
  );
}
