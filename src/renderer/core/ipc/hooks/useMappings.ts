/**
 * useMappings — 概念映射查询与裁决 hooks
 *
 * Query Key: ['mappings', 'paper', paperId] / ['mappings', 'concept', conceptId] / ['mappings', 'heatmap']
 * 裁决操作遵循三步竞态安全协议
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAPI } from '../bridge';
import type { ConceptMapping } from '../../../../shared-types/models';
import type { AdjudicationDecision } from '../../../../shared-types/enums';
import { handleError } from '../../errors/errorHandlers';

export function useMappingsForPaper(paperId: string | null) {
  return useQuery({
    queryKey: ['mappings', 'paper', paperId],
    queryFn: () => getAPI().db.mappings.getForPaper(paperId!),
    enabled: paperId !== null,
    staleTime: 60_000,
    gcTime: 600_000,
  });
}

export function useMappingsForConcept(conceptId: string | null) {
  return useQuery({
    queryKey: ['mappings', 'concept', conceptId],
    queryFn: () => getAPI().db.mappings.getForConcept(conceptId!),
    enabled: conceptId !== null,
    staleTime: 60_000,
    gcTime: 600_000,
  });
}

export function useHeatmapData() {
  return useQuery({
    queryKey: ['mappings', 'heatmap'],
    queryFn: () => getAPI().db.mappings.getHeatmapData(),
    staleTime: 300_000,
    gcTime: 1_800_000,
  });
}

export function useAdjudicateMapping() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      mappingId,
      decision,
      paperId: _paperId,
      revisedMapping,
    }: {
      mappingId: string;
      decision: AdjudicationDecision;
      paperId: string;
      revisedMapping?: Partial<ConceptMapping>;
    }) => getAPI().db.mappings.adjudicate(mappingId, decision, revisedMapping),

    onMutate: async ({ mappingId, decision, paperId }) => {
      // 1. 取消冲突查询
      await queryClient.cancelQueries({
        queryKey: ['mappings', 'paper', paperId],
      });

      // 2. 快照
      const previousMappings = queryClient.getQueryData<ConceptMapping[]>([
        'mappings',
        'paper',
        paperId,
      ]);

      // 3. 乐观写入
      if (previousMappings) {
        queryClient.setQueryData<ConceptMapping[]>(
          ['mappings', 'paper', paperId],
          previousMappings.map((m) =>
            m.id === mappingId
              ? {
                  ...m,
                  adjudicationStatus:
                    decision === 'accept'
                      ? 'accepted'
                      : decision === 'reject'
                        ? 'rejected'
                        : 'revised',
                }
              : m
          )
        );
      }

      return { previousMappings, paperId };
    },

    onError: (_err, _vars, context) => {
      if (context?.previousMappings) {
        queryClient.setQueryData(
          ['mappings', 'paper', context.paperId],
          context.previousMappings
        );
      }
      handleError(_err);
    },

    onSettled: (_data, _err, { paperId }) => {
      queryClient.invalidateQueries({
        queryKey: ['mappings', 'paper', paperId],
      });
      queryClient.invalidateQueries({ queryKey: ['mappings', 'heatmap'] });
    },
  });
}
