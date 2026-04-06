import type { ConceptDefinition } from '../../../core/types/concept';
import type { Concept, HistoryEntry } from '../../../shared-types/models';

export function historyEntryToFrontend(entry: ConceptDefinition['history'][number]): HistoryEntry {
  return {
    timestamp: entry.timestamp,
    type: entry.changeType,
    details: {
      summary: entry.oldValueSummary,
      reason: entry.reason,
      ...(entry.metadata ?? {}),
    },
  };
}

export function buildConceptLevelMap(concepts: readonly ConceptDefinition[]): Map<string, number> {
  const conceptById = new Map<string, ConceptDefinition>(concepts.map((concept) => [concept.id, concept]));
  const levelById = new Map<string, number>();
  const visiting = new Set<string>();

  const resolveLevel = (conceptId: string): number => {
    const cached = levelById.get(conceptId);
    if (cached !== undefined) {
      return cached;
    }

    const concept = conceptById.get(conceptId);
    if (!concept?.parentId) {
      levelById.set(conceptId, 0);
      return 0;
    }

    if (visiting.has(conceptId)) {
      levelById.set(conceptId, 0);
      return 0;
    }

    visiting.add(conceptId);
    const parentLevel = conceptById.has(concept.parentId)
      ? resolveLevel(concept.parentId)
      : -1;
    visiting.delete(conceptId);

    const level = parentLevel + 1;
    levelById.set(conceptId, level);
    return level;
  };

  for (const concept of concepts) {
    resolveLevel(concept.id);
  }

  return levelById;
}

export function conceptToFrontend(
  concept: ConceptDefinition,
  levelById: ReadonlyMap<string, number>,
): Concept {
  return {
    id: concept.id,
    name: concept.nameEn,
    nameZh: concept.nameZh,
    nameEn: concept.nameEn,
    description: concept.definition,
    parentId: concept.parentId,
    level: levelById.get(concept.id) ?? 0,
    maturity: concept.maturity,
    keywords: Array.isArray(concept.searchKeywords) ? concept.searchKeywords : [],
    history: Array.isArray(concept.history) ? concept.history.map(historyEntryToFrontend) : [],
  };
}

export function mapConceptsToFrontend(concepts: readonly ConceptDefinition[]): Concept[] {
  const levelById = buildConceptLevelMap(concepts);
  return concepts.map((concept) => conceptToFrontend(concept, levelById));
}

export function findConceptFrontendById(
  concepts: readonly ConceptDefinition[],
  conceptId: string,
): Concept | null {
  const concept = concepts.find((entry) => entry.id === conceptId);
  if (!concept) {
    return null;
  }

  return conceptToFrontend(concept, buildConceptLevelMap(concepts));
}