/**
 * VersionTimeline — Vertical timeline of section versions
 *
 * Each entry displays:
 * - Timestamp (formatted)
 * - Source icon (auto-save, AI-generated, manual save)
 * - Word count
 *
 * The selected version is highlighted. AI versions are indicated with a
 * robot icon prefix.
 */

import React from 'react';
import type { SectionVersion } from '../../../../shared-types/models';
import { countWords } from '../editor/hooks/useWordCount';

interface VersionTimelineProps {
  versions: SectionVersion[];
  selectedVersion: SectionVersion | null;
  onSelectVersion: (version: SectionVersion) => void;
}

/** Human-readable source labels */
const SOURCE_LABELS: Record<SectionVersion['source'], string> = {
  manual: '手动保存',
  auto: '自动保存',
  'ai-generate': 'AI 生成',
  'ai-rewrite': 'AI 改写',
};

/** Simple icon characters for each source type */
const SOURCE_ICONS: Record<SectionVersion['source'], string> = {
  manual: '\u270D', // writing hand
  auto: '\u23F0',   // alarm clock (periodic save)
  'ai-generate': '\u{1F916}', // robot
  'ai-rewrite': '\u{1F916}',  // robot
};

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} 小时前`;

  // Show full date for older versions
  return date.toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isAISource(source: SectionVersion['source']): boolean {
  return source === 'ai-generate' || source === 'ai-rewrite';
}

export function VersionTimeline({
  versions,
  selectedVersion,
  onSelectVersion,
}: VersionTimelineProps) {
  if (versions.length === 0) {
    return (
      <div
        style={{
          padding: '24px 16px',
          color: 'var(--color-text-secondary, #6b7280)',
          textAlign: 'center',
          fontSize: 14,
        }}
      >
        暂无版本记录
      </div>
    );
  }

  // Display in reverse chronological order (newest first)
  const sorted = [...versions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <div role="listbox" aria-label="版本列表">
      {sorted.map((version) => {
        const isSelected = selectedVersion?.version === version.version;
        const wordCount = countWords(version.content);

        return (
          <button
            key={version.version}
            type="button"
            role="option"
            aria-selected={isSelected}
            onClick={() => onSelectVersion(version)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              width: '100%',
              padding: '10px 16px',
              border: 'none',
              borderLeft: isSelected
                ? '3px solid var(--color-primary, #2563eb)'
                : '3px solid transparent',
              background: isSelected
                ? 'var(--color-bg-selected, #eff6ff)'
                : 'transparent',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.15s',
            }}
          >
            {/* Top row: icon + timestamp */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                fontWeight: isSelected ? 600 : 400,
                color: 'var(--color-text-primary, #111827)',
              }}
            >
              <span aria-hidden="true">{SOURCE_ICONS[version.source]}</span>
              <span>{formatTimestamp(version.createdAt)}</span>
            </div>

            {/* Bottom row: source label + word count */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: 4,
                fontSize: 12,
                color: 'var(--color-text-secondary, #6b7280)',
              }}
            >
              <span
                style={{
                  color: isAISource(version.source)
                    ? 'var(--color-accent, #7c3aed)'
                    : undefined,
                }}
              >
                {SOURCE_LABELS[version.source]}
              </span>
              <span>{wordCount} 字</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
