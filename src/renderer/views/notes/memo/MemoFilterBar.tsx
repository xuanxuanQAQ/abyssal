/**
 * MemoFilterBar — 碎片笔记过滤栏（§3.2）
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Search } from 'lucide-react';
import type { MemoFilter } from '../../../../shared-types/models';

interface MemoFilterBarProps {
  filter: MemoFilter;
  onFilterChange: (filter: MemoFilter) => void;
}

export function MemoFilterBar({ filter, onFilterChange }: MemoFilterBarProps) {
  const [searchText, setSearchText] = useState(filter.searchText ?? '');
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
        placeholder="搜索碎片笔记..."
        style={{
          flex: 1, border: 'none', outline: 'none', backgroundColor: 'transparent',
          color: 'var(--text-primary)', fontSize: 13,
        }}
      />
      {/* TODO: concept / paper / tag dropdown filters */}
    </div>
  );
}
