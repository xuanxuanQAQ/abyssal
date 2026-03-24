/**
 * AuthorsCell — 作者显示 + Tooltip（§6.1）
 *
 * "首作者 et al." 格式。悬停 Tooltip 显示完整作者列表。
 */

import React from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import type { Author } from '../../../../../shared-types/models';

interface AuthorsCellProps {
  authors: Author[];
}

function formatFirstAuthor(authors: Author[]): string {
  if (authors.length === 0) return 'Unknown';
  const first = authors[0]!;
  const name = first.name;
  const suffix = authors.length > 1 ? ' et al.' : '';
  return `${name}${suffix}`;
}

function formatFullAuthors(authors: Author[]): string {
  if (authors.length === 0) return 'Unknown';
  const maxShow = 10;
  const shown = authors.slice(0, maxShow).map((a) => a.name);
  if (authors.length > maxShow) {
    shown.push(`... and ${authors.length - maxShow} others`);
  }
  return shown.join(', ');
}

export function AuthorsCell({ authors }: AuthorsCellProps) {
  const displayText = formatFirstAuthor(authors);
  const fullText = formatFullAuthors(authors);

  if (authors.length <= 1) {
    return (
      <span
        style={{
          fontSize: 'var(--text-sm)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {displayText}
      </span>
    );
  }

  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span
            style={{
              fontSize: 'var(--text-sm)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              cursor: 'default',
            }}
          >
            {displayText}
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            sideOffset={4}
            style={{
              padding: '6px 10px',
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-primary)',
              maxWidth: 300,
              zIndex: 40,
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            }}
          >
            {fullText}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
