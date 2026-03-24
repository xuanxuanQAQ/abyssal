/**
 * usePapers — 论文数据查询与写操作 hooks
 *
 * Query Key: ['papers', 'list', filterHash] / ['papers', 'detail', paperId]
 *
 * v1.1: useUpdatePaper 使用精确缓存更新（§7.5），
 * 单行编辑禁止触发全量列表拉取。
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { produce } from 'immer';
import { getAPI } from '../bridge';
import type { PaperFilter } from '../../../../shared-types/ipc';
import type { Paper } from '../../../../shared-types/models';
import type { Relevance } from '../../../../shared-types/enums';
import { handleError } from '../../errors/errorHandlers';

export function stableFilterHash(filter?: PaperFilter): string {
  if (!filter) return 'default';
  return JSON.stringify(filter, Object.keys(filter).sort());
}

// ── 读查询 ──

export function usePaperList(filter?: PaperFilter) {
  return useQuery({
    queryKey: ['papers', 'list', stableFilterHash(filter)],
    queryFn: () => getAPI().db.papers.list(filter),
    staleTime: 30_000,
    gcTime: 300_000,
    refetchOnWindowFocus: true,
  });
}

export function usePaper(id: string | null) {
  return useQuery({
    queryKey: ['papers', 'detail', id],
    queryFn: () => getAPI().db.papers.get(id!),
    enabled: id !== null,
    staleTime: 60_000,
    gcTime: 600_000,
  });
}

/** §2.2 聚合计数（智能分组使用） */
export function usePaperCounts() {
  return useQuery({
    queryKey: ['papers', 'counts'],
    queryFn: () => getAPI().db.papers.getCounts(),
    staleTime: 10_000,
    gcTime: 60_000,
  });
}

// ── 写操作 ──

/**
 * v1.1 精确缓存更新版 useUpdatePaper
 *
 * onMutate: 乐观更新当前 filterHash 下的列表缓存 + detail 缓存
 * onError: 回滚
 * onSuccess: 合并服务端值（如果返回了完整 Paper）
 * onSettled: 仅失效 ['papers', 'counts'] 和 ['papers', 'detail', id]
 *
 * 禁止 invalidateQueries(['papers', 'list'])
 */
export function useUpdatePaper() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Paper> }) =>
      getAPI().db.papers.update(id, patch),

    onMutate: async ({ id, patch }) => {
      // 取消当前列表查询（避免覆盖乐观值）
      await queryClient.cancelQueries({ queryKey: ['papers', 'list'] });
      await queryClient.cancelQueries({ queryKey: ['papers', 'detail', id] });

      // 快照 detail
      const previousDetail = queryClient.getQueryData<Paper>([
        'papers',
        'detail',
        id,
      ]);

      // 快照所有 list 查询
      const previousLists: Array<{
        queryKey: readonly unknown[];
        data: Paper[] | undefined;
      }> = [];
      queryClient
        .getQueriesData<Paper[]>({ queryKey: ['papers', 'list'] })
        .forEach(([queryKey, data]) => {
          previousLists.push({ queryKey, data });
        });

      // 乐观更新 detail
      if (previousDetail) {
        queryClient.setQueryData<Paper>(
          ['papers', 'detail', id],
          { ...previousDetail, ...patch }
        );
      }

      // 乐观更新所有 list 缓存中的目标记录（Immer produce）
      queryClient
        .getQueriesData<Paper[]>({ queryKey: ['papers', 'list'] })
        .forEach(([queryKey, data]) => {
          if (!data) return;
          const updated = produce(data, (draft) => {
            const target = draft.find((p) => p.id === id);
            if (target) {
              Object.assign(target, patch);
            }
          });
          queryClient.setQueryData(queryKey, updated);
        });

      return { previousDetail, previousLists, id };
    },

    onError: (_err, { id }, context) => {
      // 回滚 detail
      if (context?.previousDetail) {
        queryClient.setQueryData(
          ['papers', 'detail', id],
          context.previousDetail
        );
      }
      // 回滚所有 list
      context?.previousLists.forEach(({ queryKey, data }) => {
        queryClient.setQueryData(queryKey, data);
      });
      handleError(_err);
    },

    onSettled: (_data, _err, { id }) => {
      // 仅失效 counts 和当前论文 detail（不刷新列表）
      queryClient.invalidateQueries({ queryKey: ['papers', 'counts'] });
      queryClient.invalidateQueries({ queryKey: ['papers', 'detail', id] });
    },
  });
}

/** 批量更新 relevance（允许全量刷新列表） */
export function useBatchUpdateRelevance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ ids, rel }: { ids: string[]; rel: Relevance }) =>
      getAPI().db.papers.batchUpdateRelevance(ids, rel),

    onMutate: async ({ ids, rel }) => {
      await queryClient.cancelQueries({ queryKey: ['papers', 'list'] });

      const previousQueries: Array<{
        queryKey: readonly unknown[];
        data: Paper[] | undefined;
      }> = [];
      queryClient
        .getQueriesData<Paper[]>({ queryKey: ['papers', 'list'] })
        .forEach(([queryKey, data]) => {
          previousQueries.push({ queryKey, data });
        });

      queryClient
        .getQueriesData<Paper[]>({ queryKey: ['papers', 'list'] })
        .forEach(([queryKey, data]) => {
          if (!data) return;
          const updated = produce(data, (draft) => {
            for (const p of draft) {
              if (ids.includes(p.id)) {
                p.relevance = rel;
              }
            }
          });
          queryClient.setQueryData(queryKey, updated);
        });

      return { previousQueries };
    },

    onError: (_err, _vars, context) => {
      context?.previousQueries.forEach(({ queryKey, data }) => {
        queryClient.setQueryData(queryKey, data);
      });
      handleError(_err);
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['papers', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['papers', 'counts'] });
    },
  });
}

/** 删除单篇论文 */
export function useDeletePaper() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => getAPI().db.papers.delete(id),

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['papers'] });
    },

    onError: (err) => handleError(err),
  });
}

/** 批量删除论文 */
export function useBatchDeletePapers() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids: string[]) => getAPI().db.papers.batchDelete(ids),

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['papers'] });
    },

    onError: (err) => handleError(err),
  });
}

export function useImportBibtex() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (content: string) => getAPI().db.papers.importBibtex(content),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['papers'] });
    },

    onError: (err) => handleError(err),
  });
}
