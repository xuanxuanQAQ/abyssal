/**
 * StatusBar — 底部状态栏（§6）
 *
 * 24px 高度，左右两组：
 * 左组：任务活动按钮（带状态徽标）+ DBStatus
 * 右组：LLMIndicator + ContextPanel 展开按钮
 *
 * 任务按钮三种视觉状态：
 * - 空闲：低调灰色图标
 * - 运行中：高亮背景 + 脉冲动画 + 进度文字
 * - 有未读失败：红点徽标
 *
 * 任务开始时自动展开面板。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  Database,
  PanelRight,
  PanelBottom,
  Cpu,
} from 'lucide-react';
import { useAppStore } from '../../core/store';
import { getAPI } from '../../core/ipc/bridge';
import type { TaskUIState } from '../../../shared-types/models';
import { WORKFLOW_I18N_KEYS } from '../../core/constants/workflow';
import { TaskDetailPopover } from './TaskDetailPopover';

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Claude',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  ollama: 'Ollama',
  vllm: 'vLLM',
  minimax: 'MiniMax',
  zhipu: 'Zhipu',
  qwen: 'Qwen',
  moonshot: 'Moonshot',
};

const ghostBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  fontSize: 'var(--text-xs)',
  padding: '0 4px',
};

export function StatusBar() {
  const { t } = useTranslation();
  const activeTasks = useAppStore((s) => s.activeTasks);
  const taskHistory = useAppStore((s) => s.taskHistory);
  const taskPanelOpen = useAppStore((s) => s.taskPanelOpen);
  const toggleTaskPanel = useAppStore((s) => s.toggleTaskPanel);
  const contextPanelOpen = useAppStore((s) => s.contextPanelOpen);
  const toggleContextPanel = useAppStore((s) => s.toggleContextPanel);

  const [llmProvider, setLlmProvider] = useState<string | null>(null);
  const [llmStatus, setLlmStatus] = useState<'checking' | 'ok' | 'error'>('checking');
  const [dbStatus, setDbStatus] = useState<'connected' | 'degraded' | 'disconnected'>('connected');
  // 追踪用户已查看的历史条数，用于计算未读失败数
  const seenHistoryCountRef = useRef(0);

  useEffect(() => {
    const api = getAPI();
    api.settings.getAll().then((data) => {
      if (!data) return;
      const provider = data.llm.defaultProvider;
      setLlmProvider(provider);
      // 用 testApiKey 验证 default provider 是否真正可用
      api.settings.testApiKey(provider).then((result) => {
        setLlmStatus(result.ok ? 'ok' : 'error');
      }).catch((err) => { console.warn('[StatusBar] API key test failed:', err); setLlmStatus('error'); });
    }).catch((err) => { console.warn('[StatusBar] Failed to load settings:', err); });

    // 初始探测：尝试调用 getDbStats 确认 DB 是否可用
    api.settings.getDbStats()
      .then(() => setDbStatus('connected'))
      .catch(() => setDbStatus('disconnected'));

    // 订阅实时健康推送
    const unsub = api.on.dbHealth((event: { status: 'connected' | 'degraded' | 'disconnected' }) => {
      setDbStatus(event.status);
    });
    return () => { unsub(); };
  }, []);

  const { hasRunning, firstRunning, runningCount } = useMemo(() => {
    const taskEntries = Object.entries(activeTasks) as [string, TaskUIState][];
    const running = taskEntries.filter(([, t]) => t.status === 'running');
    return {
      hasRunning: running.length > 0,
      runningCount: running.length,
      firstRunning: running[0] as [string, TaskUIState] | undefined,
    };
  }, [activeTasks]);

  // 自动展开：任务开始运行时自动打开面板
  const prevRunningRef = useRef(false);
  useEffect(() => {
    if (hasRunning && !prevRunningRef.current && !taskPanelOpen) {
      toggleTaskPanel();
    }
    prevRunningRef.current = hasRunning;
  }, [hasRunning, taskPanelOpen, toggleTaskPanel]);

  // 面板打开时标记为已读
  useEffect(() => {
    if (taskPanelOpen) {
      seenHistoryCountRef.current = taskHistory.length;
    }
  }, [taskPanelOpen, taskHistory.length]);

  // 未读失败数
  const unseenFailures = useMemo(() => {
    if (taskPanelOpen) return 0;
    const unseenEntries = taskHistory.slice(0, taskHistory.length - seenHistoryCountRef.current);
    return unseenEntries.filter((e) => e.status === 'failed').length;
  }, [taskHistory, taskPanelOpen]);

  // 按钮样式：运行中高亮背景，面板打开时强调色
  const taskBtnStyle: React.CSSProperties = {
    ...ghostBtnStyle,
    position: 'relative',
    padding: '0 8px',
    height: 20,
    borderRadius: 3,
    transition: 'background 150ms, color 150ms',
    ...(hasRunning
      ? {
          background: 'color-mix(in srgb, var(--accent-color) 15%, transparent)',
          color: 'var(--accent-color)',
        }
      : taskPanelOpen
        ? { color: 'var(--accent-color)' }
        : {}),
  };

  return (
      <footer
        className="statusbar app-shell__statusbar"
        role="status"
        style={{
          height: 'var(--statusbar-height)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 8px',
        }}
      >
        {/* 左组 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* 任务活动按钮 + 详情浮层 */}
          <TaskDetailPopover>
            <button
              style={taskBtnStyle}
              onClick={toggleTaskPanel}
              title={t('statusBar.taskPanel')}
            >
              {hasRunning ? (
                <Activity
                  size={12}
                  aria-hidden="true"
                  style={{ animation: 'pulse 1.5s ease-in-out infinite' }}
                />
              ) : (
                <PanelBottom size={12} aria-hidden="true" />
              )}
              {firstRunning ? (
                <span>
                  {WORKFLOW_I18N_KEYS[firstRunning[1].workflow] ? t(WORKFLOW_I18N_KEYS[firstRunning[1].workflow]!) : firstRunning[1].workflow}{' '}
                  {firstRunning[1].progress.current}/{firstRunning[1].progress.total}
                  {runningCount > 1 && ` (+${runningCount - 1})`}
                </span>
              ) : (
                <span>{t('statusBar.tasks')}</span>
              )}

              {/* 未读失败红点 */}
              {unseenFailures > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: -2,
                    right: -4,
                    minWidth: 14,
                    height: 14,
                    borderRadius: 7,
                    backgroundColor: 'var(--danger, #ef4444)',
                    color: '#fff',
                    fontSize: 9,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 3px',
                    lineHeight: 1,
                  }}
                >
                  {unseenFailures}
                </span>
              )}
            </button>
          </TaskDetailPopover>

          {/* DBStatus */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Database size={11} aria-hidden="true" />
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                backgroundColor:
                  dbStatus === 'connected' ? 'var(--success)'
                  : dbStatus === 'degraded' ? 'var(--warning, #f59e0b)'
                  : 'var(--danger, #ef4444)',
                display: 'inline-block',
                transition: 'background-color 200ms',
              }}
              title={
                dbStatus === 'connected' ? t('statusBar.dbConnected')
                : dbStatus === 'degraded' ? t('statusBar.dbDegraded', 'DB responding slowly')
                : t('statusBar.dbDisconnected', 'DB disconnected')
              }
            />
          </div>
        </div>

        {/* 右组 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* LLMIndicator */}
          <button
            style={ghostBtnStyle}
            onClick={() => {
              useAppStore.getState().switchView('settings');
            }}
          >
            <Cpu size={11} aria-hidden="true" />
            <span>{llmProvider ? (PROVIDER_LABELS[llmProvider] ?? llmProvider) : '…'}</span>
            {llmProvider && (
              llmStatus === 'checking'
                ? <span style={{ color: 'var(--text-muted)' }}>…</span>
                : llmStatus === 'ok'
                  ? <span style={{ color: 'var(--success)' }}>✓</span>
                  : <span style={{ color: 'var(--danger, #ef4444)' }}>✗</span>
            )}
          </button>

          {/* ContextPanel 展开按钮（仅在折叠时显示） */}
          {!contextPanelOpen && (
            <button
              onClick={toggleContextPanel}
              title={t('statusBar.openContextPanel')}
              style={ghostBtnStyle}
            >
              <PanelRight size={12} />
            </button>
          )}
        </div>
      </footer>
  );
}
