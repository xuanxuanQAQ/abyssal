/**
 * NotesFilterSidebar — multi-dimensional filter panel for notes view.
 *
 * Dimensions:
 * - Full-text search (500ms debounce)
 * - Associated papers (search-to-select dropdown)
 * - Associated concepts (search-to-select dropdown)
 * - Tags (tag cloud toggle)
 *
 * See spec: section 6.2
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X, Tag, Lightbulb, FileText, ChevronDown } from 'lucide-react';
import type { MemoFilter } from '../../../shared-types/models';

// ─── Props ───

export interface NotesFilterSidebarProps {
  filter: MemoFilter;
  onFilterChange: (filter: MemoFilter) => void;
  concepts: Array<{ id: string; nameEn: string }>;
  papers: Array<{ id: string; title: string }>;
  allTags: string[];
}

// ─── Component ───

export function NotesFilterSidebar({ filter, onFilterChange, concepts, papers, allTags }: NotesFilterSidebarProps) {
  const { t } = useTranslation();
  const [searchInput, setSearchInput] = useState(filter.searchText ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // 500ms debounce for search
  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const next = { ...filter };
      if (value) { next.searchText = value; } else { delete next.searchText; }
      onFilterChange(next);
    }, 500);
  }, [filter, onFilterChange]);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  // ── Paper filter ──
  const handlePaperToggle = useCallback((paperId: string) => {
    const current = filter.paperIds ?? [];
    const updated = current.includes(paperId)
      ? current.filter((id) => id !== paperId)
      : [...current, paperId];
    const next = { ...filter };
    if (updated.length > 0) { next.paperIds = updated; } else { delete next.paperIds; }
    onFilterChange(next);
  }, [filter, onFilterChange]);

  // ── Concept filter ──
  const handleConceptToggle = useCallback((conceptId: string) => {
    const current = filter.conceptIds ?? [];
    const updated = current.includes(conceptId)
      ? current.filter((id) => id !== conceptId)
      : [...current, conceptId];
    const next = { ...filter };
    if (updated.length > 0) { next.conceptIds = updated; } else { delete next.conceptIds; }
    onFilterChange(next);
  }, [filter, onFilterChange]);

  // ── Tag filter ──
  const handleTagToggle = useCallback((tag: string) => {
    const current = filter.tags ?? [];
    const updated = current.includes(tag)
      ? current.filter((t) => t !== tag)
      : [...current, tag];
    const next = { ...filter };
    if (updated.length > 0) { next.tags = updated; } else { delete next.tags; }
    onFilterChange(next);
  }, [filter, onFilterChange]);

  const handleClear = useCallback(() => {
    setSearchInput('');
    onFilterChange({});
  }, [onFilterChange]);

  const selectedPapers = filter.paperIds ?? [];
  const selectedConcepts = filter.conceptIds ?? [];
  const selectedTags = filter.tags ?? [];
  const hasActiveFilters = searchInput || selectedPapers.length > 0 || selectedConcepts.length > 0 || selectedTags.length > 0;

  return (
    <div style={{
      width: 220, flexShrink: 0, borderRight: '1px solid var(--border-subtle)',
      padding: '12px', overflow: 'auto', fontSize: 12,
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      {/* ── Search ── */}
      <div>
        <SectionLabel icon={<Search size={12} />} label={t('common.search')} />
        <input
          type="text"
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder={t('notes.filter.searchPlaceholder')}
          style={inputStyle}
        />
      </div>

      {/* ── Papers ── */}
      <EntitySelector
        icon={<FileText size={12} />}
        label={t('notes.filter.papers')}
        placeholder={t('notes.filter.searchPapers')}
        items={papers}
        selectedIds={selectedPapers}
        onToggle={handlePaperToggle}
        getLabel={(p) => p.title}
        chipColor="#3B82F6"
      />

      {/* ── Concepts ── */}
      <EntitySelector
        icon={<Lightbulb size={12} />}
        label={t('notes.filter.concepts')}
        placeholder={t('notes.filter.searchConcepts')}
        items={concepts}
        selectedIds={selectedConcepts}
        onToggle={handleConceptToggle}
        getLabel={(c) => c.nameEn}
        chipColor="#10B981"
      />

      {/* ── Tags ── */}
      {allTags.length > 0 && (
        <div>
          <SectionLabel icon={<Tag size={12} />} label={t('common.tags')} />
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
                #{tag}
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
          <X size={12} /> {t('notes.filter.clearAll')}
        </button>
      )}
    </div>
  );
}

