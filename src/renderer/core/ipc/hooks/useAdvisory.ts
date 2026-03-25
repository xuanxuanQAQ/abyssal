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

// ── v2.0 Event-Driven Advisory Notifications ──

import { useEffect } from 'react';
import type { AdvisoryNotification } from '../../../../shared-types/models';

export function useAdvisoryNotifications() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['advisoryNotifications'],
    queryFn: () => getAPI().advisory.getNotifications(),
    staleTime: Infinity, // purely event-driven, no polling
  });

  // Listen for push events from main process
  useEffect(() => {
    const unsub = getAPI().advisory.onNotificationsUpdated(
      (notifications: AdvisoryNotification[]) => {
        queryClient.setQueryData(['advisoryNotifications'], notifications);
      },
    );
    return unsub;
  }, [queryClient]);

  return query;
}
