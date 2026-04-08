/**
 * ToolCallStep — 单个工具调用的紧凑步骤项
 *
 * 时间线风格，左侧连接线 + 状态圆点，右侧显示友好名称和可展开详情。
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader, CheckCircle, XCircle, Clock, ChevronRight, ChevronDown } from 'lucide-react';
import type { ToolCallInfo } from '../../../../shared-types/models';

interface ToolCallStepProps {
  toolCall: ToolCallInfo;
  isLast: boolean;
  domainEmoji: string;
}

/** Map raw tool name (capability--operation) to a human-friendly i18n key */
function getToolDisplayKey(name: string): string {
  // e.g. "analysis--get_paper" → "analysis.get_paper"
  return name.replace('--', '.');
}

export const ToolCallStep = React.memo(function ToolCallStep({
  toolCall,
  isLast,
  domainEmoji,
}: ToolCallStepProps) {
  const { t } = useTranslation();
  const [detailExpanded, setDetailExpanded] = useState(false);

  // Try i18n friendly name, fallback to raw name with prettification
  const i18nKey = `context.chat.toolCall.tools.${getToolDisplayKey(toolCall.name)}`;
  const translated = t(i18nKey);
  const displayName =
    translated !== i18nKey
      ? translated
      : prettifyToolName(toolCall.name);

  // Status dot
  const statusDot = (() => {
    switch (toolCall.status) {
      case 'pending':
        return <Clock size={12} style={{ color: 'var(--text-muted)' }} />;
      case 'running':
        return (
          <Loader
            size={12}
            style={{
              color: 'var(--accent-color)',
              animation: 'spin 1s linear infinite',
            }}
          />
        );
      case 'completed':
        return <CheckCircle size={12} style={{ color: 'var(--success)' }} />;
      case 'error':
        return <XCircle size={12} style={{ color: 'var(--danger)' }} />;
    }
  })();

  const _statusColor =
    toolCall.status === 'running'
      ? 'var(--accent-color)'
      : toolCall.status === 'error'
        ? 'var(--danger)'
        : toolCall.status === 'completed'
          ? 'var(--success)'
          : 'var(--text-muted)';

  const hasDetail =
    Object.keys(toolCall.input ?? {}).length > 0 || !!toolCall.output;

  return (
    <div style={{ display: 'flex', gap: 8, minHeight: 28 }}>
      {/* Timeline column */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          width: 16,
          paddingTop: 7,
        }}
      >
        {statusDot}
        {!isLast && (
          <div
            style={{
              flex: 1,
              width: 1.5,
              backgroundColor: 'var(--border-default)',
              marginTop: 2,
              borderRadius: 1,
            }}
          />
        )}
      </div>

      {/* Content column */}
      <div style={{ flex: 1, paddingTop: 4, paddingBottom: isLast ? 0 : 4 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            cursor: hasDetail ? 'pointer' : 'default',
          }}
          onClick={hasDetail ? () => setDetailExpanded(!detailExpanded) : undefined}
        >
          <span style={{ fontSize: 11, lineHeight: 1 }}>{domainEmoji}</span>
          <span
            style={{
              flex: 1,
              fontWeight: 500,
              color: 'var(--text-primary)',
              fontSize: 'var(--text-xs)',
            }}
          >
            {displayName}
          </span>
          {toolCall.duration != null && toolCall.status === 'completed' && (
            <span
              style={{
                color: 'var(--text-muted)',
                fontSize: 10,
              }}
            >
              {toolCall.duration}ms
            </span>
          )}
          {hasDetail && (
            detailExpanded ? (
              <ChevronDown size={10} style={{ color: 'var(--text-muted)' }} />
            ) : (
              <ChevronRight size={10} style={{ color: 'var(--text-muted)' }} />
            )
          )}
        </div>

        {/* Expandable detail */}
        {detailExpanded && hasDetail && (
          <div
            style={{
              marginTop: 4,
              padding: 4,
              backgroundColor: 'var(--bg-base)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 10,
              lineHeight: 1.4,
            }}
          >
            {Object.keys(toolCall.input ?? {}).length > 0 && (
              <>
                <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>
                  {t('context.chat.toolCall.params')}
                </div>
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    maxHeight: 100,
                    overflow: 'auto',
                  }}
                >
                  {JSON.stringify(toolCall.input, null, 2)}
                </pre>
              </>
            )}
            {toolCall.output && (
              <>
                <div
                  style={{
                    color: 'var(--text-muted)',
                    marginTop: 4,
                    marginBottom: 2,
                  }}
                >
                  {t('context.chat.toolCall.result')}
                </div>
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    maxHeight: 100,
                    overflow: 'auto',
                  }}
                >
                  {toolCall.output}
                </pre>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

/** Prettify raw tool name: "analysis--get_paper" → "获取论文" / "Get Paper" */
function prettifyToolName(name: string): string {
  const parts = name.split('--');
  const operation = (parts.length > 1 ? parts[1] : parts[0]) ?? name;
  return operation
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
