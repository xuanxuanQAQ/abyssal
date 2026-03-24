/**
 * useRelations — 关系图数据查询 hook
 *
 * Query Key: ['relations', 'graph', filterHash]
 *
 * 在 queryFn 内部完成二进制解码，
 * TanStack Query 缓存的是已解码的结构化对象。
 */

import { useQuery } from '@tanstack/react-query';
import { getAPI } from '../bridge';
import { decodeGraphData } from '../decode/graphDecoder';
import type { GraphFilter } from '../../../../shared-types/ipc';

function stableFilterHash(filter?: GraphFilter): string {
  if (!filter) return 'global';
  return JSON.stringify(filter, Object.keys(filter).sort());
}

export function useGraphData(filter?: GraphFilter) {
  return useQuery({
    queryKey: ['relations', 'graph', stableFilterHash(filter)],
    queryFn: async () => {
      const raw = await getAPI().db.relations.getGraph(filter);
      // 在 queryFn 内解码二进制数据，缓存已解码对象
      return decodeGraphData(raw as Parameters<typeof decodeGraphData>[0]);
    },
    staleTime: 300_000,
    gcTime: 600_000,
  });
}
