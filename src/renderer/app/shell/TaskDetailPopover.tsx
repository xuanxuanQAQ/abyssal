/**
 * TaskDetailPopover — 管线任务详情浮层（§6.3）
 *
 * 点击 StatusBar 的 PipelineProgress 区域弹出。
 * 显示活跃任务 + 最近完成任务。
 */

import React, { useState, useMemo } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { X, ChevronDown, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAppStore } from '../../core/store';
import { getAPI } from '../../core/ipc/bridge';
import type { TaskUIState } from '../../../shared-types/models';
import { Z_INDEX } from '../../styles/zIndex';

interface TaskDetailPopoverProps {
  children: React.ReactNode;
}

export function TaskDetailPopover({ children }: TaskDetailPopoverProps) {
  const activeTasks = useAppStore((s) => s.activeTasks);
  const removeTask = useAppStore((s) => s.removeTask);
  const [showHistory, setShowHistory] = useState(false);

  const { runningTasks, completedTasks, taskEntries } = useMemo(() => {
    const entries = Object.entries(activeTasks) as [string, TaskUIState][];
    return {
      taskEntries: entries,
      runningTasks: entries.filter(([, t]) => t.status === 'running'),
      completedTasks: entries.filter(([, t]) => t.status !== 'running'),
    };
  }, [activeTasks]);

  const handleCancelTask = async (taskId: string) => {
    try {
      await getAPI().pipeline.cancel(taskId);
    } catch (err) {
      toast.error(`取消失败：${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  const handleClearHistory = () => {
    for (const [taskId] of completedTasks) {
      removeTask(taskId);
    }
  };

  return (
    <Popover.Root>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={4}
          align="start"
          style={{
            width: 320,
            maxHeight: 400,
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-md)',
            zIndex: Z_INDEX.POPOVER,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* 标题 */}
          <div
            style={{
              padding: '8px 12px',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
              管线任务
            </span>
            <Popover.Close asChild>
              <button
                aria-label="关闭"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: 2,
                }}
              >
                <X size={14} />
              </button>
            </Popover.Close>
          </div>

          {/* 活跃任务列表 */}
          <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
            {runningTasks.length === 0 && completedTasks.length === 0 && (
              <div style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                暂无任务
              </div>
            )}

            {runningTasks.map(([taskId, task]) => (
              <div
                key={taskId}
                style={{
                  padding: '6px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 'var(--text-sm)',
                }}
              >
                {/* 工作流名称 */}
                <span style={{ flex: 1, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {task.workflow} — {task.currentStep}
                </span>

                {/* 进度条 */}
                <div
                  role="progressbar"
                  aria-valuenow={task.progress.current}
                  aria-valuemax={task.progress.total}
                  style={{
                    width: 60,
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: 'var(--border-subtle)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${task.progress.total > 0 ? (task.progress.current / task.progress.total) * 100 : 0}%`,
                      height: '100%',
                      backgroundColor: 'var(--accent-color)',
                      transition: 'width var(--duration-fast)',
                    }}
                  />
                </div>

                {/* 取消按钮 */}
                <button
                  onClick={() => handleCancelTask(taskId)}
                  aria-label="取消任务"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-muted)',
                    padding: 2,
                    fontSize: 'var(--text-xs)',
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            ))}

            {/* 最近完成（折叠区） */}
            {completedTasks.length > 0 && (
              <>
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  style={{
                    width: '100%',
                    padding: '6px 12px',
                    background: 'none',
                    border: 'none',
                    borderTop: '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                    color: 'var(--text-muted)',
                    fontSize: 'var(--text-xs)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  {showHistory ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  最近完成 ({completedTasks.length})
                </button>
                {showHistory &&
                  completedTasks.slice(0, 10).map(([taskId, task]) => (
                    <div
                      key={taskId}
                      style={{
                        padding: '4px 12px 4px 24px',
                        fontSize: 'var(--text-xs)',
                        color: task.status === 'failed' ? 'var(--danger)' : 'var(--text-muted)',
                        display: 'flex',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>{task.workflow}</span>
                      <span>{task.status}</span>
                    </div>
                  ))}
              </>
            )}
          </div>

          {/* 底部清除 */}
          {taskEntries.length > 0 && (
            <div
              style={{
                borderTop: '1px solid var(--border-subtle)',
                padding: '4px 12px',
                textAlign: 'center',
              }}
            >
              <button
                onClick={handleClearHistory}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  fontSize: 'var(--text-xs)',
                }}
              >
                清除历史
              </button>
            </div>
          )}

          <Popover.Arrow style={{ fill: 'var(--bg-surface)' }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
