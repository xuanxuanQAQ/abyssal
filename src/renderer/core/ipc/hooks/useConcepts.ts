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
import { useViewActive } from '../../context/ViewActiveContext';

export function useConceptList() {
  const viewActive = useViewActive();
  return useQuery({
    queryKey: ['concepts', 'list'],
    queryFn: () => getAPI().db.concepts.list(),
    staleTime: 300_000,
    gcTime: 1_800_000,
    enabled: viewActive,
  });
}

export function useConceptFramework() {
  const viewActive = useViewActive();
  return useQuery({
    queryKey: ['concepts', 'framework'],
    queryFn: () => getAPI().db.concepts.getFramework(),
    staleTime: 300_000,
    gcTime: 1_800_000,
    enabled: viewActive,
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

export function useUpdateKeywords() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ conceptId, keywords }: { conceptId: string; keywords: string[] }) =>
      getAPI().db.concepts.updateKeywords(conceptId, keywords),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['concepts'] });
    },
  });
}

export function useConceptStats(conceptId: string | null) {
  const viewActive = useViewActive();
  return useQuery({
    queryKey: ['concepts', 'stats', conceptId],
    queryFn: () => getAPI().db.concepts.getStats(conceptId!),
    enabled: conceptId !== null && viewActive,
    staleTime: 60_000,
    gcTime: 300_000,
  });
}

export function useConceptHistory(conceptId: string | null) {
  const viewActive = useViewActive();
  return useQuery({
    queryKey: ['concepts', conceptId, 'history'],
    queryFn: () => getAPI().db.concepts.getHistory(conceptId!),
    enabled: !!conceptId && viewActive,
    staleTime: Infinity,
  });
}

export function useMemosForConcept(conceptId: string | null) {
  const viewActive = useViewActive();
  return useQuery({
    queryKey: ['memos', 'byConcept', conceptId],
    queryFn: () => getAPI().db.memos.getByEntity('concept', conceptId!),
    enabled: !!conceptId && viewActive,
    staleTime: 60_000,
  });
}

export function useNotesForConcept(conceptId: string | null) {
  const viewActive = useViewActive();
  return useQuery({
    queryKey: ['notes', 'byConcept', conceptId],
    queryFn: () => getAPI().db.notes.list({ conceptIds: [conceptId!] }),
    enabled: !!conceptId && viewActive,
    staleTime: 60_000,
  });
}

export function useConceptImpactPreview(conceptId: string | null) {
  const viewActive = useViewActive();
  return useQuery({
    queryKey: ['concepts', conceptId, 'impact'],
    queryFn: () => (getAPI() as any).db.concepts.previewImpact(conceptId!),
    enabled: !!conceptId && viewActive,
    staleTime: 30_000,
  });
}

export function useConceptHealth(conceptId: string | null) {
  const viewActive = useViewActive();
  return useQuery({
    queryKey: ['concepts', conceptId, 'health'],
    queryFn: () => (getAPI() as any).db.concepts.getHealth(conceptId!),
    enabled: !!conceptId && viewActive,
    staleTime: 60_000,
  });
}

export function useKeywordCandidates(conceptId: string | null) {
  const viewActive = useViewActive();
  return useQuery({
    queryKey: ['concepts', conceptId, 'keywordCandidates'],
    queryFn: () => (getAPI() as any).db.concepts.getKeywordCandidates(conceptId!),
    enabled: !!conceptId && viewActive,
    staleTime: 30_000,
  });
}

export function useAcceptKeyword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (candidateId: number) => (getAPI() as any).db.concepts.acceptKeyword(candidateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['concepts'] });
    },
    onError: (err) => handleError(err),
  });
}

export function useRejectKeyword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (candidateId: number) => (getAPI() as any).db.concepts.rejectKeyword(candidateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['concepts'] });
    },
    onError: (err) => handleError(err),
  });
}
