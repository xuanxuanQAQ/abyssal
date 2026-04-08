/**
 * WorkflowMonitor — 任务活动浮动面板
 *
 * 左下角浮动叠加层，显示：
 * - 当前运行中的任务（进度条、当前步骤、取消按钮）
 * - 历史任务记录（状态、时间、错误详情）
 *
 * 功能：
 * - 点击任务行高亮选中（底色+边框变化）
 * - 右键菜单支持删除 / 重新执行
 *
 * 数据来源：useAppStore 的 PipelineSlice（activeTasks + taskHistory）
 */

import React, { useCallback, useRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  X,
  CheckCircle,
  XCircle,
  Ban,
  Trash2,
  Loader2,
  MinusCircle,
  Circle,
  RotateCw,
} from 'lucide-react';
import { useAppStore } from '../core/store';
import { getAPI } from '../core/ipc/bridge';
import toast from 'react-hot-toast';
import { formatRelativeDate } from '../core/utils/formatRelativeTime';
import type { TaskUIState, TaskHistoryEntry } from '../../shared-types/models';
import type { WorkflowType } from '../../shared-types/enums';

const STATUS_CONFIG: Record<string, { labelKey: string; color: string; Icon: typeof CheckCircle }> = {
  completed: { labelKey: 'workflowMonitor.completed', color: 'var(--success, #22c55e)', Icon: CheckCircle },
  failed:    { labelKey: 'workflowMonitor.failed', color: 'var(--danger, #ef4444)',  Icon: XCircle },
  cancelled: { labelKey: 'workflowMonitor.cancelled', color: 'var(--text-muted)',     Icon: Ban },
};

// ─── Context Menu ───

interface ContextMenuState {
  x: number;
  y: number;
  taskId: string;
  workflow: WorkflowType;
  isRunning: boolean;
}

function TaskContextMenu({
  menu,
  onClose,
  onDelete,
  onRerun,
}: {
  menu: ContextMenuState;
  onClose: () => void;
  onDelete: () => void;
  onRerun: () => void;
}) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const itemStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 12px', fontSize: 12,
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--text-primary)', width: '100%', textAlign: 'left',
  };

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed', left: menu.x, top: menu.y,
        zIndex: 9999,
        minWidth: 140,
        background: 'var(--bg-elevated, var(--bg-surface))',
        border: '1px solid var(--border-default)',
        borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        padding: '4px 0',
        overflow: 'hidden',
      }}
    >
      <button
        style={itemStyle}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover, rgba(128,128,128,0.1))')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
        onClick={onRerun}
      >
        <RotateCw size={13} />
        {t('workflowMonitor.contextMenu.rerun')}
      </button>
      {!menu.isRunning && (
        <button
          style={{ ...itemStyle, color: 'var(--danger, #ef4444)' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover, rgba(128,128,128,0.1))')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          onClick={onDelete}
        >
          <Trash2 size={13} />
          {t('workflowMonitor.contextMenu.delete')}
        </button>
      )}
    </div>
  );
}

// ─── Component ───

