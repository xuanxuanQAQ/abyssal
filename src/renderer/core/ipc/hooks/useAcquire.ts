/**
 * useAcquire — 全文获取操作 hooks
 *
 * - useAcquireFulltext: 单篇论文全文获取
 * - useAcquireBatch: 批量全文获取
 * - useAcquireStatus: 查询论文全文状态
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAPI } from '../bridge';
import { handleError } from '../../errors/errorHandlers';

/** 单篇论文全文获取（返回 taskId 用于追踪进度） */
export function useAcquireFulltext() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (paperId: string) => {
      // eslint-disable-next-line no-console
      console.log('[useAcquireFulltext] Calling acquire:fulltext IPC', { paperId });
      return getAPI().acquire.fulltext(paperId);
    },

    onSuccess: (taskId, paperId) => {
      // eslint-disable-next-line no-console
      console.log('[useAcquireFulltext] IPC returned taskId', { taskId, paperId });
      queryClient.invalidateQueries({ queryKey: ['papers', 'detail', paperId] });
      queryClient.invalidateQueries({ queryKey: ['papers', 'counts'] });
    },

    onError: (err, paperId) => {
      console.error('[useAcquireFulltext] IPC error', { paperId, error: err });
      handleError(err);
    },
  });
}

/** 批量全文获取（返回 taskId） */
export function useAcquireBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (paperIds: string[]) => getAPI().acquire.batch(paperIds),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['papers', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['papers', 'counts'] });
    },

    onError: (err) => handleError(err),
  });
}

/** 关联本地 PDF 到已有论文（用户手动选择文件） */
export function useLinkLocalPdf() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ paperId, pdfPath }: { paperId: string; pdfPath?: string | null }) =>
      getAPI().db.papers.linkPdf(paperId, pdfPath),

    onSuccess: (_result, { paperId }) => {
      queryClient.invalidateQueries({ queryKey: ['papers'] });
      queryClient.invalidateQueries({ queryKey: ['acquire', 'status', paperId] });
    },

    onError: (err) => handleError(err),
  });
}

/** 查询论文全文获取状态 */
export function useAcquireStatus(paperId: string | null) {
  return useQuery({
    queryKey: ['acquire', 'status', paperId],
    queryFn: () => getAPI().acquire.status(paperId!),
    enabled: paperId !== null,
    staleTime: 10_000,
    gcTime: 60_000,
  });
}