// ─── Shared sub-components ───

function SectionLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, color: 'var(--text-muted)', fontSize: 11, fontWeight: 600 }}>
      {icon} <span>{label}</span>
    </div>
  );
}

// ─── EntitySelector: search-to-select dropdown + selected chips ───

interface EntitySelectorProps<T extends { id: string }> {
  icon: React.ReactNode;
  label: string;
  placeholder: string;
  items: T[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  getLabel: (item: T) => string;
  chipColor: string;
}

function EntitySelector<T extends { id: string }>({
  icon, label, placeholder, items, selectedIds, onToggle, getLabel, chipColor,
}: EntitySelectorProps<T>) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const filtered = useMemo(() => {
    if (!query) return items.filter((it) => !selectedIds.includes(it.id)).slice(0, 8);
    const q = query.toLowerCase();
    return items
      .filter((it) => !selectedIds.includes(it.id) && getLabel(it).toLowerCase().includes(q))
      .slice(0, 8);
  }, [items, selectedIds, query, getLabel]);

  const selectedItems = useMemo(
    () => items.filter((it) => selectedIds.includes(it.id)),
    [items, selectedIds],
  );

  return (
    <div ref={containerRef}>
      <SectionLabel icon={icon} label={label} />

      {/* Selected chips */}
      {selectedItems.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 6 }}>
          {selectedItems.map((item) => (
            <span
              key={item.id}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '1px 6px', borderRadius: 10, fontSize: 10, maxWidth: '100%',
                color: chipColor, backgroundColor: `${chipColor}12`, border: `1px solid ${chipColor}30`,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {getLabel(item).slice(0, 30)}
              </span>
              <button
                onClick={() => onToggle(item.id)}
                style={{
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  color: 'inherit', display: 'flex', alignItems: 'center', flexShrink: 0,
                }}
              >
                <X size={9} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search trigger / input */}
      <div style={{ position: 'relative' }}>
        <div
          onClick={() => setOpen(true)}
          style={{
            ...inputStyle,
            display: 'flex', alignItems: 'center', cursor: 'text',
          }}
        >
          {open ? (
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              autoFocus
              style={{
                border: 'none', outline: 'none', background: 'transparent',
                color: 'var(--text-primary)', fontSize: 11, width: '100%', padding: 0,
              }}
            />
          ) : (
            <span style={{ color: 'var(--text-muted)', fontSize: 11, flex: 1 }}>
              {placeholder}
            </span>
          )}
          <ChevronDown size={10} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        </div>

        {/* Dropdown */}
        {open && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2,
            backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm, 4px)', boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
            zIndex: 50, maxHeight: 150, overflow: 'auto',
          }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '6px 8px', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
                —
              </div>
            ) : (
              filtered.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    onToggle(item.id);
                    setQuery('');
                  }}
                  style={{
                    display: 'block', width: '100%', padding: '5px 8px', border: 'none',
                    background: 'transparent', color: 'var(--text-primary)', fontSize: 11,
                    cursor: 'pointer', textAlign: 'left',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget).style.backgroundColor = 'var(--bg-surface-high, var(--bg-surface))'; }}
                  onMouseLeave={(e) => { (e.currentTarget).style.backgroundColor = 'transparent'; }}
                >
                  {getLabel(item)}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Styles ───

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '5px 8px', fontSize: 12,
  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm, 4px)',
  background: 'var(--bg-surface-low, var(--bg-surface))', color: 'var(--text-primary)',
  outline: 'none', boxSizing: 'border-box',
};
