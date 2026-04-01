/**
 * ToolCallGroup — 将多个 ToolCall 折叠为紧凑的步骤组
 *
 * 全部完成时默认折叠为一行摘要，点击展开查看各步骤详情。
 * 运行中/有错误时自动展开。
 */

import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronRight,
  ChevronDown,
  Loader,
  CheckCircle,
  XCircle,
  Zap,
} from 'lucide-react';
import type { ToolCallInfo } from '../../../../shared-types/models';
import { ToolCallStep } from './ToolCallStep';

interface ToolCallGroupProps {
  toolCalls: ToolCallInfo[];
}

/** Domain icon hint for capability prefix */
const DOMAIN_ICONS: Record<string, string> = {
  reader: '📖',
  analysis: '🔬',
  notes: '📝',
  graph: '🕸️',
  discovery: '🔍',
  writing: '✍️',
  ui: '🖥️',
  config: '⚙️',
};

function getDomainEmoji(toolName: string): string {
  const domain = toolName.split('--')[0] ?? '';
  return DOMAIN_ICONS[domain] ?? '⚡';
}

export const ToolCallGroup = React.memo(function ToolCallGroup({
  toolCalls,
}: ToolCallGroupProps) {
  const { t } = useTranslation();

  const allCompleted = toolCalls.every((tc) => tc.status === 'completed');
  const hasError = toolCalls.some((tc) => tc.status === 'error');
  const hasRunning = toolCalls.some((tc) => tc.status === 'running');

  // Auto-collapse once all complete, expand when running or error
  const [expanded, setExpanded] = useState(!allCompleted);
  const prevAllCompleted = useRef(allCompleted);

  useEffect(() => {
    // Transition from running to all-completed → auto-collapse
    if (!prevAllCompleted.current && allCompleted) {
      setExpanded(false);
    }
    // Transition to running/error → auto-expand
    if (hasRunning || hasError) {
      setExpanded(true);
    }
    prevAllCompleted.current = allCompleted;
  }, [allCompleted, hasRunning, hasError]);

  // Summary icon
  const summaryIcon = hasError ? (
    <XCircle size={13} style={{ color: 'var(--danger)', flexShrink: 0 }} />
  ) : hasRunning ? (
    <Loader
      size={13}
      style={{
        color: 'var(--accent-color)',
        animation: 'spin 1s linear infinite',
        flexShrink: 0,
      }}
    />
  ) : (
    <CheckCircle size={13} style={{ color: 'var(--success)', flexShrink: 0 }} />
  );

  // Summary text
  const summaryText = hasRunning
    ? t('context.chat.toolCall.groupRunning', { count: toolCalls.length })
    : hasError
      ? t('context.chat.toolCall.groupError', { count: toolCalls.length })
      : t('context.chat.toolCall.groupCompleted', { count: toolCalls.length });

  return (
    <div
      style={{
        margin: '6px 0',
        borderRadius: 'var(--radius-sm)',
        backgroundColor: 'var(--bg-surface-low)',
        border: '1px solid var(--border-subtle)',
        overflow: 'hidden',
        fontSize: 'var(--text-xs)',
      }}
    >
      {/* Summary header */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 8px',
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'background-color 0.15s',
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.backgroundColor =
            'var(--bg-surface)')
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.backgroundColor = 'transparent')
        }
      >
        <Zap size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        {summaryIcon}
        <span
          style={{
            flex: 1,
            color: 'var(--text-secondary)',
            fontWeight: 500,
          }}
        >
          {summaryText}
        </span>
        {expanded ? (
          <ChevronDown size={12} style={{ color: 'var(--text-muted)' }} />
        ) : (
          <ChevronRight size={12} style={{ color: 'var(--text-muted)' }} />
        )}
      </div>

      {/* Expanded steps */}
      <div
        style={{
          maxHeight: expanded ? toolCalls.length * 200 : 0,
          overflow: 'hidden',
          transition: 'max-height 0.25s ease',
        }}
      >
        <div
          style={{
            padding: '0 8px 6px',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          {toolCalls.map((tc, i) => (
            <ToolCallStep
              key={`${tc.name}-${i}`}
              toolCall={tc}
              isLast={i === toolCalls.length - 1}
              domainEmoji={getDomainEmoji(tc.name)}
            />
          ))}
        </div>
      </div>
    </div>
  );
});
