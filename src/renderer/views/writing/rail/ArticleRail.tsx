/**
 * ArticleRail — 多变体概览 & 全局大纲搜索（§7 ArticleRail 上帝视角）
 *
 * 三大能力：
 *   1. 多变体概览卡片：名称 / 风格 / 章节数 / 字数 / 更新时间 / 进度
 *   2. 全局大纲搜索：跨变体搜索章节标题
 *   3. 多变体结构透视：宏观差异对比
 */

import React, { useState, useMemo, useCallback } from 'react';
import { useDraftList, useDraftOutline } from '../../../core/ipc/hooks/useDrafts';
import { computeHighlightSegments } from '../../library/hooks/useSearchHighlight';
import { ARTICLE_STYLE_LABELS } from '../../../../core/types/article';
import type { ArticleStyle } from '../../../../core/types/article';
import type { SectionNode, DraftOutline } from '../../../../shared-types/models';

// ── Types ──

interface ArticleRailProps {
  articleId: string;
  activeDraftId: string | null;
  onSelectDraft: (draftId: string) => void;
}

interface RouteCardData {
  id: string;
  title: string;
  style: string;
  styleLabel: string;
  totalSections: number;
  totalWords: number;
  updatedAt: string;
  progress: number; // 0–1
  sectionTitles: Array<{ id: string; title: string; depth: number }>;
}

// ── Helpers ──

function summarizeSections(sections: SectionNode[]): { totalSections: number; totalWords: number } {
  let totalSections = 0;
  let totalWords = 0;
  const stack = [...sections];
  while (stack.length > 0) {
    const current = stack.pop()!;
    totalSections += 1;
    totalWords += current.wordCount;
    for (const child of current.children) stack.push(child);
  }
  return { totalSections, totalWords };
}

function computeProgress(sections: SectionNode[]): number {
  let total = 0;
  let completed = 0;
  const stack = [...sections];
  while (stack.length > 0) {
    const current = stack.pop()!;
    total += 1;
    if (current.status === 'finalized' || current.status === 'revised') completed += 1;
    for (const child of current.children) stack.push(child);
  }
  return total === 0 ? 0 : completed / total;
}

function collectSectionTitles(sections: SectionNode[], depth = 0): Array<{ id: string; title: string; depth: number }> {
  const result: Array<{ id: string; title: string; depth: number }> = [];
  for (const section of sections) {
    result.push({ id: section.id, title: section.title, depth });
    result.push(...collectSectionTitles(section.children, depth + 1));
  }
  return result;
}

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(isoDate).toLocaleDateString('zh-CN');
}

// ── Sub-components ──

function RouteOutlineFetcher({
  draftId,
  onData,
}: {
  draftId: string;
  onData: (draftId: string, outline: DraftOutline) => void;
}) {
  const { data } = useDraftOutline(draftId);
  React.useEffect(() => {
    if (data) onData(draftId, data);
  }, [data, draftId, onData]);
  return null;
}

// ── Styles ──

const railContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  overflow: 'hidden',
  borderRight: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)',
};

const railHeaderStyle: React.CSSProperties = {
  padding: '12px 12px 8px',
  fontSize: '11px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  color: 'var(--text-muted)',
};

const searchInputStyle: React.CSSProperties = {
  margin: '0 10px 8px',
  padding: '5px 8px',
  borderRadius: 6,
  border: '1px solid var(--border-subtle)',
  backgroundColor: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  fontSize: '12px',
  outline: 'none',
};

const cardsContainerStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  overflowX: 'hidden',
  padding: '0 8px 8px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const cardStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  backgroundColor: 'var(--bg-surface)',
  cursor: 'pointer',
  transition: 'border-color 120ms ease, box-shadow 120ms ease',
};

const cardActiveStyle: React.CSSProperties = {
  ...cardStyle,
  borderColor: 'var(--accent-color)',
  boxShadow: '0 0 0 1px var(--accent-color)',
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--text-primary)',
  margin: 0,
  lineHeight: 1.3,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const cardMetaRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 4,
  fontSize: '11px',
  color: 'var(--text-muted)',
  flexWrap: 'wrap',
};

const progressBarContainerStyle: React.CSSProperties = {
  marginTop: 6,
  height: 3,
  borderRadius: 2,
  backgroundColor: 'var(--border-subtle)',
  overflow: 'hidden',
};

const searchResultDraftLabelStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  color: 'var(--text-muted)',
  padding: '6px 4px 2px',
};

const searchResultItemStyle: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--text-secondary)',
  padding: '3px 4px 3px 12px',
  cursor: 'pointer',
  borderRadius: 4,
  lineHeight: 1.4,
};

// ── Main Component ──

