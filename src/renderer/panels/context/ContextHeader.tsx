/**
 * ContextHeader — 标题栏（§4）
 *
 * 40px 高，三区域 flex：
 * - 左：Pin 按钮
 * - 中：实体类型图标 + 名称
 * - 右：⋮ 更多菜单
 */

import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pin, PinOff, Eye, FileText, Lightbulb, PenTool, Network, MoreVertical, Trash2, PanelRightClose, Library, StickyNote } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useAppStore } from '../../core/store';
import { useChatStore } from '../../core/store/useChatStore';
import { useMemo as useMemoItem } from '../../core/ipc/hooks/useMemos';
import { useNote } from '../../core/ipc/hooks/useNotes';
import { useEffectiveSource } from './engine/useEffectiveSource';
import { useDerivedContextSource } from './engine/useContextSource';
import { contextSourceKey } from './engine/contextSourceKey';
import { useArticle } from '../../views/writing/hooks/useArticle';
import { useEntityDisplayNameCache } from '../../views/notes/shared/entityDisplayNameCache';
import type { ContextSource } from '../../../shared-types/models';
import { Z_INDEX } from '../../styles/zIndex';

function isFallbackEntityLabel(id: string, label: string | null | undefined): boolean {
  if (!label) return true;
  return label === id || label === id.slice(0, 10);
}

function truncateLabel(value: string, maxLength = 40): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function buildMemoLabel(text: string | null | undefined, fallback: string): string {
  if (!text) return fallback;
  const normalized = truncateLabel(text, 36);
  return normalized.length > 0 ? normalized : fallback;
}

