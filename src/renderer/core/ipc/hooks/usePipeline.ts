/**
 * usePipeline — 管线启动/取消 mutation hooks
 *
 * 管线进度事件的监听由 <PipelineListener /> 组件统一管理，
 * 此处仅提供启动和取消的 mutation。
 */

import { useMutation } from '@tanstack/react-query';
import { getAPI } from '../bridge';
import type { WorkflowType } from '../../../../shared-types/enums';
import type { WorkflowConfig } from '../../../../shared-types/ipc';
import { handleError } from '../../errors/errorHandlers';

export function useStartPipeline() {
  return useMutation({
    mutationFn: ({
      workflow,
      config,
    }: {
      workflow: WorkflowType;
      config?: WorkflowConfig;
    }) => getAPI().pipeline.start(workflow, config),

    onError: (err) => handleError(err),
  });
}

export function useCancelPipeline() {
  return useMutation({
    mutationFn: (taskId: string) => getAPI().pipeline.cancel(taskId),

    onError: (err) => handleError(err),
  });
}
