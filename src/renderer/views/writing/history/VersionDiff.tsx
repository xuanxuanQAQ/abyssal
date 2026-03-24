/**
 * VersionDiff — Side-by-side diff view using diff-match-patch
 *
 * Left column: current version content
 * Right column: selected historical version
 *
 * Green background highlights additions; red highlights deletions.
 * The diff is computed at the character level for fine-grained comparison.
 */

import React, { useMemo } from 'react';
import DiffMatchPatch from 'diff-match-patch';

interface VersionDiffProps {
  currentContent: string;
  compareContent: string;
}

/** diff-match-patch operation constants */
const DIFF_DELETE = -1 as const;
const DIFF_INSERT = 1 as const;
const DIFF_EQUAL = 0 as const;

interface DiffSegment {
  type: typeof DIFF_DELETE | typeof DIFF_INSERT | typeof DIFF_EQUAL;
  text: string;
}

function computeDiff(oldText: string, newText: string): DiffSegment[] {
  const dmp = new DiffMatchPatch();
  const diffs = dmp.diff_main(oldText, newText);
  dmp.diff_cleanupSemantic(diffs);

  return diffs.map(([op, text]: [number, string]) => ({
    type: op as DiffSegment['type'],
    text,
  }));
}

function DiffSegmentSpan({ segment }: { segment: DiffSegment }) {
  let style: React.CSSProperties;

  switch (segment.type) {
    case DIFF_INSERT:
      style = {
        backgroundColor: 'var(--color-diff-insert, #d4edda)',
        color: 'var(--color-diff-insert-text, #155724)',
        textDecoration: 'none',
      };
      break;
    case DIFF_DELETE:
      style = {
        backgroundColor: 'var(--color-diff-delete, #f8d7da)',
        color: 'var(--color-diff-delete-text, #721c24)',
        textDecoration: 'line-through',
      };
      break;
    case DIFF_EQUAL:
    default:
      style = {};
      break;
  }

  return <span style={style}>{segment.text}</span>;
}

export function VersionDiff({
  currentContent,
  compareContent,
}: VersionDiffProps) {
  const segments = useMemo(
    () => computeDiff(compareContent, currentContent),
    [currentContent, compareContent],
  );

  // Build left (historical) and right (current) renderings
  const leftSegments = useMemo(
    () =>
      segments.filter(
        (s) => s.type === DIFF_EQUAL || s.type === DIFF_DELETE,
      ),
    [segments],
  );
  const rightSegments = useMemo(
    () =>
      segments.filter(
        (s) => s.type === DIFF_EQUAL || s.type === DIFF_INSERT,
      ),
    [segments],
  );

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 16,
        height: '100%',
      }}
    >
      {/* Left: historical version (deletions highlighted) */}
      <div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--color-text-secondary, #6b7280)',
            marginBottom: 8,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          选中版本
        </div>
        <div
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 13,
            lineHeight: 1.7,
            padding: 12,
            borderRadius: 4,
            border: '1px solid var(--color-border, #e5e7eb)',
            maxHeight: 'calc(100% - 32px)',
            overflowY: 'auto',
          }}
        >
          {leftSegments.map((seg, i) => (
            <DiffSegmentSpan key={i} segment={seg} />
          ))}
        </div>
      </div>

      {/* Right: current version (insertions highlighted) */}
      <div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--color-text-secondary, #6b7280)',
            marginBottom: 8,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          当前版本
        </div>
        <div
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 13,
            lineHeight: 1.7,
            padding: 12,
            borderRadius: 4,
            border: '1px solid var(--color-border, #e5e7eb)',
            maxHeight: 'calc(100% - 32px)',
            overflowY: 'auto',
          }}
        >
          {rightSegments.map((seg, i) => (
            <DiffSegmentSpan key={i} segment={seg} />
          ))}
        </div>
      </div>
    </div>
  );
}
