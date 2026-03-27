/**
 * MemoStream — virtual-scrolled memo timeline with entity tags.
 *
 * Uses @tanstack/react-virtual for 60fps scroll with dynamic item heights.
 * Accepts filter from NotesFilterSidebar.
 *
 * See spec: section 6.3
 */

import React, { useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MemoCard } from './MemoCard';
import { MemoQuickCreate } from './MemoQuickCreate';
import type { MemoFilter } from '../../../../shared-types/models';
import { useMemoList } from '../../../core/ipc/hooks/useMemos';

interface MemoStreamProps {
  filter?: MemoFilter;
}

export function MemoStream({ filter = {} }: MemoStreamProps) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useMemoList(filter);
  const allMemos = data?.pages.flat() ?? [];

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: allMemos.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 5,
  });

  const handleScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight - scrollTop - clientHeight < 200 && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        ref={parentRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflow: 'auto', padding: '0 12px' }}
      >
        <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const memo = allMemos[virtualItem.index];
            if (!memo) return null;
            return (
              <div
                key={memo.id}
                style={{
                  position: 'absolute', top: 0, left: 0, width: '100%',
                  transform: `translateY(${virtualItem.start}px)`,
                }}
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
              >
                <MemoCard memo={memo} />
              </div>
            );
          })}
        </div>
        {allMemos.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            No memos yet — use Ctrl+Shift+N to create one
          </div>
        )}
      </div>
      <MemoQuickCreate />
    </div>
  );
}
