/**
 * useConcepts -- concept data query & mutation hooks
 *
 * Query Key: ['concepts', 'list'] / ['concepts', 'framework']
 * v1.2: merge, split, resolve, reassign mutations
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAPI } from '../bridge';
import type { ConceptFramework, MergeDecision, NewConceptDef, MappingAssignment, ConceptDraft, MergeConflictResolution } from '../../../../shared-types/models';
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

// ── v1.2 Concept Merge/Split Hooks ──

/**
 * @deprecated v1.2 — use ConceptMergeDialog (v2.0 4-step wizard) for full merge flow.
 * This hook wraps the v2.0 merge API with an empty conflict resolution array for backward compat.
 */
export function useMergeConcepts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ keepId, mergeId }: { keepId: string; mergeId: string }) =>
      getAPI().db.concepts.merge(keepId, mergeId, []),

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

/**
 * @deprecated v1.2 — use the v2.0 split wizard for the full split flow.
 * This hook wraps the v2.0 split API, converting NewConceptDef[] to ConceptDraft pair.
 */
export function useSplitConcept() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      conceptId,
      newConcepts,
    }: {
      conceptId: string;
      newConcepts: NewConceptDef[];
    }) => {
      const toDraft = (def: NewConceptDef): ConceptDraft => ({
        nameZh: def.name,
        nameEn: def.name,
        definition: def.description,
        keywords: [],
        parentId: null,
      });
      const concept1 = toDraft(newConcepts[0]!);
      const concept2 = toDraft(newConcepts[1] ?? newConcepts[0]!);
      return getAPI().db.concepts.split(conceptId, concept1, concept2, []);
    },

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
