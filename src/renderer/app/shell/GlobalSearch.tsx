/**
 * GlobalSearch — 命令面板 / 全局搜索弹层（§8）
 *
 * Ctrl+K 触发的模态弹层：
 * - 搜索论文、概念、文章节
 * - ">" 前缀切换命令模式
 * - 键盘导航（↑↓/Enter/Esc/Tab）
 * - 最近访问记录
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Search,
  FileText,
  Lightbulb,
  PenTool,
  StickyNote,
  BookOpen,
  Zap,
  X,
  Loader2,
} from 'lucide-react';
import { useAppStore } from '../../core/store';
import { useHotkey } from '../../core/hooks/useHotkey';
import { getAPI } from '../../core/ipc/bridge';
import { emitUserAction } from '../../core/hooks/useEventBridge';
import { Z_INDEX } from '../../styles/zIndex';
import type { GlobalSearchResult } from '../../../shared-types/models';
import type { NavigationTarget } from '../../core/navigation/types';

// ═══ 搜索结果类型 ═══

interface SearchResultItem {
  id: string;
  type: 'paper' | 'concept' | 'section' | 'command' | 'memo' | 'note';
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  action: () => void;
}

// ═══ 命令列表（§8.4）═══

function getCommands(
  t: (key: string) => string,
  dispatch: {
    openImportBibtex: () => void;
    navigateToWriting: () => void;
    toggleDarkMode: () => void;
    closeSearch: () => void;
  },
): SearchResultItem[] {
  return [
    {
      id: 'cmd:import-bibtex',
      type: 'command',
      title: t('globalSearch.commands.importBibtex'),
      icon: <Zap size={14} />,
      action: dispatch.openImportBibtex,
    },
    {
      id: 'cmd:new-article',
      type: 'command',
      title: t('globalSearch.commands.newArticle'),
      icon: <Zap size={14} />,
      action: dispatch.navigateToWriting,
    },
    {
      id: 'cmd:toggle-dark',
      type: 'command',
      title: t('globalSearch.commands.toggleDarkMode'),
      icon: <Zap size={14} />,
      action: dispatch.toggleDarkMode,
    },
  ];
}

// ═══ 搜索结果实体配置 ═══

interface EntityConfig {
  icon: React.ReactNode;
  toTarget: (r: GlobalSearchResult) => NavigationTarget;
}

const ENTITY_CONFIG: Record<string, EntityConfig> = {
  paper:   { icon: <FileText size={14} />,  toTarget: (r) => ({ type: 'paper', id: r.entityId, view: 'reader' }) },
  concept: { icon: <Lightbulb size={14} />, toTarget: (r) => ({ type: 'concept', id: r.entityId }) },
  article: { icon: <PenTool size={14} />,   toTarget: (r) => ({ type: 'section', articleId: r.entityId, sectionId: r.entityId }) },
  memo:    { icon: <StickyNote size={14} />, toTarget: (r) => ({ type: 'memo', memoId: r.entityId }) },
  note:    { icon: <BookOpen size={14} />,   toTarget: (r) => ({ type: 'note', noteId: r.entityId }) },
};

// ═══ 辅助：从 NavigationTarget 生成可读标题 ═══

function getTargetDisplayTitle(t: (key: string) => string, target: NavigationTarget): string {
  switch (target.type) {
    case 'paper':
      return `${t('globalSearch.categories.papers')}: ${target.id.slice(0, 8)}…`;
    case 'concept':
      return `${t('globalSearch.categories.concepts')}: ${target.id.slice(0, 8)}…`;
    case 'section':
      return `${t('globalSearch.categories.sections')}: ${target.sectionId.slice(0, 8)}…`;
    case 'graph':
      return `${t('globalSearch.categories.graphNodes')}: ${target.focusNodeId.slice(0, 8)}…`;
    case 'memo':
      return `${t('globalSearch.categories.papers')}: ${target.memoId.slice(0, 8)}…`;
    case 'note':
      return `${t('globalSearch.categories.papers')}: ${target.noteId.slice(0, 8)}…`;
    default:
      return '—';
  }
}

// ═══ GlobalSearch 组件 ═══

export function GlobalSearch() {
  const { t } = useTranslation();
  const globalSearchOpen = useAppStore((s) => s.globalSearchOpen);
  const closeGlobalSearch = useAppStore((s) => s.closeGlobalSearch);
  const globalSearchQuery = useAppStore((s) => s.globalSearchQuery);
  const setGlobalSearchQuery = useAppStore((s) => s.setGlobalSearchQuery);
  const navigationStack = useAppStore((s) => s.navigationStack);
  const navigateTo = useAppStore((s) => s.navigateTo);

  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const queryIdRef = useRef(0); // stale query guard

  const isCommandMode = globalSearchQuery.startsWith('>');

  // 命令列表
  const commands = useMemo(
    () =>
      getCommands(t, {
        closeSearch: closeGlobalSearch,
        openImportBibtex: () => {
          closeGlobalSearch();
          // TODO: 打开 BibTeX 导入 Dialog
        },
        navigateToWriting: () => {
          closeGlobalSearch();
          useAppStore.getState().switchView('writing');
        },
        toggleDarkMode: () => {
          closeGlobalSearch();
          // TODO: 切换 ThemeContext colorScheme
        },
      }),
    [t, closeGlobalSearch]
  );

  // §8.6 最近访问记录 — 显示可读标题
  const recentItems = useMemo<SearchResultItem[]>(() => {
    if (globalSearchQuery) return [];

    const RECENT_ICON: Record<string, React.ReactNode> = {
      paper: <FileText size={14} />,
      concept: <Lightbulb size={14} />,
      section: <PenTool size={14} />,
      graph: <FileText size={14} />,
      memo: <StickyNote size={14} />,
      note: <BookOpen size={14} />,
    };

    const seen = new Set<string>();
    const items: SearchResultItem[] = [];

    for (let i = navigationStack.length - 1; i >= 0 && items.length < 8; i--) {
      const target = navigationStack[i];
      if (!target) continue;

      let key: string;
      switch (target.type) {
        case 'paper':   key = `paper:${target.id}`; break;
        case 'concept': key = `concept:${target.id}`; break;
        case 'section': key = `section:${target.sectionId}`; break;
        case 'memo':    key = `memo:${target.memoId}`; break;
        case 'note':    key = `note:${target.noteId}`; break;
        case 'graph':   key = `graph:${target.focusNodeId}`; break;
      }

      if (seen.has(key)) continue;
      seen.add(key);

      const displayType = target.type === 'graph' ? 'paper' : target.type;

      items.push({
        id: key,
        type: displayType as SearchResultItem['type'],
        title: getTargetDisplayTitle(t, target),
        icon: RECENT_ICON[target.type] ?? <FileText size={14} />,
        action: () => {
          closeGlobalSearch();
          navigateTo(target);
        },
      });
    }
    return items;
  }, [globalSearchQuery, navigationStack, closeGlobalSearch, navigateTo]);

  // §8.3 搜索（防抖 200ms + stale query guard）
  useEffect(() => {
    if (!globalSearchOpen || !globalSearchQuery) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    if (isCommandMode) {
      const queryText = globalSearchQuery.slice(1).trim().toLowerCase();
      const filtered = commands.filter(
        (c) =>
          c.title.toLowerCase().includes(queryText) ||
          (c.subtitle?.toLowerCase().includes(queryText) ?? false)
      );
      setResults(filtered);
      setHighlightIndex(0);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const thisQueryId = ++queryIdRef.current;
      try {
        const api = getAPI();
        const query = globalSearchQuery;
        emitUserAction({ action: 'search', query, scope: 'global' });

        // 统一全局搜索 API
        const searchResults = await api.app.globalSearch(query).catch(() => [] as GlobalSearchResult[]);

        // stale query guard — 丢弃过时结果
        if (thisQueryId !== queryIdRef.current) return;

        const items: SearchResultItem[] = searchResults
          .filter((r) => ENTITY_CONFIG[r.entityType])
          .map((r) => {
            const cfg = ENTITY_CONFIG[r.entityType]!;
            const displayType = r.entityType === 'article' ? 'section' : r.entityType;
            return {
              id: `${displayType}:${r.entityId}`,
              type: displayType as SearchResultItem['type'],
              title: r.title,
              subtitle: r.content,
              icon: cfg.icon,
              action: () => {
                closeGlobalSearch();
                navigateTo(cfg.toTarget(r));
              },
            };
          });

        setResults(items);
        setHighlightIndex(0);
      } catch {
        if (thisQueryId === queryIdRef.current) {
          setResults([]);
        }
      } finally {
        if (thisQueryId === queryIdRef.current) {
          setIsSearching(false);
        }
      }
    }, 200);

    return () => clearTimeout(debounceRef.current);
  }, [globalSearchQuery, globalSearchOpen, isCommandMode, commands, closeGlobalSearch, navigateTo]);

  // 焦点管理：打开时聚焦输入框
  useEffect(() => {
    if (globalSearchOpen) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [globalSearchOpen]);

  // §8.5 Escape 处理
  const handleEscape = useCallback(() => {
    if (globalSearchQuery) {
      setGlobalSearchQuery('');
    } else {
      closeGlobalSearch();
    }
  }, [globalSearchQuery, setGlobalSearchQuery, closeGlobalSearch]);

  // §8.5 键盘导航
  const displayItems = globalSearchQuery ? results : recentItems;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setHighlightIndex((i) => Math.min(i + 1, displayItems.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Enter': {
          e.preventDefault();
          const item = displayItems[highlightIndex];
          if (item) item.action();
          break;
        }
        case 'Escape':
          e.preventDefault();
          handleEscape();
          break;
      }
    },
    [displayItems, highlightIndex, handleEscape]
  );

  // 全局 Ctrl+K 快捷键
  useHotkey('Ctrl+K', () => {
    if (globalSearchOpen) {
      closeGlobalSearch();
    } else {
      useAppStore.getState().openGlobalSearch();
    }
  });

  if (!globalSearchOpen) return null;

  return (
    <>
      {/* §8.2 遮罩层 */}
      <div
        className="global-search-backdrop"
        style={{ zIndex: Z_INDEX.MODAL_BACKDROP }}
        onClick={closeGlobalSearch}
      />

      {/* §8.2 弹层 */}
      <div
        className="global-search-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('globalSearch.title')}
        style={{ zIndex: Z_INDEX.MODAL }}
        onKeyDown={handleKeyDown}
      >
        {/* 搜索输入框 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          {isSearching
            ? <Loader2 size={16} style={{ color: 'var(--accent-color)', flexShrink: 0, animation: 'spin 1s linear infinite' }} />
            : <Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          }
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={displayItems.length > 0}
            aria-controls="global-search-results"
            value={globalSearchQuery}
            onChange={(e) => setGlobalSearchQuery(e.target.value)}
            placeholder={isCommandMode ? t('globalSearch.commandPlaceholder') : t('globalSearch.placeholder')}
            style={{
              flex: 1,
              background: 'none',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              fontSize: 'var(--text-md)',
            }}
          />
          {globalSearchQuery && (
            <button
              onClick={() => setGlobalSearchQuery('')}
              aria-label={t('globalSearch.clearSearch')}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                padding: 2,
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* 结果列表 */}
        <div
          id="global-search-results"
          role="listbox"
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '4px 0',
          }}
        >
          {/* 分组标题 */}
          {!globalSearchQuery && recentItems.length > 0 && (
            <div style={{ padding: '6px 16px', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 600 }}>
              {t('globalSearch.recent')}
            </div>
          )}

          {displayItems.map((item, index) => (
            <div
              key={item.id}
              role="option"
              aria-selected={index === highlightIndex}
              onClick={item.action}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                cursor: 'pointer',
                backgroundColor:
                  index === highlightIndex ? 'var(--bg-hover)' : 'transparent',
                borderLeft:
                  index === highlightIndex
                    ? '2px solid var(--accent-color)'
                    : '2px solid transparent',
              }}
              onMouseEnter={() => setHighlightIndex(index)}
            >
              <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                {item.icon}
              </span>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div
                  style={{
                    color: 'var(--text-primary)',
                    fontSize: 'var(--text-sm)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.title}
                </div>
                {item.subtitle && (
                  <div
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: 'var(--text-xs)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.subtitle}
                  </div>
                )}
              </div>
            </div>
          ))}

          {globalSearchQuery && !isCommandMode && results.length === 0 && !isSearching && (
            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
              {t('globalSearch.noResults')}
            </div>
          )}
        </div>

        {/* 搜索结果数量通知（屏幕阅读器） */}
        <div aria-live="polite" className="sr-only">
          {globalSearchQuery && !isSearching && t('globalSearch.resultCount', { count: results.length })}
        </div>

        {/* 底部快捷键提示 */}
        <div
          style={{
            padding: '6px 16px',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            gap: 16,
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
          }}
        >
          <span>{t('globalSearch.hints.navigate')}</span>
          <span>{t('globalSearch.hints.open')}</span>
          <span>{t('globalSearch.hints.close')}</span>
          <span style={{ marginLeft: 'auto' }}>{t('globalSearch.hints.commandMode')}</span>
        </div>
      </div>
    </>
  );
}
