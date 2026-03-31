/**
 * TableToolbar — 搜索框 + 排序/筛选指示器 + 导入按钮（§8）
 *
 * 搜索：200→320px 动画，300ms 防抖。
 * 导入：下拉菜单 BibTeX/RIS/PDF/文本粘贴/DOI。
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X, Download, ChevronDown } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useAppStore } from '../../../core/store';
import { ImportDialog } from '../import/ImportDialog';
import type { PaperFilter } from '../../../../shared-types/ipc';

interface TableToolbarProps {
  filter: PaperFilter | undefined;
  resultCount: number;
}

export function TableToolbar({ filter, resultCount }: TableToolbarProps) {
  const { t } = useTranslation();
  const librarySearchQuery = useAppStore((s) => s.librarySearchQuery);
  const setLibrarySearchQuery = useAppStore((s) => s.setLibrarySearchQuery);
  const [inputFocused, setInputFocused] = useState(false);
  const [localQuery, setLocalQuery] = useState(librarySearchQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<'file' | 'text' | 'doi'>('file');

  // 300ms 防抖
  const handleSearchChange = useCallback(
    (value: string) => {
      setLocalQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setLibrarySearchQuery(value);
      }, 300);
    },
    [setLibrarySearchQuery]
  );

  // 同步外部变化
  useEffect(() => {
    setLocalQuery(librarySearchQuery);
  }, [librarySearchQuery]);

  const clearSearch = () => {
    setLocalQuery('');
    setLibrarySearchQuery('');
  };

  // 筛选标签
  const filterTags: Array<{ label: string; key: string }> = [];
  if (filter?.relevance) {
    for (const r of filter.relevance) {
      filterTags.push({ label: `★ ${r}`, key: `rel-${r}` });
    }
  }
  if (filter?.analysisStatus) {
    for (const s of filter.analysisStatus) {
      filterTags.push({ label: `⏳ ${s}`, key: `as-${s}` });
    }
  }
  if (filter?.tags) {
    for (const t of filter.tags) {
      filterTags.push({ label: `🏷️ ${t}`, key: `tag-${t}` });
    }
  }

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 40,
          padding: '0 8px',
          gap: 8,
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}
      >
        {/* 搜索输入框 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 8px',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--bg-surface)',
            width: inputFocused ? 320 : 200,
            transition: 'width 200ms ease',
          }}
        >
          <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            value={localQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            placeholder={t('library.search.placeholder')}
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              backgroundColor: 'transparent',
              color: 'var(--text-primary)',
              fontSize: 'var(--text-sm)',
            }}
          />
          {localQuery && (
            <button
              onClick={clearSearch}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                color: 'var(--text-muted)',
                display: 'flex',
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* 筛选指示器 */}
        <div style={{ flex: 1, display: 'flex', gap: 4, alignItems: 'center', overflow: 'hidden' }}>
          {filterTags.map((tag) => (
            <span
              key={tag.key}
              style={{
                padding: '2px 6px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--accent-color-10)',
                color: 'var(--accent-color)',
                fontSize: 'var(--text-xs)',
                whiteSpace: 'nowrap',
              }}
            >
              {tag.label}
            </span>
          ))}
          {librarySearchQuery && (
            <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}>
              {t('library.search.matchCount', { count: resultCount })}
            </span>
          )}
        </div>

        {/* 导入按钮 */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 10px',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                fontSize: 'var(--text-sm)',
                cursor: 'pointer',
              }}
            >
              <Download size={14} />
              {t('library.import.button')}
              <ChevronDown size={10} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              sideOffset={4}
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: 4,
                minWidth: 180,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                zIndex: 35,
              }}
            >
              <DropdownMenu.Item
                onSelect={() => { setImportMode('file'); setImportOpen(true); }}
                style={menuItemStyle}
              >
                {t('library.import.bibtex')}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => { setImportMode('file'); setImportOpen(true); }}
                style={menuItemStyle}
              >
                {t('library.import.ris')}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => { setImportMode('file'); setImportOpen(true); }}
                style={menuItemStyle}
              >
                {t('library.import.pdf')}
              </DropdownMenu.Item>
              <DropdownMenu.Separator style={{ height: 1, backgroundColor: 'var(--border-subtle)', margin: '4px 0' }} />
              <DropdownMenu.Item
                onSelect={() => { setImportMode('text'); setImportOpen(true); }}
                style={menuItemStyle}
              >
                {t('library.import.pasteBibtex')}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => { setImportMode('doi'); setImportOpen(true); }}
                style={menuItemStyle}
              >
                {t('library.import.fromDoi')}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        defaultTab={importMode}
      />
    </>
  );
}

const menuItemStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  fontSize: 'var(--text-sm)',
  color: 'var(--text-primary)',
  outline: 'none',
};
