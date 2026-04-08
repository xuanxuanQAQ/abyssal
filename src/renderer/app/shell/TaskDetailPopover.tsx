/**
 * TaskDetailPopover — 管线任务详情浮层（§6.3）
 *
 * 点击 StatusBar 的 PipelineProgress 区域弹出。
 * 显示活跃任务 + 最近完成任务。
 */

import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import * as Popover from '@radix-ui/react-popover';
import { X, ChevronDown, ChevronRight, CheckCircle, XCircle, MinusCircle, Loader2, Circle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAppStore } from '../../core/store';
import { getAPI } from '../../core/ipc/bridge';
import type { TaskUIState } from '../../../shared-types/models';
import { Z_INDEX } from '../../styles/zIndex';
import { WORKFLOW_I18N_KEYS } from '../../core/constants/workflow';

const STATUS_KEYS: Record<string, string> = {
  running: 'workflowMonitor.running',
  completed: 'workflowMonitor.completed',
  failed: 'workflowMonitor.failed',
  cancelled: 'workflowMonitor.cancelled',
};

const POPOVER_SUBSTEP_LABELS: Record<string, string> = {
  unpaywall: 'Unpaywall',
  arxiv: 'arXiv',
  pmc: 'PMC',
  institutional: '机构',
  scihub: 'Sci-Hub',
  extract: '提取',
  hydrate: '补全',
  chunk: '分块',
  index: '索引',
};

const SUBSTEP_STYLE: Record<string, { Icon: typeof CheckCircle; color: string; spin?: boolean }> = {
  pending:  { Icon: Circle,      color: 'var(--text-muted)' },
  running:  { Icon: Loader2,     color: 'var(--accent-color)', spin: true },
  success:  { Icon: CheckCircle, color: 'var(--success, #22c55e)' },
  failed:   { Icon: XCircle,     color: 'var(--danger, #ef4444)' },
  skipped:  { Icon: MinusCircle, color: 'var(--text-muted)' },
};

interface TaskDetailPopoverProps {
  children: React.ReactNode;
}

export function TaskDetailPopover({ children }: TaskDetailPopoverProps) {
  const { t } = useTranslation();
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
      toast.error(err instanceof Error ? err.message : '');
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
              {t('taskDetail.pipelineTasks')}
            </span>
            <Popover.Close asChild>
              <button
                aria-label={t('common.close')}
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
                {t('taskDetail.noTasks')}
              </div>
            )}

            {runningTasks.map(([taskId, task]) => (
              <div key={taskId} style={{ padding: '6px 12px', fontSize: 'var(--text-sm)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {/* 工作流名称 */}
                  <span style={{ flex: 1, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {WORKFLOW_I18N_KEYS[task.workflow] ? t(WORKFLOW_I18N_KEYS[task.workflow]!) : task.workflow} — {task.currentStep ? t(`workflowMonitor.stages.${task.currentStep}`, { defaultValue: task.currentStep }) : t('taskDetail.preparing')}
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
                    aria-label={t('common.cancel')}
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
                {/* Current item + ETA */}
                {(task.currentItemLabel || task.estimatedRemainingMs) && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3, fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 8 }}>
                      {task.currentItemLabel ?? ''}
                    </span>
                    {task.estimatedRemainingMs != null && task.estimatedRemainingMs > 0 && (
                      <span style={{ whiteSpace: 'nowrap', color: 'var(--accent-color)' }}>
                        ~{Math.ceil(task.estimatedRemainingMs / 1000)}s
                      </span>
                    )}
                  </div>
                )}
                {/* Stream preview snippet */}
                {task.streamPreview && (
                  <div style={{
                    marginTop: 3, fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    fontFamily: 'var(--font-mono, monospace)', opacity: 0.7,
                  }}>
                    {task.streamPreview.slice(-80)}
                    <span style={{ animation: 'pulse 1.5s ease-in-out infinite' }}>|</span>
                  </div>
                )}
              </div>
            ))}

            {/* Substeps (acquire cascade progress) */}
            {runningTasks.map(([taskId, task]) =>
              task.substeps && task.substeps.length > 0 ? (
                <div key={`${taskId}-substeps`} style={{ padding: '2px 12px 6px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {task.substeps.map((sub) => {
                    const cfg = SUBSTEP_STYLE[sub.status] ?? SUBSTEP_STYLE.pending!;
                    const { Icon } = cfg;
                    return (
                      <span
                        key={sub.name}
                        title={sub.detail ?? sub.name}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 3,
                          fontSize: 'var(--text-xs)', color: cfg.color,
                        }}
                      >
                        <Icon size={10} style={cfg.spin ? { animation: 'spin 1s linear infinite' } : undefined} />
                        {POPOVER_SUBSTEP_LABELS[sub.name] ?? sub.name}
                      </span>
                    );
                  })}
                </div>
              ) : null,
            )}

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
                  {t('taskDetail.recentlyCompleted', { count: completedTasks.length })}
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
                      <span>{WORKFLOW_I18N_KEYS[task.workflow] ? t(WORKFLOW_I18N_KEYS[task.workflow]!) : task.workflow}</span>
                      <span>{STATUS_KEYS[task.status] ? t(STATUS_KEYS[task.status]!) : task.status}</span>
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
                {t('taskDetail.clearHistory')}
              </button>
            </div>
          )}

          <Popover.Arrow style={{ fill: 'var(--bg-surface)' }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