export function WorkflowMonitor() {
  const { t } = useTranslation();
  const activeTasks = useAppStore((s) => s.activeTasks);
  const taskHistory = useAppStore((s) => s.taskHistory);
  const clearTaskHistory = useAppStore((s) => s.clearTaskHistory);
  const toggleTaskPanel = useAppStore((s) => s.toggleTaskPanel);
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const setSelectedTask = useAppStore((s) => s.setSelectedTask);
  const removeHistoryTask = useAppStore((s) => s.removeHistoryTask);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const runningTasks = Object.values(activeTasks).filter(
    (task) => task.status === 'running',
  ) as TaskUIState[];

  // ── Handlers ──

  const handleCancel = useCallback(async (taskId: string) => {
    try {
      await getAPI().pipeline.cancel(taskId);
    } catch (err) {
      toast.error(`取消失败：${err instanceof Error ? err.message : '未知错误'}`);
    }
  }, []);

  const handleRerun = useCallback(async (workflow: WorkflowType) => {
    setContextMenu(null);
    try {
      await getAPI().pipeline.start(workflow);
      toast.success(t('workflowMonitor.workflows.' + workflow) as string);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, [t]);

  const handleDeleteTask = useCallback((taskId: string, isRunning: boolean) => {
    setContextMenu(null);
    if (isRunning) return;
    removeHistoryTask(taskId);
  }, [removeHistoryTask]);

  const handleContextMenu = useCallback((e: React.MouseEvent, taskId: string, workflow: WorkflowType, isRunning: boolean) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, taskId, workflow, isRunning });
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '100%',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          <Activity size={14} />
          {t('workflowMonitor.title')}
          {runningTasks.length > 0 && (
            <span style={{
              fontSize: 11,
              padding: '1px 6px',
              borderRadius: 8,
              backgroundColor: 'var(--accent-color)',
              color: '#fff',
            }}>
              {t('workflowMonitor.running', { count: runningTasks.length })}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {taskHistory.length > 0 && (
            <button
              onClick={clearTaskHistory}
              title={t('workflowMonitor.clearHistory')}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', fontSize: 11,
              }}
            >
              <Trash2 size={12} /> {t('workflowMonitor.clearHistory')}
            </button>
          )}
          <button
            onClick={toggleTaskPanel}
            aria-label={t('common.close')}
            style={{
              display: 'flex', alignItems: 'center',
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', padding: 2,
            }}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', fontSize: 12 }}>
        {/* Running tasks */}
        {runningTasks.length > 0 && (
          <div style={{ padding: '8px 16px' }}>
            {runningTasks.map((task) => (
              <RunningTaskRow
                key={task.taskId}
                task={task}
                selected={selectedTaskId === task.taskId}
                onCancel={handleCancel}
                onClick={() => setSelectedTask(task.taskId)}
                onContextMenu={(e) => handleContextMenu(e, task.taskId, task.workflow, true)}
              />
            ))}
          </div>
        )}

        {/* History */}
        {taskHistory.length > 0 && (
          <div style={{ padding: '4px 16px 8px' }}>
            <div style={{
              fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: 0.5,
              marginBottom: 6, paddingTop: runningTasks.length > 0 ? 4 : 0,
              borderTop: runningTasks.length > 0 ? '1px solid var(--border-subtle)' : 'none',
            }}>
              {t('workflowMonitor.history')}
            </div>
            {taskHistory.map((entry) => (
              <HistoryRow
                key={`${entry.taskId}-${entry.completedAt}`}
                entry={entry}
                selected={selectedTaskId === entry.taskId}
                onClick={() => setSelectedTask(entry.taskId)}
                onContextMenu={(e) => handleContextMenu(e, entry.taskId, entry.workflow, false)}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {runningTasks.length === 0 && taskHistory.length === 0 && (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
            {t('workflowMonitor.noActivity')}
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <TaskContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onDelete={() => handleDeleteTask(contextMenu.taskId, contextMenu.isRunning)}
          onRerun={() => handleRerun(contextMenu.workflow)}
        />
      )}
    </div>
  );
}

// ─── Running task row ───

/** AI generation stages that show stream preview */
const AI_STAGES = new Set(['analyzing', 'synthesizing', 'writing', 'generic_analysis', 'intermediate_analysis']);

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function RunningTaskRow({
  task, selected, onCancel, onClick, onContextMenu,
}: {
  task: TaskUIState;
  selected: boolean;
  onCancel: (id: string) => void;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const { t } = useTranslation();
  const pct = task.progress.total > 0
    ? (task.progress.current / task.progress.total) * 100
    : 0;
  const isAiStage = AI_STAGES.has(task.currentStep);

  // Elapsed time — ticks every second
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!task.startedAt) return;
    const tick = () => setElapsed(Date.now() - task.startedAt!);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [task.startedAt]);

  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      style={{
        padding: '8px 12px',
        marginBottom: 6,
        border: selected
          ? '1px solid var(--accent-color)'
          : '1px solid color-mix(in srgb, var(--accent-color) 30%, transparent)',
        borderRadius: 6,
        background: selected
          ? 'color-mix(in srgb, var(--accent-color) 12%, transparent)'
          : 'color-mix(in srgb, var(--accent-color) 5%, transparent)',
        cursor: 'pointer',
        transition: 'background 120ms, border-color 120ms',
      }}
    >
      {/* Header: workflow name + progress + cancel */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
          {t('workflowMonitor.workflows.' + task.workflow)}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
            {task.progress.current}/{task.progress.total}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onCancel(task.taskId); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 3,
              padding: '2px 8px', fontSize: 11,
              border: 'none', borderRadius: 4,
              background: 'rgba(239,68,68,0.1)', color: 'var(--danger, #ef4444)',
              cursor: 'pointer',
            }}
          >
            <X size={11} /> {t('common.cancel')}
          </button>
        </div>
      </div>

      {/* Current item label (e.g. paper title / concept name) */}
      {task.currentItemLabel && (
        <div style={{
          fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {task.currentItemLabel}
        </div>
      )}

      {/* Progress bar */}
      <div style={{
        height: 4, borderRadius: 2, marginBottom: 4,
        background: 'var(--border-subtle)', overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', borderRadius: 2,
          background: 'var(--accent-color)',
          width: `${pct}%`,
          transition: 'width 300ms ease',
        }} />
      </div>

      {/* Step label + elapsed/ETA */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ color: 'var(--text-muted)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden', flex: 1, minWidth: 0 }}>
          {isAiStage && (
            <Loader2
              size={11}
              style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-color)', flexShrink: 0 }}
            />
          )}
          <span style={{ flexShrink: 0 }}>
            {task.currentStep
              ? t(`workflowMonitor.stages.${task.currentStep}`, { defaultValue: task.currentStep })
              : t('common.loading')}
          </span>
          {isAiStage && task.streamPreview && (
            <span style={{
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              color: 'var(--text-muted)', opacity: 0.55,
              fontFamily: 'var(--font-mono, monospace)', fontSize: 10,
            }}>
              {task.streamPreview.slice(-60)}
              <span style={{ animation: 'pulse 1s ease-in-out infinite' }}>|</span>
            </span>
          )}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', gap: 8 }}>
          {elapsed > 0 && <span>{formatDuration(elapsed)}</span>}
          {task.estimatedRemainingMs != null && task.estimatedRemainingMs > 0 && (
            <span style={{ color: 'var(--accent-color)' }}>
              ~{formatDuration(task.estimatedRemainingMs)} {t('workflowMonitor.remaining')}
            </span>
          )}
        </div>
      </div>


      {/* Substeps timeline */}
      {task.substeps && task.substeps.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {task.substeps.map((sub) => (
            <SubstepBadge key={sub.name} name={sub.name} status={sub.status} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Compact substep badge for the compact timeline */
function SubstepBadge({ name, status }: { name: string; status: string }) {
  const { t } = useTranslation();
  const cfg = SUBSTEP_ICON_MAP[status] ?? SUBSTEP_ICON_MAP.pending!;
  const { Icon } = cfg;
  return (
    <span
      title={t(`workflowMonitor.stages.${name}`, { defaultValue: name })}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        fontSize: 10, color: cfg.color,
        padding: '1px 5px', borderRadius: 3,
        background: status === 'running'
          ? 'color-mix(in srgb, var(--accent-color) 10%, transparent)'
          : status === 'success'
            ? 'color-mix(in srgb, var(--success) 8%, transparent)'
            : 'transparent',
      }}
    >
      <Icon size={10} style={cfg.spin ? { animation: 'spin 1s linear infinite' } : undefined} />
      {t(`workflowMonitor.stages.${name}`, { defaultValue: name })}
    </span>
  );
}

// ─── Substep icons ───

const SUBSTEP_ICON_MAP: Record<string, { Icon: typeof CheckCircle; color: string; spin?: boolean }> = {
  pending:  { Icon: Circle,      color: 'var(--text-muted)' },
  running:  { Icon: Loader2,     color: 'var(--accent-color)', spin: true },
  success:  { Icon: CheckCircle, color: 'var(--success, #22c55e)' },
  failed:   { Icon: XCircle,     color: 'var(--danger, #ef4444)' },
  skipped:  { Icon: MinusCircle, color: 'var(--text-muted)' },
};

// ─── History row ───

function HistoryRow({
  entry, selected, onClick, onContextMenu,
}: {
  entry: TaskHistoryEntry;
  selected: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const { t } = useTranslation();
  const cfg = STATUS_CONFIG[entry.status] ?? STATUS_CONFIG.cancelled!;
  const { Icon } = cfg;

  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8,
        padding: '6px 8px',
        marginBottom: 2,
        borderRadius: 4,
        border: selected ? '1px solid var(--accent-color)' : '1px solid transparent',
        background: selected ? 'color-mix(in srgb, var(--accent-color) 8%, transparent)' : 'transparent',
        cursor: 'pointer',
        transition: 'background 120ms, border-color 120ms',
      }}
    >
      <Icon size={14} style={{ color: cfg.color, marginTop: 1, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
            {t('workflowMonitor.workflows.' + entry.workflow)}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {formatTime(entry.completedAt, t)}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          <span>{t(cfg.labelKey)}</span>
          <span>{entry.progress.current}/{entry.progress.total}</span>
        </div>
        {entry.error && (
          <div style={{
            marginTop: 4, padding: '4px 8px',
            fontSize: 11, borderRadius: 4,
            background: 'rgba(239,68,68,0.08)',
            color: 'var(--danger, #ef4444)',
            wordBreak: 'break-word',
          }}>
            {entry.error.message}
          </div>
        )}
      </div>
    </div>
  );
}

// formatTime alias — uses shared utility
const formatTime = formatRelativeDate;
