/**
 * NotesFilterSidebar — multi-dimensional filter panel for notes view.
 *
 * Dimensions:
 * - Associated concepts (multi-select dropdown)
 * - Associated papers (search autocomplete)
 * - Tags (tag cloud)
 * - Full-text search (500ms debounce)
 * - Time range (date inputs)
 *
 * See spec: section 6.2
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Search, X, Tag, FileText, Lightbulb, Calendar } from 'lucide-react';
import type { MemoFilter } from '../../../shared-types/models';

// ─── Props ───

export interface NotesFilterSidebarProps {
  filter: MemoFilter;
  onFilterChange: (filter: MemoFilter) => void;
  concepts: Array<{ id: string; nameEn: string }>;
  allTags: string[];
}

// ─── Component ───

export function NotesFilterSidebar({ filter, onFilterChange, concepts, allTags }: NotesFilterSidebarProps) {
  const [searchInput, setSearchInput] = useState((filter as Record<string, unknown>)['searchQuery'] as string ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // 500ms debounce for search
  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onFilterChange({ ...filter, searchQuery: value || undefined } as MemoFilter);
    }, 500);
  }, [filter, onFilterChange]);

  // Cleanup
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const handleConceptToggle = useCallback((conceptId: string) => {
    const current = (filter as Record<string, unknown>)['conceptIds'] as string[] | undefined ?? [];
    const next = current.includes(conceptId)
      ? current.filter((id) => id !== conceptId)
      : [...current, conceptId];
    onFilterChange({ ...filter, conceptIds: next.length > 0 ? next : undefined } as MemoFilter);
  }, [filter, onFilterChange]);

  const handleTagToggle = useCallback((tag: string) => {
    const current = (filter as Record<string, unknown>)['tags'] as string[] | undefined ?? [];
    const next = current.includes(tag)
      ? current.filter((t) => t !== tag)
      : [...current, tag];
    onFilterChange({ ...filter, tags: next.length > 0 ? next : undefined } as MemoFilter);
  }, [filter, onFilterChange]);

  const handleClear = useCallback(() => {
    setSearchInput('');
    onFilterChange({});
  }, [onFilterChange]);

  const selectedConcepts = ((filter as Record<string, unknown>)['conceptIds'] as string[] | undefined) ?? [];
  const selectedTags = ((filter as Record<string, unknown>)['tags'] as string[] | undefined) ?? [];
  const hasActiveFilters = searchInput || selectedConcepts.length > 0 || selectedTags.length > 0;

  return (
    <div style={{
      width: 200, flexShrink: 0, borderRight: '1px solid var(--border-subtle)',
      padding: '12px', overflow: 'auto', fontSize: 12,
      display: 'flex', flexDirection: 'column', gap: 16,
    }}>
      {/* ── Search ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, color: 'var(--text-muted)' }}>
          <Search size={12} /> <span>Search</span>
        </div>
        <input
          type="text"
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search notes..."
          style={{
            width: '100%', padding: '5px 8px', fontSize: 12,
            border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm, 4px)',
            background: 'var(--bg-surface-low, var(--bg-surface))', color: 'var(--text-primary)',
            outline: 'none',
          }}
        />
      </div>

      {/* ── Concepts ── */}
      {concepts.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, color: 'var(--text-muted)' }}>
            <Lightbulb size={12} /> <span>Concepts</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 150, overflow: 'auto' }}>
            {concepts.map((c) => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '2px 0' }}>
                <input
                  type="checkbox"
                  checked={selectedConcepts.includes(c.id)}
                  onChange={() => handleConceptToggle(c.id)}
                  style={{ margin: 0 }}
                />
                <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.nameEn}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* ── Tags ── */}
      {allTags.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, color: 'var(--text-muted)' }}>
            <Tag size={12} /> <span>Tags</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => handleTagToggle(tag)}
                style={{
                  padding: '2px 8px', fontSize: 11, border: 'none', borderRadius: 10, cursor: 'pointer',
                  background: selectedTags.includes(tag) ? 'var(--accent-color)' : 'var(--bg-surface-high, var(--bg-surface))',
                  color: selectedTags.includes(tag) ? '#fff' : 'var(--text-muted)',
                }}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Clear ── */}
      {hasActiveFilters && (
        <button
          onClick={handleClear}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            padding: '6px 0', fontSize: 11, border: 'none', borderRadius: 'var(--radius-sm, 4px)',
            background: 'none', color: 'var(--text-muted)', cursor: 'pointer',
          }}
        >
          <X size={12} /> Clear all filters
        </button>
      )}
    </div>
  );
}
