/**
 * useRAG — RAG 语义检索与写作上下文 hooks
 *
 * Query Key: ['rag', 'search', queryHash] / ['rag', 'writingContext', sectionId]
 */

import { useQuery } from '@tanstack/react-query';
import { getAPI } from '../bridge';
import type { RAGFilter } from '../../../../shared-types/ipc';

function stableQueryHash(query: string, filter?: RAGFilter): string {
  if (!filter) return query;
  return JSON.stringify({ query, filter }, Object.keys({ query, ...filter }).sort());
}

export function useRAGSearch(query: string, filter?: RAGFilter) {
  return useQuery({
    queryKey: ['rag', 'search', stableQueryHash(query, filter)],
    queryFn: () => getAPI().rag.search(query, filter),
    enabled: query.length > 0,
    staleTime: 30_000,
    gcTime: 120_000,
  });
}

export function useWritingContext(sectionId: string | null) {
  return useQuery({
    queryKey: ['rag', 'writingContext', sectionId],
    queryFn: () => getAPI().rag.getWritingContext(sectionId!),
    enabled: sectionId !== null,
    staleTime: 30_000,
    gcTime: 120_000,
  });
}
