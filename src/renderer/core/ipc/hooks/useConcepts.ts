/**
 * useConcepts -- concept data query & mutation hooks
 *
 * Query Key: ['concepts', 'list'] / ['concepts', 'framework']
 * v1.2: merge, split, resolve, reassign mutations
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAPI } from '../bridge';
import type { ConceptFramework, MergeDecision, NewConceptDef, MappingAssignment } from '../../../../shared-types/models';
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

// ── v1.2 Concept Merge/Split Hooks ──

export function useMergeConcepts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ keepId, mergeId }: { keepId: string; mergeId: string }) =>
      getAPI().db.concepts.merge(keepId, mergeId),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['concepts'] });
      queryClient.invalidateQueries({ queryKey: ['mappings'] });
    },

    onError: (err) => handleError(err),
  });
}

export function useResolveMergeConflicts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (decisions: MergeDecision[]) =>
      getAPI().db.concepts.resolveMergeConflicts(decisions),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['concepts'] });
      queryClient.invalidateQueries({ queryKey: ['mappings'] });
    },

    onError: (err) => handleError(err),
  });
}

export function useSplitConcept() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      conceptId,
      newConcepts,
    }: {
      conceptId: string;
      newConcepts: NewConceptDef[];
    }) => getAPI().db.concepts.split(conceptId, newConcepts),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['concepts'] });
      queryClient.invalidateQueries({ queryKey: ['mappings'] });
    },

    onError: (err) => handleError(err),
  });
}

export function useReassignMappings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (assignments: MappingAssignment[]) =>
      getAPI().db.concepts.reassignMappings(assignments),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['concepts'] });
      queryClient.invalidateQueries({ queryKey: ['mappings'] });
    },

    onError: (err) => handleError(err),
  });
}
