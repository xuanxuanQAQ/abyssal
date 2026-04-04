/**
 * NotesFilterSidebar — search-first filter panel for NotesView.
 *
 * Default path keeps only full-text search visible.
 * Paper / concept / tag filters stay available behind an advanced toggle.
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
  const [advancedOpen, setAdvancedOpen] = useState(() => Boolean(
    (filter.paperIds?.length ?? 0) > 0
    || (filter.conceptIds?.length ?? 0) > 0
    || (filter.tags?.length ?? 0) > 0,
  ));
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
  const hasAdvancedFilters = selectedPapers.length > 0 || selectedConcepts.length > 0 || selectedTags.length > 0;
  const hasActiveFilters = Boolean(searchInput || hasAdvancedFilters);
  const advancedSummary = [
    selectedPapers.length > 0 ? `${t('notes.filter.papers')} ${selectedPapers.length}` : null,
    selectedConcepts.length > 0 ? `${t('notes.filter.concepts')} ${selectedConcepts.length}` : null,
    selectedTags.length > 0 ? `${t('common.tags')} ${selectedTags.length}` : null,
  ].filter((value): value is string => Boolean(value));

  useEffect(() => {
    if (hasAdvancedFilters) {
      setAdvancedOpen(true);
    }
  }, [hasAdvancedFilters]);

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

      <div>
        <button
          type="button"
          onClick={() => setAdvancedOpen((open) => !open)}
          aria-expanded={advancedOpen}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 10px', border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm, 4px)', background: 'var(--bg-surface-low, var(--bg-surface))',
            color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12,
          }}
        >
          <span>{t('notes.filter.advanced')}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {hasAdvancedFilters && (
              <span style={{
                minWidth: 18, height: 18, padding: '0 5px',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 999, backgroundColor: 'var(--bg-surface-high, rgba(0,0,0,0.06))',
                color: 'var(--text-primary)', fontSize: 11,
              }}>
                {selectedPapers.length + selectedConcepts.length + selectedTags.length}
              </span>
            )}
            <ChevronDown
              size={12}
              style={{ transform: advancedOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }}
            />
          </span>
        </button>

        {!advancedOpen && advancedSummary.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
            {advancedSummary.map((item) => (
              <span
                key={item}
                style={{
                  padding: '2px 8px', borderRadius: 999,
                  backgroundColor: 'var(--bg-surface-high, var(--bg-surface))',
                  color: 'var(--text-muted)', fontSize: 11,
                }}
              >
                {item}
              </span>
            ))}
          </div>
        )}

        {advancedOpen && (
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 14,
            marginTop: 8, padding: 10,
            border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm, 4px)',
            background: 'var(--bg-surface-low, var(--bg-surface))',
          }}>
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
          </div>
        )}
      </div>

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
