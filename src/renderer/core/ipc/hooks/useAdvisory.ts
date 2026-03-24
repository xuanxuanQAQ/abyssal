/**
 * useAdvisory -- Advisory Agent hooks (v1.2)
 *
 * Query Key: ['advisory', 'recommendations']
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAPI } from '../bridge';
import { handleError } from '../../errors/errorHandlers';

export function useRecommendations() {
  return useQuery({
    queryKey: ['advisory', 'recommendations'],
    queryFn: () => getAPI().advisory.getRecommendations(),
    staleTime: 60_000,
    gcTime: 300_000,
  });
}

export function useExecuteRecommendation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => getAPI().advisory.execute(id),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['advisory'] });
      queryClient.invalidateQueries({ queryKey: ['concepts'] });
      queryClient.invalidateQueries({ queryKey: ['mappings'] });
    },

    onError: (err) => handleError(err),
  });
}
