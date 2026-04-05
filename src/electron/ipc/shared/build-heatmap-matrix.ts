/**
 * Shared utility: build concept × paper heatmap matrix.
 * Used by mappings-handler (getHeatmapData) and concepts-handler (getMatrix).
 */

import type { DbProxyInstance } from '../../../db-process/db-proxy';
import type { ConceptMatrixEntry } from '../../../core/database/dao/mappings';
import type { ConceptDefinition } from '../../../core/types/concept';
import type { AdjudicationStatus } from '../../../shared-types/enums';
import type { HeatmapMatrix } from '../../../shared-types/models';

function normalizeAdjudicationStatus(
  decisionStatus: string | null | undefined,
): AdjudicationStatus {
  switch (decisionStatus) {
    case 'accepted':
    case 'revised':
    case 'rejected':
      return decisionStatus;
    default:
      return 'pending';
  }
}

export async function buildHeatmapMatrix(
  dbProxy: DbProxyInstance,
): Promise<HeatmapMatrix> {
  const entries = await dbProxy.getConceptMatrix() as ConceptMatrixEntry[];
  const conceptDefinitions = typeof dbProxy.getAllConcepts === 'function'
    ? await dbProxy.getAllConcepts() as ConceptDefinition[]
    : [];
  const conceptIds = conceptDefinitions.map((concept) => concept.id);
  const paperIds: string[] = [];
  const conceptIndexById = new Map(conceptIds.map((conceptId, index) => [conceptId, index]));
  const paperIndexById = new Map<string, number>();

  for (const entry of entries) {
    if (!conceptIndexById.has(entry.conceptId)) {
      conceptIndexById.set(entry.conceptId, conceptIds.length);
      conceptIds.push(entry.conceptId);
    }
    if (!paperIndexById.has(entry.paperId)) {
      paperIndexById.set(entry.paperId, paperIds.length);
      paperIds.push(entry.paperId);
    }
  }

  const cells = entries.flatMap((entry) => {
    const conceptIndex = conceptIndexById.get(entry.conceptId);
    const paperIndex = paperIndexById.get(entry.paperId);
    if (conceptIndex == null || paperIndex == null) {
      return [];
    }

    return [{
      conceptIndex,
      paperIndex,
      relationType: entry.relation,
      confidence: entry.confidence,
      mappingId: `${entry.paperId}::${entry.conceptId}`,
      adjudicationStatus: normalizeAdjudicationStatus(entry.decisionStatus),
    }];
  });

  return { conceptIds, paperIds, cells };
}