export function ArticleRail({ articleId, activeDraftId, onSelectDraft }: ArticleRailProps): React.JSX.Element {
  const [searchQuery, setSearchQuery] = useState('');
  const [outlineCache, setOutlineCache] = useState<Map<string, DraftOutline>>(
    () => new Map(),
  );

  const { data: drafts = [] } = useDraftList(articleId);

  const handleOutlineData = useCallback((draftId: string, outline: DraftOutline) => {
    setOutlineCache((prev) => {
      if (prev.get(draftId) === outline) return prev;
      const next = new Map(prev);
      next.set(draftId, outline);
      return next;
    });
  }, []);

  // Build card data from cached outlines
  const routeCards: RouteCardData[] = useMemo(() => {
    return drafts.map((draft) => {
      const outline = outlineCache.get(draft.id);
      const sections = outline?.sections ?? [];
      const { totalSections, totalWords } = summarizeSections(sections);
      const progress = computeProgress(sections);
      const style = draft.metadata?.writingStyle ?? '';
      return {
        id: draft.id,
        title: draft.title,
        style,
        styleLabel: ARTICLE_STYLE_LABELS[style as ArticleStyle] ?? '',
        totalSections,
        totalWords,
        updatedAt: draft.updatedAt,
        progress,
        sectionTitles: collectSectionTitles(sections),
      };
    });
  }, [drafts, outlineCache]);

  // Global outline search results
  const searchResults = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return null;
    const lowerQ = q.toLowerCase();

    const results: Array<{
      draftId: string;
      draftTitle: string;
      sections: Array<{ id: string; title: string; depth: number }>;
    }> = [];

    for (const card of routeCards) {
      const matched = card.sectionTitles.filter((s) =>
        s.title.toLowerCase().includes(lowerQ),
      );
      if (matched.length > 0) {
        results.push({
          draftId: card.id,
          draftTitle: card.title,
          sections: matched,
        });
      }
    }
    return results;
  }, [searchQuery, routeCards]);

  const isSearching = searchQuery.trim().length > 0;

  return (
    <div style={railContainerStyle}>
      <div style={railHeaderStyle}>变体概览</div>

      <input
        style={searchInputStyle}
        type="text"
        placeholder="搜索章节标题…"
        aria-label="全局大纲搜索"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />

      {/* Invisible fetchers to populate outline cache */}
      {drafts.map((d) => (
        <RouteOutlineFetcher
          key={d.id}
          draftId={d.id}
          onData={handleOutlineData}
        />
      ))}

      <div style={cardsContainerStyle}>
        {isSearching && searchResults !== null ? (
          // ── Search results view ──
          searchResults.length === 0 ? (
            <div style={{ padding: '16px 4px', color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center' }}>
              未找到匹配的章节
            </div>
          ) : (
            searchResults.map((group) => (
              <div key={group.draftId}>
                <div style={searchResultDraftLabelStyle}>{group.draftTitle}</div>
                {group.sections.map((section) => {
                  const segments = computeHighlightSegments(section.title, searchQuery);
                  return (
                    <div
                      key={section.id}
                      style={{
                        ...searchResultItemStyle,
                        paddingLeft: 12 + section.depth * 10,
                      }}
                      onClick={() => onSelectDraft(group.draftId)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') onSelectDraft(group.draftId);
                      }}
                    >
                      {segments.map((seg, i) =>
                        seg.highlighted ? (
                          <mark
                            key={i}
                            style={{
                              backgroundColor: 'var(--accent-color)',
                              color: 'var(--text-on-accent)',
                              borderRadius: 2,
                              padding: '0 1px',
                            }}
                          >
                            {seg.text}
                          </mark>
                        ) : (
                          <span key={i}>{seg.text}</span>
                        ),
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )
        ) : (
          // ── Route cards view ──
          routeCards.map((card) => (
            <div
              key={card.id}
              style={card.id === activeDraftId ? cardActiveStyle : cardStyle}
              onClick={() => onSelectDraft(card.id)}
              role="button"
              tabIndex={0}
              aria-label={`变体 ${card.title}`}
              aria-current={card.id === activeDraftId ? 'true' : undefined}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onSelectDraft(card.id);
              }}
            >
              <div style={cardTitleStyle} title={card.title}>{card.title}</div>
              {card.styleLabel && (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 2 }}>
                  {card.styleLabel}
                </div>
              )}
              <div style={cardMetaRowStyle}>
                <span>{card.totalSections} 章节</span>
                <span>{card.totalWords.toLocaleString()} 字</span>
                <span>{formatRelativeTime(card.updatedAt)}</span>
              </div>
              <div style={progressBarContainerStyle}>
                <div
                  style={{
                    height: '100%',
                    borderRadius: 2,
                    backgroundColor: 'var(--accent-color)',
                    width: `${Math.round(card.progress * 100)}%`,
                    transition: 'width 300ms ease',
                  }}
                />
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: 2, textAlign: 'right' }}>
                {Math.round(card.progress * 100)}% 完成
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