function findSectionTitle(
  sections: Array<{ id: string; title: string; children: Array<{ id: string; title: string; children: unknown[] }> }>,
  sectionId: string,
): string | null {
  for (const section of sections) {
    if (section.id === sectionId) {
      return section.title;
    }
    const nested = findSectionTitle(section.children as Array<{ id: string; title: string; children: Array<{ id: string; title: string; children: unknown[] }> }>, sectionId);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function resolveEntityIcon(source: ContextSource): React.ReactNode {
  switch (source.type) {
    case 'paper':
      return <FileText size={14} />;
    case 'papers':
      return <FileText size={14} />;
    case 'concept':
      return <Lightbulb size={14} />;
    case 'mapping':
      return <Network size={14} />;
    case 'section':
      return <PenTool size={14} />;
    case 'writing-selection':
      return <PenTool size={14} />;
    case 'graphNode':
      if (source.nodeType === 'paper') return <FileText size={14} />;
      if (source.nodeType === 'concept') return <Lightbulb size={14} />;
      if (source.nodeType === 'note') return <StickyNote size={14} />;
      return <PenTool size={14} />;
    case 'memo':
      return <PenTool size={14} />;
    case 'note':
      return <FileText size={14} />;
    case 'allSelected':
      return <Library size={14} />;
    case 'empty':
      return null;
  }
}

function useResolvedEntityName(source: ContextSource, t: ReturnType<typeof import('react-i18next').useTranslation>['t']): string {
  const displayNames = useEntityDisplayNameCache();
  const { data: note } = useNote(
    source.type === 'note'
      ? source.noteId
      : source.type === 'graphNode' && source.nodeType === 'note'
        ? source.nodeId
        : null,
  );
  const { data: memo } = useMemoItem(
    source.type === 'memo'
      ? source.memoId
      : source.type === 'graphNode' && source.nodeType === 'memo'
        ? source.nodeId
        : null,
  );
  const { article } = useArticle(
    source.type === 'section' || source.type === 'writing-selection'
      ? source.articleId
      : null,
  );

  const paperId = source.type === 'paper'
    ? source.paperId
    : source.type === 'mapping'
      ? source.paperId
      : source.type === 'graphNode' && source.nodeType === 'paper'
        ? source.nodeId
        : null;
  const conceptId = source.type === 'concept'
    ? source.conceptId
    : source.type === 'mapping'
      ? source.conceptId
      : source.type === 'graphNode' && source.nodeType === 'concept'
        ? source.nodeId
        : null;

  const resolvedPaperLabel = paperId ? displayNames.getPaperName(paperId) : null;
  const paperLabel = paperId && !isFallbackEntityLabel(paperId, resolvedPaperLabel)
    ? resolvedPaperLabel
    : null;
  const resolvedConceptLabel = conceptId ? displayNames.getConceptName(conceptId) : null;
  const conceptLabel = conceptId && !isFallbackEntityLabel(conceptId, resolvedConceptLabel)
    ? resolvedConceptLabel
    : null;
  const activeSectionId = source.type === 'section' || source.type === 'writing-selection'
    ? source.sectionId
    : null;
  const sectionTitle = useMemo(() => {
    if (!article || !activeSectionId) return null;
    return findSectionTitle(article.sections as Array<{ id: string; title: string; children: Array<{ id: string; title: string; children: unknown[] }> }>, activeSectionId);
  }, [article, activeSectionId]);

  switch (source.type) {
    case 'paper':
      return paperLabel ?? t('context.header.paper');
    case 'papers':
      return t('context.header.papers', { count: source.paperIds.length });
    case 'concept':
      return conceptLabel ?? t('context.header.concept');
    case 'mapping':
      if (paperLabel && conceptLabel) {
        return `${paperLabel} · ${conceptLabel}`;
      }
      return paperLabel ?? conceptLabel ?? t('context.header.mapping');
    case 'section':
      return sectionTitle ? truncateLabel(sectionTitle) : t('context.header.section');
    case 'writing-selection': {
      const selectedPreview = truncateLabel(source.selectedText, 34);
      if (selectedPreview.length > 0) {
        return selectedPreview;
      }
      return sectionTitle ? truncateLabel(sectionTitle) : t('context.header.section');
    }
    case 'graphNode':
      if (source.nodeType === 'paper') {
        return paperLabel ?? t('context.header.paper');
      }
      if (source.nodeType === 'concept') {
        return conceptLabel ?? t('context.header.concept');
      }
      if (source.nodeType === 'note') {
        return note?.title?.trim() ? truncateLabel(note.title, 36) : t('context.header.note');
      }
      return buildMemoLabel(memo?.text, t('context.header.memo'));
    case 'memo':
      return buildMemoLabel(memo?.text, t('context.header.memo'));
    case 'note':
      return note?.title?.trim() ? truncateLabel(note.title, 36) : t('context.header.note');
    case 'allSelected':
      return t('context.header.allSelected');
    case 'empty':
      return t('context.title');
  }
}

const iconBtnStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  borderRadius: 'var(--radius-sm)',
  flexShrink: 0,
  transition: 'background-color var(--duration-fast) var(--easing-default)',
};

export function ContextHeader() {
  const { t } = useTranslation();
  const contextPanelPinned = useAppStore((s) => s.contextPanelPinned);
  const peekSource = useAppStore((s) => s.peekSource);
  const pinContextPanel = useAppStore((s) => s.pinContextPanel);
  const unpinContextPanel = useAppStore((s) => s.unpinContextPanel);
  const toggleContextPanel = useAppStore((s) => s.toggleContextPanel);
  const navigateTo = useAppStore((s) => s.navigateTo);

  const effectiveSource = useEffectiveSource();
  const derivedSource = useDerivedContextSource();
  const isPeeking = peekSource !== null && contextPanelPinned;

  const icon = resolveEntityIcon(effectiveSource);
  const name = useResolvedEntityName(effectiveSource, t);

  const handlePinClick = useCallback(() => {
    if (isPeeking) {
      if (peekSource) {
        pinContextPanel(peekSource);
      }
    } else if (contextPanelPinned) {
      unpinContextPanel();
    } else {
      pinContextPanel(derivedSource);
    }
  }, [isPeeking, contextPanelPinned, peekSource, derivedSource, pinContextPanel, unpinContextPanel]);

  const pinIcon = isPeeking ? (
    <Eye size={14} style={{ color: 'var(--info, #a855f7)' }} />
  ) : contextPanelPinned ? (
    <PinOff size={14} style={{ color: 'var(--accent-color)' }} />
  ) : (
    <Pin size={14} style={{ color: 'var(--text-muted)' }} />
  );

  const pinTooltip = isPeeking
    ? t('context.preview')
    : contextPanelPinned
      ? t('context.unpin')
      : t('context.pin');

  return (
    <div
      className="context-header-shell"
      style={{
        height: 44,
        padding: '0 8px 0 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0,
        position: 'relative',
        backgroundColor: 'color-mix(in srgb, var(--lens-surface-strong) 86%, transparent)',
      }}
    >
      {/* 钉住状态指示线 */}
      {contextPanelPinned && (
        <div
          className="context-header-pin-line"
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 2,
            backgroundColor: 'var(--warning)',
          }}
        />
      )}

      {/* 偷看指示线 */}
      {isPeeking && (
        <div
          className="context-header-peek-line"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            backgroundColor: 'var(--info, #a855f7)',
          }}
        />
      )}

      {/* Pin 按钮 */}
      <button
        onClick={handlePinClick}
        title={pinTooltip}
        className="ghost-btn context-header-icon-btn"
        style={iconBtnStyle}
      >
        {pinIcon}
      </button>

      {/* 实体图标 + 名称 */}
      <div
        className="context-header-title-row"
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        {icon && (
          <span className="context-header-entity-icon" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{icon}</span>
        )}
        <span
          className="context-header-title"
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            letterSpacing: '0.01em',
          }}
        >
          {isPeeking && (
            <span className="context-header-preview-label" style={{ color: 'var(--info, #a855f7)', marginRight: 4, fontWeight: 500 }}>{t('context.preview')}:</span>
          )}
          {name}
        </span>
      </div>

      {/* ⋮ 更多菜单 */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            className="ghost-btn context-header-icon-btn"
            style={iconBtnStyle}
          >
            <MoreVertical size={14} style={{ color: 'var(--text-muted)' }} />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="workspace-floating-menu context-header-menu"
            sideOffset={4}
            align="end"
            style={{
              minWidth: 180,
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              padding: 4,
              boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
              zIndex: Z_INDEX.DROPDOWN,
              animationDuration: '120ms',
            }}
          >
            {/* 在 Reader 中打开 */}
            {effectiveSource.type === 'paper' && (
              <DropdownMenu.Item
                onSelect={() =>
                  navigateTo({
                    type: 'paper',
                    id: effectiveSource.paperId,
                    view: 'reader',
                  })
                }
                style={menuItemStyle}
                className="ghost-btn"
              >
                <FileText size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                {t('context.openInReader')}
              </DropdownMenu.Item>
            )}

            {effectiveSource.type === 'paper' && (
              <DropdownMenu.Item
                onSelect={() => {
                  // TODO: 复制 BibTeX 到剪贴板
                }}
                style={menuItemStyle}
                className="ghost-btn"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                {t('context.copyCitation')}
              </DropdownMenu.Item>
            )}

            {effectiveSource.type === 'paper' && (
              <>
                <DropdownMenu.Item
                  onSelect={() =>
                    navigateTo({
                      type: 'paper',
                      id: effectiveSource.paperId,
                      view: 'analysis',
                    })
                  }
                  style={menuItemStyle}
                  className="ghost-btn"
                >
                  <Lightbulb size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  {t('context.viewAnalysisReport')}
                </DropdownMenu.Item>
                <DropdownMenu.Separator style={separatorStyle} />
              </>
            )}

            <DropdownMenu.Item
              onSelect={() => {
                const key = contextSourceKey(effectiveSource);
                useChatStore.getState().clearSession(key);
              }}
              style={menuItemStyle}
              className="ghost-btn"
            >
              <Trash2 size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              {t('context.clearChat')}
            </DropdownMenu.Item>

            <DropdownMenu.Item
              onSelect={() => toggleContextPanel()}
              style={menuItemStyle}
              className="ghost-btn"
            >
              <PanelRightClose size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              {t('context.closePanel')}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

const menuItemStyle: React.CSSProperties = {
  padding: '7px 10px',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  fontSize: 13,
  color: 'var(--text-primary)',
  outline: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  transition: 'background-color var(--duration-fast) var(--easing-default)',
};

const separatorStyle: React.CSSProperties = {
  height: 1,
  backgroundColor: 'var(--border-subtle)',
  margin: '4px 0',
};
