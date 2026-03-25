/**
 * PipelineListener — 管线事件 React 组件
 *
 * 顶层不可见组件，挂载在 <AppErrorBoundary> 内部。
 *
 * 职责：
 * 1. 注册 pipeline:progress$event 和 pipeline:streamChunk$event 监听器
 * 2. 写入 useAppStore 的 PipelineSlice
 * 3. 触发 TanStack Query 缓存失效
 * 4. 推送 toast 通知
 */

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { getAPI } from '../core/ipc/bridge';
import { useAppStore } from '../core/store';
import type { PipelineProgressEvent, StreamChunkEvent } from '../../shared-types/ipc';
import type { WorkflowType } from '../../shared-types/enums';

/**
 * 管线完成 → 缓存失效映射表（§4.2）
 */
function invalidateCacheForWorkflow(
  queryClient: ReturnType<typeof useQueryClient>,
  workflow: WorkflowType,
  entityId?: string
): void {
  switch (workflow) {
    case 'discover':
      queryClient.invalidateQueries({ queryKey: ['papers', 'list'] });
      break;
    case 'acquire':
      if (entityId) {
        queryClient.invalidateQueries({
          queryKey: ['papers', 'detail', entityId],
        });
      }
      queryClient.invalidateQueries({ queryKey: ['papers', 'list'] });
      break;
    case 'analyze':
      if (entityId) {
        queryClient.invalidateQueries({
          queryKey: ['papers', 'detail', entityId],
        });
        queryClient.invalidateQueries({
          queryKey: ['mappings', 'paper', entityId],
        });
      }
      queryClient.invalidateQueries({ queryKey: ['mappings', 'heatmap'] });
      queryClient.invalidateQueries({ queryKey: ['relations', 'graph'] });
      queryClient.invalidateQueries({ queryKey: ['concepts', 'framework'] });
      break;
    case 'synthesize':
    case 'generate':
      if (entityId) {
        queryClient.invalidateQueries({
          queryKey: ['articles', 'section', entityId],
        });
        queryClient.invalidateQueries({
          queryKey: ['articles', 'versions', entityId],
        });
      }
      break;
  }
}

/**
 * 简单节流：最多每 intervalMs 执行一次
 */
function throttle<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  intervalMs: number
): (...args: TArgs) => void {
  let lastCall = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: TArgs | null = null;

  return (...args: TArgs) => {
    const now = Date.now();
    lastArgs = args;

    if (now - lastCall >= intervalMs) {
      lastCall = now;
      fn(...args);
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        timeoutId = null;
        if (lastArgs) fn(...lastArgs);
      }, intervalMs - (now - lastCall));
    }
  };
}

/** 工作流中文显示名 */
const WORKFLOW_LABELS: Record<WorkflowType, string> = {
  discover: '文献发现',
  acquire: '全文获取',
  analyze: 'AI 分析',
  synthesize: '综合生成',
  generate: '内容生成',
};

export function PipelineListener() {
  const queryClient = useQueryClient();
  const updateTask = useAppStore((s) => s.updateTask);
  const removeTask = useAppStore((s) => s.removeTask);

  // 持有节流函数引用 — 在 useRef 初始值中创建，避免 render phase 副作用
  const throttledUpdateRef = useRef(
    throttle((event: PipelineProgressEvent) => {
      updateTask(event);
    }, 200)
  );

  // 追踪延迟清除的 timer，组件卸载时清理
  const pendingTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const api = getAPI();

    const scheduleRemoveTask = (taskId: string, delayMs: number) => {
      const timer = setTimeout(() => {
        pendingTimersRef.current.delete(timer);
        removeTask(taskId);
      }, delayMs);
      pendingTimersRef.current.add(timer);
    };

    // 进度事件监听
    const unsubProgress = api.pipeline.onProgress(
      (event: PipelineProgressEvent) => {
        const label = WORKFLOW_LABELS[event.workflow] ?? event.workflow;

        if (event.status === 'running') {
          throttledUpdateRef.current(event);
        } else {
          // 终态事件：立即处理
          updateTask(event);

          if (event.status === 'completed') {
            toast.success(`${label} 完成`);
            invalidateCacheForWorkflow(
              queryClient,
              event.workflow,
              event.entityId
            );
            scheduleRemoveTask(event.taskId, 3000);
          } else if (event.status === 'failed') {
            toast.error(
              `${label} 失败：${event.error?.message ?? '未知错误'}`
            );
            scheduleRemoveTask(event.taskId, 5000);
          } else if (event.status === 'cancelled') {
            toast(`${label} 已取消`);
            removeTask(event.taskId);
          }
        }
      }
    );

    // 流式输出事件监听（当前仅用于 AI 聊天/生成场景）
    const unsubStream = api.pipeline.onStreamChunk(
      (_event: StreamChunkEvent) => {
        // TODO: 接入 useChatStore 或 useEditorStore 的流式内容追加
      }
    );

    // v2.0 workflow-complete 事件：批量缓存失效
    const unsubWorkflowComplete = api.app.onWorkflowComplete(
      (event: { workflow: WorkflowType; taskId: string }) => {
        queryClient.invalidateQueries({ queryKey: ['papers'] });
        queryClient.invalidateQueries({ queryKey: ['mappings'] });
        queryClient.invalidateQueries({ queryKey: ['suggestedConcepts'] });
        queryClient.invalidateQueries({ queryKey: ['advisoryNotifications'] });
      }
    );

    // v2.0 section-quality 事件：更新 Zustand store
    const unsubSectionQuality = api.app.onSectionQuality(
      (event: { sectionId: string; coverage: string; gaps: string[] }) => {
        const setSectionQualityReport = useAppStore.getState().setSectionQualityReport;
        setSectionQualityReport(event.sectionId, {
          sectionId: event.sectionId,
          coverage: event.coverage as 'sufficient' | 'partial' | 'insufficient',
          gaps: event.gaps,
        });
      }
    );

    return () => {
      unsubProgress();
      unsubStream();
      unsubWorkflowComplete();
      unsubSectionQuality();
      // 清理所有挂起的延迟 timer
      for (const timer of pendingTimersRef.current) {
        clearTimeout(timer);
      }
      pendingTimersRef.current.clear();
    };
  }, [queryClient, updateTask, removeTask]);

  return null;
}
