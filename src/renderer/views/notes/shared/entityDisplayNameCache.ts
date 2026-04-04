import { useMemo } from 'react';
import { useConceptList } from '../../../core/ipc/hooks/useConcepts';
import { usePaperList } from '../../../core/ipc/hooks/usePapers';

const EMPTY_LOOKUP: ReadonlyMap<string, string> = new Map();
const paperLookupCache = new WeakMap<ReadonlyArray<unknown>, ReadonlyMap<string, string>>();
const conceptLookupCache = new WeakMap<ReadonlyArray<unknown>, ReadonlyMap<string, string>>();

export interface EntityDisplayNameCache {
  getPaperName: (paperId: string) => string;
  getConceptName: (conceptId: string) => string;
}

function truncateDisplayName(value: string, maxLength: number): string {
  return value.slice(0, maxLength);
}

export function getPaperNameLookup(papers?: ReadonlyArray<unknown>): ReadonlyMap<string, string> {
  if (!papers || papers.length === 0) {
    return EMPTY_LOOKUP;
  }

  const cached = paperLookupCache.get(papers);
  if (cached) {
    return cached;
  }

  const lookup = new Map<string, string>();
  for (const paper of papers) {
    const record = paper as Record<string, unknown>;
    const id = typeof record['id'] === 'string' ? record['id'] : '';
    if (!id) continue;
    const title = typeof record['title'] === 'string' && record['title'].trim().length > 0
      ? record['title']
      : id;
    lookup.set(id, truncateDisplayName(title, 30));
  }

  paperLookupCache.set(papers, lookup);
  return lookup;
}

export function getConceptNameLookup(concepts?: ReadonlyArray<unknown>): ReadonlyMap<string, string> {
  if (!concepts || concepts.length === 0) {
    return EMPTY_LOOKUP;
  }

  const cached = conceptLookupCache.get(concepts);
  if (cached) {
    return cached;
  }

  const lookup = new Map<string, string>();
  for (const concept of concepts) {
    const record = concept as Record<string, unknown>;
    const id = typeof record['id'] === 'string' ? record['id'] : '';
    if (!id) continue;
    const name = typeof record['nameEn'] === 'string' && record['nameEn'].trim().length > 0
      ? record['nameEn']
      : typeof record['name_en'] === 'string' && record['name_en'].trim().length > 0
        ? record['name_en']
        : id;
    lookup.set(id, truncateDisplayName(name, 30));
  }

  conceptLookupCache.set(concepts, lookup);
  return lookup;
}

export function resolvePaperDisplayName(paperId: string, lookup: ReadonlyMap<string, string>): string {
  return lookup.get(paperId) ?? paperId.slice(0, 10);
}

export function resolveConceptDisplayName(conceptId: string, lookup: ReadonlyMap<string, string>): string {
  return lookup.get(conceptId) ?? conceptId.slice(0, 10);
}

export function useEntityDisplayNameCache(): EntityDisplayNameCache {
  const { data: papers } = usePaperList();
  const { data: concepts } = useConceptList();

  const paperLookup = useMemo(() => getPaperNameLookup(papers), [papers]);
  const conceptLookup = useMemo(() => getConceptNameLookup(concepts), [concepts]);

  return useMemo(() => ({
    getPaperName: (paperId: string) => resolvePaperDisplayName(paperId, paperLookup),
    getConceptName: (conceptId: string) => resolveConceptDisplayName(conceptId, conceptLookup),
  }), [paperLookup, conceptLookup]);
}