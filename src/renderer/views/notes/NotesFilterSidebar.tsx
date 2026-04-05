/**
 * NotesFilterSidebar  筛选面板
 *
 * 全文搜索 + 高级筛选（论文/概念/标签）。
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X, Tag, Lightbulb, FileText, ChevronDown } from 'lucide-react';
import type { MemoFilter } from '../../../shared-types/models';

export interface NotesFilterSidebarProps {
  filter: MemoFilter;
  onFilterChange: (filter: MemoFilter) => void;
  concepts: Array<{ id: string; nameEn: string }>;
  papers: Array<{ id: string; title: string }>;
  allTags: string[];
}

export function NotesFilterSidebar({ filter, onFilterChange, concepts, papers, allTags }: NotesFilterSidebarProps) {
  const { t } = useTranslation();
  const [searchInput, setSearchInput] = useState(filter.searchText ?? '');
  const [advancedOpen, setAdvancedOpen] = useState(() => Boolean(
    (filter.paperIds?.length ?? 0) > 0 || (filter.conceptIds?.length ?? 0) > 0 || (filter.tags?.length ?? 0) > 0,
  ));
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => { setSearchInput(filter.searchText ?? ''); }, [filter.searchText]);

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

  const handlePaperToggle = useCallback((paperId: string) => {
    const current = filter.paperIds ?? [];
    const updated = current.includes(paperId) ? current.filter((id) => id !== paperId) : [...current, paperId];
    const next = { ...filter };
    if (updated.length > 0) { next.paperIds = updated; } else { delete next.paperIds; }
    onFilterChange(next);
  }, [filter, onFilterChange]);

  const handleConceptToggle = useCallback((conceptId: string) => {
    const current = filter.conceptIds ?? [];
    const updated = current.includes(conceptId) ? current.filter((id) => id !== conceptId) : [...current, conceptId];
    const next = { ...filter };
    if (updated.length > 0) { next.conceptIds = updated; } else { delete next.conceptIds; }
    onFilterChange(next);
  }, [filter, onFilterChange]);

  const handleTagToggle = useCallback((tag: string) => {
    const current = filter.tags ?? [];
    const updated = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag];
    const next = { ...filter };
    if (updated.length > 0) { next.tags = updated; } else { delete next.tags; }
    onFilterChange(next);
  }, [filter, onFilterChange]);

  const handleClear = useCallback(() => { setSearchInput(''); onFilterChange({}); }, [onFilterChange]);

  const selectedPapers = filter.paperIds ?? [];
  const selectedConcepts = filter.conceptIds ?? [];
  const selectedTags = filter.tags ?? [];
  const advancedCount = selectedPapers.length + selectedConcepts.length + selectedTags.length;
  const hasActiveFilters = Boolean(searchInput || advancedCount > 0);

  useEffect(() => { if (advancedCount > 0) setAdvancedOpen(true); }, [advancedCount]);

  return (
    <div style={sidebarStyle}>
      {/* Search */}
      <div style={{ position: 'relative' }}>
        <Search size={13} style={{ position: 'absolute', top: 8, left: 8, color: 'var(--text-muted)' }} />
        <input
          type="text"
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder={t('notes.filter.searchPlaceholder')}
          style={{ ...inputStyle, paddingLeft: 28 }}
        />
        {searchInput && (
          <button
            type="button"
            onClick={() => handleSearchChange('')}
            style={{ position: 'absolute', top: 7, right: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 0 }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {hasActiveFilters && (
        <button type="button" onClick={handleClear} style={clearBtnStyle}>
          {t('notes.filter.clearAll')}
        </button>
      )}

      {/* Advanced filters */}
      <button
        type="button"
        onClick={() => setAdvancedOpen((o) => !o)}
        aria-expanded={advancedOpen}
        style={advancedHeaderStyle}
      >
        <span>{t('notes.filter.advanced')}{advancedCount > 0 ? ` (${advancedCount})` : ''}</span>
        <ChevronDown size={12} style={{ transform: advancedOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>

      {advancedOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
                    type="button"
                    onClick={() => handleTagToggle(tag)}
                    style={{
                      padding: '3px 8px', fontSize: 11, borderRadius: 999, cursor: 'pointer',
                      border: selectedTags.includes(tag)
                        ? '1px solid color-mix(in srgb, var(--accent-color) 30%, transparent)'
                        : '1px solid var(--border-subtle)',
                      background: selectedTags.includes(tag)
                        ? 'color-mix(in srgb, var(--accent-color) 90%, black 0%)'
                        : 'var(--bg-surface)',
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
  );
}

//  Sub-components 

function SectionLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, color: 'var(--text-muted)', fontSize: 11, fontWeight: 600 }}>
      {icon} <span>{label}</span>
    </div>
  );
}

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

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const filtered = useMemo(() => {
    if (!query) return items.filter((it) => !selectedIds.includes(it.id)).slice(0, 8);
    const q = query.toLowerCase();
    return items.filter((it) => !selectedIds.includes(it.id) && getLabel(it).toLowerCase().includes(q)).slice(0, 8);
  }, [items, selectedIds, query, getLabel]);

  const selectedItems = useMemo(
    () => items.filter((it) => selectedIds.includes(it.id)),
    [items, selectedIds],
  );

  return (
    <div ref={containerRef}>
      <SectionLabel icon={icon} label={label} />

      {selectedItems.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 4 }}>
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
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', display: 'flex', alignItems: 'center', flexShrink: 0 }}
              >
                <X size={9} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div style={{ position: 'relative' }}>
        <div
          onClick={() => setOpen(true)}
          style={{ ...inputStyle, display: 'flex', alignItems: 'center', cursor: 'text' }}
        >
          {open ? (
            <input
              type="text" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder} autoFocus
              style={{ border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 11, width: '100%', padding: 0 }}
            />
          ) : (
            <span style={{ color: 'var(--text-muted)', fontSize: 11, flex: 1 }}>{placeholder}</span>
          )}
          <ChevronDown size={10} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        </div>

        {open && (
          <div style={dropdownStyle}>
            {filtered.length === 0 ? (
              <div style={{ padding: '6px 8px', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
                
              </div>
            ) : (
              filtered.map((item) => (
                <button
                  key={item.id}
                  onClick={() => { onToggle(item.id); setQuery(''); }}
                  style={dropdownItemStyle}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-surface-high, var(--bg-surface))'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
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

//  Styles 

const sidebarStyle: React.CSSProperties = {
  width: 220,
  flexShrink: 0,
  borderRight: '1px solid var(--border-subtle)',
  padding: '10px 12px',
  overflow: 'auto',
  fontSize: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  background: 'var(--bg-surface)',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 12,
  border: '1px solid var(--border-subtle)',
  borderRadius: 4,
  background: 'var(--bg-surface-low, var(--bg-surface))',
  color: 'var(--text-primary)',
  outline: 'none',
  boxSizing: 'border-box' as const,
};

const clearBtnStyle: React.CSSProperties = {
  border: 'none',
  background: 'none',
  color: 'var(--accent-color)',
  cursor: 'pointer',
  fontSize: 11,
  padding: 0,
  textAlign: 'left' as const,
};

const advancedHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: 0,
  border: 'none',
  background: 'none',
  color: 'var(--text-secondary)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  width: '100%',
  textAlign: 'left' as const,
};

const dropdownStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  right: 0,
  marginTop: 2,
  backgroundColor: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 4,
  boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
  zIndex: 50,
  maxHeight: 150,
  overflow: 'auto',
};

const dropdownItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '5px 8px',
  border: 'none',
  background: 'transparent',
  color: 'var(--text-primary)',
  fontSize: 11,
  cursor: 'pointer',
  textAlign: 'left' as const,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};