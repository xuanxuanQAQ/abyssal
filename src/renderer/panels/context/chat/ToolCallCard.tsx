/**
 * ToolCallCard — Tool Call 展示卡片（§6.5）
 *
 * 四种视觉状态：pending/running/completed/error
 * 参数区域默认折叠，点击展开显示 JSON 输入/输出。
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wrench, Loader, CheckCircle, XCircle, ChevronRight, ChevronDown } from 'lucide-react';
import type { ToolCallInfo } from '../../../../shared-types/models';

interface ToolCallCardProps {
  toolCall: ToolCallInfo;
}

export const ToolCallCard = React.memo(function ToolCallCard({
  toolCall,
}: ToolCallCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const statusIcon = (() => {
    switch (toolCall.status) {
      case 'pending':
        return <Wrench size={14} style={{ color: 'var(--text-muted)' }} />;
      case 'running':
        return (
          <Loader
            size={14}
            style={{ color: 'var(--accent-color)', animation: 'spin 1s linear infinite' }}
          />
        );
      case 'completed':
        return <CheckCircle size={14} style={{ color: 'var(--success)' }} />;
      case 'error':
        return <XCircle size={14} style={{ color: 'var(--danger)' }} />;
    }
  })();

  const statusText = (() => {
    switch (toolCall.status) {
      case 'pending':
        return t('context.chat.toolCall.pending');
      case 'running':
        return t('context.chat.toolCall.running');
      case 'completed':
        return toolCall.duration
          ? t('context.chat.toolCall.completedWithDuration', { duration: toolCall.duration })
          : t('context.chat.toolCall.completed');
      case 'error':
        return t('context.chat.toolCall.error');
    }
  })();

  const borderColor =
    toolCall.status === 'running'
      ? 'var(--accent-color)'
      : toolCall.status === 'error'
        ? 'var(--danger)'
        : 'transparent';

  return (
    <div
      style={{
        margin: '8px 0',
        borderRadius: 'var(--radius-sm)',
        backgroundColor: 'var(--bg-surface-low)',
        borderLeft: `2px solid ${borderColor}`,
        fontSize: 'var(--text-xs)',
        overflow: 'hidden',
      }}
    >
      {/* 标题行 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 8px',
          cursor: 'pointer',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        {statusIcon}
        <span style={{ fontWeight: 600, flex: 1 }}>{toolCall.name}</span>
        <span style={{ color: 'var(--text-muted)' }}>{statusText}</span>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div
          style={{
            padding: '4px 8px 8px',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ marginBottom: 4, color: 'var(--text-muted)' }}>{t('context.chat.toolCall.params')}:</div>
          <pre
            style={{
              margin: 0,
              padding: 4,
              backgroundColor: 'var(--bg-base)',
              borderRadius: 'var(--radius-sm)',
              overflow: 'auto',
              maxHeight: 120,
              fontSize: 'var(--text-xs)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {JSON.stringify(toolCall.input, null, 2)}
          </pre>
          {toolCall.output && (
            <>
              <div style={{ marginTop: 8, marginBottom: 4, color: 'var(--text-muted)' }}>
                {t('context.chat.toolCall.result')}:
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: 4,
                  backgroundColor: 'var(--bg-base)',
                  borderRadius: 'var(--radius-sm)',
                  overflow: 'auto',
                  maxHeight: 120,
                  fontSize: 'var(--text-xs)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {toolCall.output}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
});
