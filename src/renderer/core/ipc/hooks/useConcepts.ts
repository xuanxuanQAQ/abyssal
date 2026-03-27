/**
 * useConcepts -- concept data query & mutation hooks
 *
 * Query Key: ['concepts', 'list'] / ['concepts', 'framework']
 * v1.2: merge, split, resolve, reassign mutations
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAPI } from '../bridge';
import type { ConceptFramework, ConceptDraft } from '../../../../shared-types/models';
import type { Maturity } from '../../../../shared-types/enums';
import { handleError } from '../../errors/errorHandlers';

export function useConceptList() {
  return useQuery({
    queryKey: ['concepts', 'list'],
    queryFn: () => getAPI().db.concepts.list(),
    staleTime: 300_000,
    gcTime: 1_800_000,
  });
}

export function useConceptFramework() {
  return useQuery({
    queryKey: ['concepts', 'framework'],
    queryFn: () => getAPI().db.concepts.getFramework(),
    staleTime: 300_000,
    gcTime: 1_800_000,
  });
}

export function useUpdateConceptFramework() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (fw: ConceptFramework) =>
      getAPI().db.concepts.updateFramework(fw),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['concepts'] });
      queryClient.invalidateQueries({ queryKey: ['mappings'] });
    },

    onError: (err) => handleError(err),
  });
}

// ── v2.0 Concept Hooks ──

export function useCreateConcept() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (draft: ConceptDraft) => getAPI().db.concepts.create(draft),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['concepts'] });
    },
    onError: (err) => handleError(err),
  });
}

export function useUpdateMaturity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ conceptId, maturity }: { conceptId: string; maturity: Maturity }) =>
      getAPI().db.concepts.updateMaturity(conceptId, maturity),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['concepts'] });
    },
    onError: (err) => handleError(err),
  });
}

export function useUpdateDefinition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ conceptId, newDefinition }: { conceptId: string; newDefinition: string }) =>
      getAPI().db.concepts.updateDefinition(conceptId, newDefinition),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['concepts'] });
      queryClient.invalidateQueries({ queryKey: ['mappings'] });
    },
    onError: (err) => handleError(err),
  });
}

export function useUpdateParent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ conceptId, newParentId }: { conceptId: string; newParentId: string | null }) =>
      getAPI().db.concepts.updateParent(conceptId, newParentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['concepts'] });
    },
    onError: (err) => handleError(err),
  });
}

export function useConceptHistory(conceptId: string | null) {
  return useQuery({
    queryKey: ['concepts', conceptId, 'history'],
    queryFn: () => getAPI().db.concepts.getHistory(conceptId!),
    enabled: !!conceptId,
    staleTime: Infinity,
  });
}
