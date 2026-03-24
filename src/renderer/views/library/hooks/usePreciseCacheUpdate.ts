/**
 * usePreciseCacheUpdate — v1.1 单行精确缓存更新（§7.5）
 *
 * 封装 setQueryData + Immer produce 定位 list 缓存中的单条 Paper。
 * 禁止 invalidateQueries(['papers', 'list'])。
 * 仅失效 ['papers', 'counts']。
 */

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { produce } from 'immer';
import type { Paper } from '../../../../shared-types/models';

export function usePreciseCacheUpdate() {
  const queryClient = useQueryClient();

  /**
   * 乐观更新所有 list 缓存中指定 ID 的论文字段
   * 返回快照供回滚使用
   */
  const optimisticUpdate = useCallback(
    (paperId: string, patch: Partial<Paper>) => {
      const snapshots: Array<{
        queryKey: readonly unknown[];
        data: Paper[] | undefined;
      }> = [];

      queryClient
        .getQueriesData<Paper[]>({ queryKey: ['papers', 'list'] })
        .forEach(([queryKey, data]) => {
          snapshots.push({ queryKey, data });
          if (!data) return;
          const updated = produce(data, (draft) => {
            const target = draft.find((p) => p.id === paperId);
            if (target) Object.assign(target, patch);
          });
          queryClient.setQueryData(queryKey, updated);
        });

      // 同步更新 detail 缓存
      const detail = queryClient.getQueryData<Paper>(['papers', 'detail', paperId]);
      if (detail) {
        queryClient.setQueryData<Paper>(
          ['papers', 'detail', paperId],
          { ...detail, ...patch }
        );
      }

      return { snapshots, previousDetail: detail };
    },
    [queryClient]
  );

  /** 回滚快照 */
  const rollback = useCallback(
    (
      paperId: string,
      snapshots: Array<{ queryKey: readonly unknown[]; data: Paper[] | undefined }>,
      previousDetail: Paper | undefined
    ) => {
      for (const { queryKey, data } of snapshots) {
        queryClient.setQueryData(queryKey, data);
      }
      if (previousDetail) {
        queryClient.setQueryData(['papers', 'detail', paperId], previousDetail);
      }
    },
    [queryClient]
  );

  /** 仅失效 counts（不刷新列表） */
  const invalidateCounts = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['papers', 'counts'] });
  }, [queryClient]);

  return { optimisticUpdate, rollback, invalidateCounts };
}
