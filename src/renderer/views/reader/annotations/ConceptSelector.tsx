import React, { useState, useMemo } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Search } from 'lucide-react';
import type { Concept } from '../../../../shared-types/models';

export function ConceptSelector({
  open,
  onOpenChange,
  anchorRect,
  concepts,
  onSelect,
  onCreateNew,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRect: { x: number; y: number } | null;
  concepts: Concept[];
  onSelect: (conceptId: string) => void;
  onCreateNew: () => void;
}) {
  const [query, setQuery] = useState('');

  const filteredConcepts = useMemo(() => {
    if (!query.trim()) return concepts;
    const lowerQuery = query.toLowerCase();
    return concepts.filter(
      (c) =>
        c.id.toLowerCase().includes(lowerQuery) ||
        c.name.toLowerCase().includes(lowerQuery)
    );
  }, [concepts, query]);

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      {anchorRect && (
        <Popover.Anchor asChild>
          <div
            style={{
              position: 'fixed',
              left: anchorRect.x,
              top: anchorRect.y,
              width: 0,
              height: 0,
              pointerEvents: 'none',
            }}
          />
        </Popover.Anchor>
      )}
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={8}
          style={{
            zIndex: 30,
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            padding: 8,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            width: 260,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px',
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <Search size={14} color="var(--text-muted)" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索概念…"
              autoFocus
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                backgroundColor: 'transparent',
                color: 'var(--text-primary)',
                fontSize: 'var(--text-sm)',
                fontFamily: 'inherit',
              }}
            />
          </div>

          <div
            style={{
              maxHeight: 200,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {filteredConcepts.map((concept) => (
              <button
                key={concept.id}
                type="button"
                onClick={() => onSelect(concept.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 8px',
                  backgroundColor: 'transparent',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  color: 'var(--text-primary)',
                  fontSize: 'var(--text-sm)',
                  textAlign: 'left',
                  width: '100%',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--bg-surface)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
                  {concept.id}
                </span>
                <span>{concept.name}</span>
              </button>
            ))}
            {filteredConcepts.length === 0 && (
              <div
                style={{
                  padding: '8px',
                  color: 'var(--text-muted)',
                  fontSize: 'var(--text-sm)',
                  textAlign: 'center',
                }}
              >
                无匹配概念
              </div>
            )}
          </div>

          <div
            style={{
              borderTop: '1px solid var(--border-subtle)',
              paddingTop: 4,
            }}
          >
            <button
              type="button"
              onClick={onCreateNew}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '6px 8px',
                backgroundColor: 'transparent',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                color: 'var(--accent-color)',
                fontSize: 'var(--text-sm)',
                width: '100%',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--bg-surface)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              + 创建新概念
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
