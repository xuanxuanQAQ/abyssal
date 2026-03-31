/**
 * MemoFilterBar — 碎片笔记过滤栏（§3.2）
 *
 * Provides inline search + concept/paper/tag filter dropdowns.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Filter, X } from 'lucide-react';
import type { MemoFilter } from '../../../../shared-types/models';

interface MemoFilterBarProps {
  filter: MemoFilter;
  onFilterChange: (filter: MemoFilter) => void;
  concepts?: Array<{ id: string; nameEn: string }>;
  allTags?: string[];
}

export function MemoFilterBar({ filter, onFilterChange, concepts = [], allTags = [] }: MemoFilterBarProps) {
  const { t } = useTranslation();
  const [searchText, setSearchText] = useState(filter.searchText ?? '');
  const [showFilterPopup, setShowFilterPopup] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setSearchText(value);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const next: MemoFilter = { ...filter };
        if (value) {
          next.searchText = value;
        } else {
          delete next.searchText;
        }
        onFilterChange(next);
      }, 300);
    },
    [filter, onFilterChange],
  );

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const activeFilterCount =
    (filter.conceptIds?.length ?? 0) +
    (filter.paperIds?.length ?? 0) +
    (filter.tags?.length ?? 0);

  const handleConceptToggle = useCallback((conceptId: string) => {
    const current = filter.conceptIds ?? [];
    const updated = current.includes(conceptId)
      ? current.filter((id) => id !== conceptId)
      : [...current, conceptId];
    const next = { ...filter };
    if (updated.length > 0) { next.conceptIds = updated; } else { delete next.conceptIds; }
    onFilterChange(next);
  }, [filter, onFilterChange]);

  const handleTagToggle = useCallback((tag: string) => {
    const current = filter.tags ?? [];
    const updated = current.includes(tag)
      ? current.filter((t) => t !== tag)
      : [...current, tag];
    const next = { ...filter };
    if (updated.length > 0) { next.tags = updated; } else { delete next.tags; }
    onFilterChange(next);
  }, [filter, onFilterChange]);

  const handleClearFilters = useCallback(() => {
    const next: MemoFilter = {};
    if (filter.searchText) next.searchText = filter.searchText;
    onFilterChange(next);
    setShowFilterPopup(false);
  }, [filter, onFilterChange]);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0,
    }}>
      <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
      <input
        type="text"
        value={searchText}
        onChange={handleSearchChange}
        placeholder={t('notes.memo.searchPlaceholder')}
        style={{
          flex: 1, border: 'none', outline: 'none', backgroundColor: 'transparent',
          color: 'var(--text-primary)', fontSize: 13,
        }}
      />

      {/* Filter toggle */}
      {(concepts.length > 0 || allTags.length > 0) && (
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowFilterPopup(!showFilterPopup)}
            style={{
              display: 'flex', alignItems: 'center', gap: 3, padding: '3px 8px',
              border: '1px solid var(--border-subtle)', borderRadius: 4,
              background: activeFilterCount > 0 ? 'var(--accent-color)' : 'transparent',
              color: activeFilterCount > 0 ? '#fff' : 'var(--text-muted)',
              fontSize: 11, cursor: 'pointer',
            }}
          >
            <Filter size={11} />
            {activeFilterCount > 0 && <span>{activeFilterCount}</span>}
          </button>

          {/* Filter popup */}
          {showFilterPopup && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 4,
              width: 220, backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md,6px)', boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
              zIndex: 100, padding: 8, maxHeight: 300, overflow: 'auto',
            }}>
              {/* Concepts */}
              {concepts.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>
                    {t('common.concepts')}
                  </div>
                  {concepts.slice(0, 10).map((c) => (
                    <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '2px 0', fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={(filter.conceptIds ?? []).includes(c.id)}
                        onChange={() => handleConceptToggle(c.id)}
                        style={{ margin: 0 }}
                      />
                      <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.nameEn}
                      </span>
                    </label>
                  ))}
                </div>
              )}

              {/* Tags */}
              {allTags.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>
                    {t('common.tags')}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {allTags.map((tag) => (
                      <button
                        key={tag}
                        onClick={() => handleTagToggle(tag)}
                        style={{
                          padding: '2px 8px', fontSize: 11, border: 'none', borderRadius: 10, cursor: 'pointer',
                          background: (filter.tags ?? []).includes(tag) ? 'var(--accent-color)' : 'var(--bg-surface-high, var(--bg-surface))',
                          color: (filter.tags ?? []).includes(tag) ? '#fff' : 'var(--text-muted)',
                        }}
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Clear filters */}
              {activeFilterCount > 0 && (
                <button
                  onClick={handleClearFilters}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4, width: '100%',
                    padding: '4px 0', fontSize: 11, border: 'none', background: 'none',
                    color: 'var(--text-muted)', cursor: 'pointer',
                  }}
                >
                  <X size={10} /> {t('notes.filter.clearAll')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
