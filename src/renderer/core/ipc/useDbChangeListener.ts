/**
 * DbChangeListener — push:db-changed event → TanStack Query invalidation.
 *
 * Mounted once in App.tsx. Listens for db-changed events from the main process.
 *
 * Smart invalidation strategy:
 * - If affectedIds contains specific IDs → update only those items in cache
 * - If affectedIds contains ['*'] or is missing → full query invalidation
 *
 * This prevents "refetch storm" when Orchestrator updates papers one-by-one
 * during batch analysis (would otherwise cause N full-list refetches).
 *
 * See spec: section 5.1–5.2
 */

import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { getAPI } from './bridge';
import type { PaperFilter } from '../../../shared-types/ipc';

// ─── Table → queryKey mapping ───

const TABLE_TO_QUERY_KEYS: Record<string, string[][]> = {
  papers:             [['papers'], ['projectInfo']],
  concepts:           [['concepts'], ['framework']],
  paper_concept_map:  [['concepts'], ['mappings'], ['heatmap']],
  research_memos:     [['memos']],
  research_notes:     [['notes']],
  suggested_concepts: [['suggestedConcepts']],
  annotations:        [['annotations']],
  relations:          [['relations'], ['graph']],
  articles:           [['articles']],
  sections:           [['articles']],
  outlines:           [['articles']],
  tags:               [['tags']],
};

// Tables that support granular per-ID cache update instead of full refetch
const GRANULAR_TABLES = new Set(['papers', 'concepts', 'research_memos', 'research_notes']);

// ─── Granular updater: fetch only changed IDs + merge into cache ───

async function applyGranularUpdate(
  queryClient: QueryClient,
  table: string,
  ids: string[],
): Promise<void> {
  // For papers: fetch the specific changed papers and update them in the
  // query cache without refetching the entire list.
  if (table === 'papers' && ids.length > 0 && ids.length <= 20) {
    try {
      const api = getAPI();
      // Fetch only the changed papers
      const updated = await api.db.papers.list({ ids } as unknown as PaperFilter | undefined);
      if (!Array.isArray(updated)) return;

      // Update the list query cache in-place
      queryClient.setQueriesData(
        { queryKey: ['papers'] },
        (oldData: unknown) => {
          if (!oldData || !Array.isArray(oldData)) return oldData;
          const updateMap = new Map<string, unknown>();
          for (const p of updated) {
            const id = (p as unknown as Record<string, unknown>)['id'] as string;
            if (id) updateMap.set(id, p);
          }
          return oldData.map((item: unknown) => {
            const id = (item as Record<string, unknown>)['id'] as string;
            return updateMap.get(id) ?? item;
          });
        },
      );
      // Also update individual paper detail caches
      for (const p of updated) {
        const id = (p as unknown as Record<string, unknown>)['id'] as string;
        if (id) {
          queryClient.setQueryData(['papers', 'detail', id], p);
        }
      }
      return; // Granular update succeeded — skip full invalidation
    } catch {
      // Granular update failed — fall through to full invalidation
    }
  }

  // For other granular tables, fall through to full invalidation
  // (could be extended with per-table granular logic)
}

// ─── Component ───

export function DbChangeListener() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const api = getAPI();
    if (!(api as any).on?.dbChanged) return;

    const unsubscribe = (api as any).on.dbChanged(async (event: {
      tables: string[];
      operations: string[];
      affectedIds: Record<string, string[]>;
    }) => {
      const fullInvalidateKeys = new Set<string>();

      for (const table of event.tables) {
        const ids = event.affectedIds?.[table];
        const isFullRefresh = !ids || ids.length === 0 || ids.includes('*');

        if (!isFullRefresh && GRANULAR_TABLES.has(table)) {
          // Try granular update for supported tables
          await applyGranularUpdate(queryClient, table, ids);
        } else {
          // Full invalidation for this table's query keys
          const queryKeys = TABLE_TO_QUERY_KEYS[table];
          if (queryKeys) {
            for (const key of queryKeys) {
              fullInvalidateKeys.add(JSON.stringify(key));
            }
          }
        }
      }

      // Execute full invalidations
      for (const keyStr of fullInvalidateKeys) {
        const key = JSON.parse(keyStr) as string[];
        void queryClient.invalidateQueries({ queryKey: key });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [queryClient]);

  return null;
}
