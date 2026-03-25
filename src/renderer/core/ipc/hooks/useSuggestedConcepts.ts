/**
 * useSuggestedConcepts -- concept suggestion queue hooks (v2.0)
 *
 * Query Key: ['suggestedConcepts']
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAPI } from '../bridge';
import type { ConceptDraft } from '../../../../shared-types/models';
import { handleError } from '../../errors/errorHandlers';

export function useSuggestedConceptList() {
  return useQuery({
    queryKey: ['suggestedConcepts'],
    queryFn: () => getAPI().db.suggestedConcepts.list(),
    staleTime: 5 * 60_000,
  });
}

export function useAcceptSuggestedConcept() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ suggestedId, draft }: { suggestedId: string; draft: ConceptDraft }) =>
      getAPI().db.suggestedConcepts.accept(suggestedId, draft),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suggestedConcepts'] });
      queryClient.invalidateQueries({ queryKey: ['concepts'] });
    },

    onError: (err) => handleError(err),
  });
}

export function useDismissSuggestedConcept() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (suggestedId: string) =>
      getAPI().db.suggestedConcepts.dismiss(suggestedId),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suggestedConcepts'] });
    },

    onError: (err) => handleError(err),
  });
}

export function useRestoreSuggestedConcept() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (suggestedId: string) =>
      getAPI().db.suggestedConcepts.restore(suggestedId),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suggestedConcepts'] });
    },

    onError: (err) => handleError(err),
  });
}
