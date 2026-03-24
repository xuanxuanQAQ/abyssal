/**
 * useDiscoverRuns — 搜索历史 hooks
 *
 * Query Key: ['discoverRuns', 'list']
 * TODO: 需要主进程 discover_runs 表就绪
 */

import { useQuery } from '@tanstack/react-query';
import { getAPI } from '../bridge';

export function useDiscoverRunList() {
  return useQuery({
    queryKey: ['discoverRuns', 'list'],
    queryFn: () => getAPI().db.discoverRuns.list(),
    staleTime: 30_000,
    gcTime: 300_000,
  });
}
