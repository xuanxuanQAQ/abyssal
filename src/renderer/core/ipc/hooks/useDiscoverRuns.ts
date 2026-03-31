/**
 * useDiscoverRuns — 搜索历史 hooks
 *
 * Query Key: ['discoverRuns', 'list']
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
