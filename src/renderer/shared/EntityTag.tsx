/**
 * EntityTag — unified entity reference tag component.
 *
 * Four variants: paper (blue), concept (maturity-colored),
 * annotation (yellow), note (gray).
 *
 * Features: truncated text + tooltip, click-to-navigate.
 *
 * See spec: section 8.3
 */

import React, { useCallback } from 'react';
import { FileText, Lightbulb, Highlighter, StickyNote } from 'lucide-react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useAppStore } from '../core/store';

// ─── Types ───

export type EntityType = 'paper' | 'concept' | 'annotation' | 'note';

interface EntityTagProps {
  type: EntityType;
  id: string;
  label: string;
  /** Concept maturity — only used when type='concept' */
  maturity?: 'tentative' | 'working' | 'established';
  /** Paper ID for annotation navigation */
  paperId?: string;
  /** Max display characters before truncation */
  maxChars?: number;
}

// ─── Color mapping ───

const TYPE_COLORS: Record<EntityType, string> = {
  paper: 'var(--accent-color, #3b82f6)',
  concept: 'var(--text-secondary)',
  annotation: 'var(--warning, #f59e0b)',
  note: 'var(--text-muted)',
};

const MATURITY_COLORS: Record<string, string> = {
  tentative: 'var(--color-maturity-tentative, #60a5fa)',
  working: 'var(--color-maturity-working, #fbbf24)',
  established: 'var(--color-maturity-established, #34d399)',
};

const TYPE_ICONS: Record<EntityType, React.ReactNode> = {
  paper: <FileText size={11} />,
  concept: <Lightbulb size={11} />,
  annotation: <Highlighter size={11} />,
  note: <StickyNote size={11} />,
};

// ─── Component ───

export function EntityTag({
  type,
  id,
  label,
  maturity,
  paperId,
  maxChars = 30,
}: EntityTagProps) {
  const navigateTo = useAppStore((s) => s.navigateTo);

  const color = type === 'concept' && maturity
    ? MATURITY_COLORS[maturity] ?? TYPE_COLORS.concept
    : TYPE_COLORS[type];

  const truncated = label.length > maxChars
    ? label.slice(0, maxChars - 3) + '...'
    : label;

  const handleClick = useCallback(() => {
    switch (type) {
      case 'paper':
        navigateTo({ type: 'paper', id, view: 'library' });
        break;
      case 'concept':
        navigateTo({ type: 'concept', id });
        break;
      case 'annotation':
        if (paperId) {
          navigateTo({ type: 'paper', id: paperId, view: 'reader' });
        }
        break;
      case 'note':
        navigateTo({ type: 'note', noteId: id });
        break;
    }
  }, [type, id, paperId, navigateTo]);

  const tag = (
    <button
      onClick={handleClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        padding: '1px 6px', fontSize: 11, lineHeight: '18px',
        border: 'none', borderRadius: 10, cursor: 'pointer',
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
        color,
        maxWidth: '100%', overflow: 'hidden', whiteSpace: 'nowrap',
        transition: 'var(--duration-fast, 100ms)',
      }}
      onMouseEnter={(e) => { (e.target as HTMLElement).style.background = `color-mix(in srgb, ${color} 25%, transparent)`; }}
      onMouseLeave={(e) => { (e.target as HTMLElement).style.background = `color-mix(in srgb, ${color} 15%, transparent)`; }}
    >
      {TYPE_ICONS[type]}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{truncated}</span>
    </button>
  );

  // Show tooltip only if text was truncated
  if (label.length > maxChars) {
    return (
      <Tooltip.Provider delayDuration={300}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>{tag}</Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              side="top"
              sideOffset={4}
              style={{
                padding: '4px 8px', fontSize: 11, maxWidth: 300,
                background: 'var(--bg-surface-high, var(--bg-surface))',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm, 4px)',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              {label}
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
    );
  }

  return tag;
}
