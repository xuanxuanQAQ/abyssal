/**
 * StatusBar — 底部状态栏（§6）
 *
 * 24px 高度，左右两组：
 * 左组：PipelineProgress + DBStatus
 * 右组：LLMIndicator + ContextPanel 展开按钮
 */

import React, { useMemo } from 'react';
import {
  Activity,
  Database,
  PanelRight,
  Cpu,
} from 'lucide-react';
import { useAppStore } from '../../core/store';
import { TaskDetailPopover } from './TaskDetailPopover';
import type { TaskUIState } from '../../../shared-types/models';

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
  const activeTasks = useAppStore((s) => s.activeTasks);
  const contextPanelOpen = useAppStore((s) => s.contextPanelOpen);
  const toggleContextPanel = useAppStore((s) => s.toggleContextPanel);

  // 缓存任务过滤，避免每次渲染重算
  const { runningTasks, hasActiveTasks, firstRunning } = useMemo(() => {
    const taskEntries = Object.entries(activeTasks) as [string, TaskUIState][];
    const running = taskEntries.filter(([, t]) => t.status === 'running');
    return {
      runningTasks: running,
      hasActiveTasks: running.length > 0,
      firstRunning: running[0] as [string, TaskUIState] | undefined,
    };
  }, [activeTasks]);

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
        {/* PipelineProgress */}
        {hasActiveTasks && firstRunning && (
          <TaskDetailPopover>
            <button style={ghostBtnStyle}>
              <Activity size={12} aria-hidden="true" style={{ color: 'var(--accent-color)' }} />
              <span>
                {firstRunning[1].workflow} {firstRunning[1].progress.current}/{firstRunning[1].progress.total}
              </span>
            </button>
          </TaskDetailPopover>
        )}

        {/* DBStatus */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Database size={11} aria-hidden="true" />
          {/* TODO: 真实数据库连接状态来自后端 core/database */}
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: 'var(--success)',
              display: 'inline-block',
            }}
            title="数据库已连接"
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
          {/* TODO: 真实 LLM 连接状态来自后端 core/llm-client */}
          <span>Claude</span>
          <span style={{ color: 'var(--success)' }}>✓</span>
        </button>

        {/* ContextPanel 展开按钮（仅在折叠时显示） */}
        {!contextPanelOpen && (
          <button
            onClick={toggleContextPanel}
            title="打开上下文面板 Ctrl+B"
            style={ghostBtnStyle}
          >
            <PanelRight size={12} />
          </button>
        )}
      </div>
    </footer>
  );
}
