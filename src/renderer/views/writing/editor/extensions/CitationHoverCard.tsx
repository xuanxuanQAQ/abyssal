/**
 * CitationHoverCard — Hover card showing paper details on citation hover.
 *
 * Uses @radix-ui/react-popover (controlled mode) as HoverCard is not installed.
 * Open/close is managed by the parent (CitationChip) via hover timers.
 *
 * Shows: title, authors, year, abstract snippet.
 * Data from usePaper(paperId) cache.
 */

import React from 'react';
import * as Popover from '@radix-ui/react-popover';
import { usePaper } from '../../../../core/ipc/hooks/usePapers';

interface CitationHoverCardProps {
  paperId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

const cardContentStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-surface, #1e1e2e)',
  border: '1px solid var(--border-color, #333)',
  borderRadius: '8px',
  padding: '12px 16px',
  maxWidth: '360px',
  minWidth: '200px',
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
  fontSize: '13px',
  lineHeight: '1.5',
  color: 'var(--text-primary, #cdd6f4)',
};

const titleStyle: React.CSSProperties = {
  fontWeight: 600,
  marginBottom: '4px',
  fontSize: '14px',
};

const metaStyle: React.CSSProperties = {
  color: 'var(--text-secondary, #a6adc8)',
  fontSize: '12px',
  marginBottom: '8px',
};

const abstractStyle: React.CSSProperties = {
  color: 'var(--text-secondary, #a6adc8)',
  fontSize: '12px',
  display: '-webkit-box',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

export function CitationHoverCard({
  paperId,
  open,
  onOpenChange,
  children,
}: CitationHoverCardProps): React.ReactElement {
  const { data: paper, isLoading } = usePaper(paperId);

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          style={cardContentStyle}
          side="top"
          sideOffset={4}
          align="start"
          onPointerDownOutside={() => onOpenChange(false)}
          onEscapeKeyDown={() => onOpenChange(false)}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {isLoading ? (
            <div style={{ color: 'var(--text-secondary, #a6adc8)' }}>Loading...</div>
          ) : paper ? (
            <>
              <div style={titleStyle}>{paper.title}</div>
              <div style={metaStyle}>
                {paper.authors.length > 0 && paper.authors[0]
                  ? `${paper.authors[0].name}${paper.authors.length > 1 ? ' et al.' : ''}`
                  : 'Unknown author'}
                {' '}
                ({paper.year})
              </div>
              {paper.abstract !== null ? (
                <div style={abstractStyle}>{paper.abstract}</div>
              ) : null}
            </>
          ) : (
            <div>
              <div style={titleStyle}>Paper: {paperId}</div>
              <div style={metaStyle}>Paper details unavailable</div>
            </div>
          )}
          <Popover.Arrow
            style={{ fill: 'var(--bg-surface, #1e1e2e)' }}
            width={12}
            height={6}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
