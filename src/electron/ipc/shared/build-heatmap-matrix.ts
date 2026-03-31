/**
 * Shared utility: build concept × paper heatmap matrix.
 * Used by mappings-handler (getHeatmapData) and concepts-handler (getMatrix).
 */

import type { DbProxyInstance } from '../../../db-process/db-proxy';

export interface HeatmapMatrixData {
  conceptIds: string[];
  paperIds: string[];
  cells: Array<{
    paperId: unknown;
    conceptId: unknown;
    relation: unknown;
    confidence: unknown;
    reviewed: unknown;
  }>;
}

export async function buildHeatmapMatrix(
  dbProxy: DbProxyInstance,
): Promise<HeatmapMatrixData> {
  const entries = await dbProxy.getConceptMatrix();
  const conceptIds = [...new Set(entries.map((e) => e['conceptId'] as string))];
  const paperIds = [...new Set(entries.map((e) => e['paperId'] as string))];
  const cells = entries.map((e) => ({
    paperId: e['paperId'],
    conceptId: e['conceptId'],
    relation: e['relation'],
    confidence: e['confidence'],
    reviewed: e['reviewed'],
  }));
  return { conceptIds, paperIds, cells };
}
