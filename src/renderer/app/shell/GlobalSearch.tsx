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
import { Z_INDEX } from '../../styles/zIndex';
import type { GlobalSearchResult } from '../../../shared-types/models';

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

function getCommands(dispatch: {
  openImportBibtex: () => void;
  navigateToWriting: () => void;
  toggleDarkMode: () => void;
  closeSearch: () => void;
}): SearchResultItem[] {
  return [
    {
      id: 'cmd:import-bibtex',
      type: 'command',
      title: '导入 BibTeX 文件',
      subtitle: 'Import BibTeX',
      icon: <Zap size={14} />,
      action: dispatch.openImportBibtex,
    },
    {
      id: 'cmd:new-article',
      type: 'command',
      title: '新建文章',
      subtitle: 'New Article',
      icon: <Zap size={14} />,
      action: dispatch.navigateToWriting,
    },
    {
      id: 'cmd:toggle-dark',
      type: 'command',
      title: '切换深色模式',
      subtitle: 'Toggle Dark Mode',
      icon: <Zap size={14} />,
      action: dispatch.toggleDarkMode,
    },
  ];
}

// ═══ 辅助：从 NavigationTarget 生成可读标题 ═══

function getTargetDisplayTitle(target: Record<string, unknown> & { type: string }): string {
  switch (target.type) {
    case 'paper':
      return `论文: ${String(target.id ?? '').slice(0, 8)}…`;
    case 'concept':
      return `概念: ${String(target.id ?? '').slice(0, 8)}…`;
    case 'section':
      return `章节: ${String(target.sectionId ?? '').slice(0, 8)}…`;
    case 'graph':
      return `图谱节点: ${String(target.focusNodeId ?? '').slice(0, 8)}…`;
    default:
      return '未知';
  }
}

// ═══ GlobalSearch 组件 ═══

export function GlobalSearch() {
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
      getCommands({
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
    [closeGlobalSearch]
  );

  // §8.6 最近访问记录 — 显示可读标题
  const recentItems = useMemo<SearchResultItem[]>(() => {
    if (globalSearchQuery) return [];

    const seen = new Set<string>();
    const items: SearchResultItem[] = [];

    for (let i = navigationStack.length - 1; i >= 0 && items.length < 8; i--) {
      const target = navigationStack[i];
      if (!target) continue;

      let key: string;
      let displayType: 'paper' | 'concept' | 'section' | 'memo' | 'note';
      if (target.type === 'paper') {
        key = `paper:${target.id}`;
        displayType = 'paper';
      } else if (target.type === 'concept') {
        key = `concept:${target.id}`;
        displayType = 'concept';
      } else if (target.type === 'section') {
        key = `section:${target.sectionId}`;
        displayType = 'section';
      } else if (target.type === 'memo') {
        key = `memo:${target.memoId}`;
        displayType = 'memo';
      } else if (target.type === 'note') {
        key = `note:${target.noteId}`;
        displayType = 'note';
      } else {
        key = `graph:${target.focusNodeId}`;
        displayType = 'paper';
      }

      if (seen.has(key)) continue;
      seen.add(key);

      items.push({
        id: key,
        type: displayType,
        title: getTargetDisplayTitle(target as unknown as Record<string, unknown> & { type: string }),
        icon:
          displayType === 'paper' ? <FileText size={14} /> :
          displayType === 'concept' ? <Lightbulb size={14} /> :
          displayType === 'memo' ? <StickyNote size={14} /> :
          displayType === 'note' ? <BookOpen size={14} /> :
          <PenTool size={14} />,
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

        // 统一全局搜索 API
        const searchResults = await api.app.globalSearch(query).catch(() => [] as GlobalSearchResult[]);

        // stale query guard — 丢弃过时结果
        if (thisQueryId !== queryIdRef.current) return;

        const items: SearchResultItem[] = [];

        // 按 entityType 分组: papers, concepts, articles, memos, notes
        const grouped = {
          paper: searchResults.filter((r) => r.entityType === 'paper'),
          concept: searchResults.filter((r) => r.entityType === 'concept'),
          article: searchResults.filter((r) => r.entityType === 'article'),
          memo: searchResults.filter((r) => r.entityType === 'memo'),
          note: searchResults.filter((r) => r.entityType === 'note'),
        };

        for (const p of grouped.paper) {
          items.push({
            id: `paper:${p.entityId}`,
            type: 'paper',
            title: p.title,
            subtitle: p.content,
            icon: <FileText size={14} />,
            action: () => {
              closeGlobalSearch();
              navigateTo({ type: 'paper', id: p.entityId, view: 'reader' });
            },
          });
        }

        for (const c of grouped.concept) {
          items.push({
            id: `concept:${c.entityId}`,
            type: 'concept',
            title: c.title,
            subtitle: c.content,
            icon: <Lightbulb size={14} />,
            action: () => {
              closeGlobalSearch();
              navigateTo({ type: 'concept', id: c.entityId });
            },
          });
        }

        for (const s of grouped.article) {
          items.push({
            id: `section:${s.entityId}`,
            type: 'section',
            title: s.title,
            subtitle: s.content,
            icon: <PenTool size={14} />,
            action: () => {
              closeGlobalSearch();
              navigateTo({ type: 'section', articleId: s.entityId, sectionId: s.entityId });
            },
          });
        }

        for (const m of grouped.memo) {
          items.push({
            id: `memo:${m.entityId}`,
            type: 'memo',
            title: m.title,
            subtitle: m.content,
            icon: <span role="img" aria-label="memo">💡</span>,
            action: () => {
              closeGlobalSearch();
              navigateTo({ type: 'memo', memoId: m.entityId });
            },
          });
        }

        for (const n of grouped.note) {
          items.push({
            id: `note:${n.entityId}`,
            type: 'note',
            title: n.title,
            subtitle: n.content,
            icon: <span role="img" aria-label="note">📓</span>,
            action: () => {
              closeGlobalSearch();
              navigateTo({ type: 'note', noteId: n.entityId });
            },
          });
        }

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
        aria-label="全局搜索"
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
            placeholder={isCommandMode ? '输入命令…' : '搜索论文、概念、文章、笔记…'}
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
              aria-label="清空搜索"
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
              最近访问
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
              无搜索结果
            </div>
          )}
        </div>

        {/* 搜索结果数量通知（屏幕阅读器） */}
        <div aria-live="polite" className="sr-only">
          {globalSearchQuery && !isSearching && `找到 ${results.length} 个结果`}
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
          <span>↑↓ 导航</span>
          <span>↵ 打开</span>
          <span>Esc 关闭</span>
          <span style={{ marginLeft: 'auto' }}>{`> 命令模式`}</span>
        </div>
      </div>
    </>
  );
}
