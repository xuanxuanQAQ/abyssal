/**
 * useRAG — RAG 语义检索与写作上下文 hooks
 *
 * Query Key: ['rag', 'search', queryHash] / ['rag', 'writingContext', sectionId]
 */

import { useQuery } from '@tanstack/react-query';
import { getAPI } from '../bridge';
import type { RAGFilter } from '../../../../shared-types/ipc';
import type { WritingContextRequest } from '../../../../shared-types/models';

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

export function buildWritingContextQueryKey(request: WritingContextRequest | null) {
  return [
    'rag',
    'writingContext',
    request?.articleId ?? '',
    request?.draftId ?? '',
    request?.sectionId ?? '',
    request?.mode ?? 'local',
  ] as const;
}

export function useWritingContext(request: WritingContextRequest | null) {
  return useQuery({
    queryKey: buildWritingContextQueryKey(request),
    queryFn: () => getAPI().rag.getWritingContext(request!),
    enabled: request?.sectionId !== null && request?.sectionId !== undefined,
    refetchOnMount: 'always',
    staleTime: 30_000,
    gcTime: 120_000,
  });
}
