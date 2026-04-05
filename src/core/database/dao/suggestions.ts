// ═══ 概念建议管理 ═══
// §7: addSuggestedConcept / adoptSuggestedConcept / dismissSuggestedConcept

import type Database from 'better-sqlite3';
import type { SuggestionId, PaperId, ConceptId } from '../../types/common';
import type { SuggestedConcept, SuggestionStatus } from '../../types/suggestion';
import type { ConceptDefinition } from '../../types/concept';
import { asSuggestionId, asConceptId } from '../../types/common';
import { IntegrityError } from '../../types/errors';
import { fromRow, now } from '../row-mapper';
import { writeTransaction } from '../transaction-utils';
import { addConcept } from './concepts';

// ─── §7.1 addSuggestedConcept ───

export function addSuggestedConcept(
  db: Database.Database,
  input: {
    term: string;
    frequencyInPaper: number;
    sourcePaperId: PaperId;
    closestExistingConceptId?: ConceptId | null;
    closestExistingConceptSimilarity?: string | null;
    reason: string;
  },
): SuggestionId {
  const timestamp = now();
  const termNormalized = input.term.trim().toLowerCase();

  // 检查是否已存在 pending 记录
  const existing = db
    .prepare(
      "SELECT * FROM suggested_concepts WHERE term_normalized = ? AND status = 'pending'",
    )
    .get(termNormalized) as Record<string, unknown> | undefined;

  if (existing) {
    const existingId = existing['id'] as number;
    const existingPaperIds: string[] = JSON.parse(
      existing['source_paper_ids'] as string,
    );

    // 检查 sourcePaperId 是否已存在
    const alreadyHasPaper = existingPaperIds.includes(input.sourcePaperId);

    if (alreadyHasPaper) {
      // 仅更新 frequency
      db.prepare(`
        UPDATE suggested_concepts
        SET frequency = frequency + ?,
            reason = CASE WHEN length(?) > length(reason) THEN ? ELSE reason END,
            closest_existing_concept_id = COALESCE(?, closest_existing_concept_id),
            closest_existing_concept_similarity = COALESCE(?, closest_existing_concept_similarity),
            updated_at = ?
        WHERE id = ?
      `).run(
        input.frequencyInPaper,
        input.reason, input.reason,
        input.closestExistingConceptId ?? null,
        input.closestExistingConceptSimilarity ?? null,
        timestamp,
        existingId,
      );
    } else {
      // 追加 paper + 递增计数
      db.prepare(`
        UPDATE suggested_concepts
        SET frequency = frequency + ?,
            source_paper_ids = json_insert(source_paper_ids, '$[#]', ?),
            source_paper_count = source_paper_count + 1,
            reason = CASE WHEN length(?) > length(reason) THEN ? ELSE reason END,
            closest_existing_concept_id = COALESCE(?, closest_existing_concept_id),
            closest_existing_concept_similarity = COALESCE(?, closest_existing_concept_similarity),
            updated_at = ?
        WHERE id = ?
      `).run(
        input.frequencyInPaper,
        input.sourcePaperId,
        input.reason, input.reason,
        input.closestExistingConceptId ?? null,
        input.closestExistingConceptSimilarity ?? null,
        timestamp,
        existingId,
      );
    }

    return asSuggestionId(existingId);
  }

  // 新建记录
  const row = db.prepare(`
    INSERT INTO suggested_concepts (
      term, term_normalized, frequency, source_paper_ids, source_paper_count,
      closest_existing_concept_id, closest_existing_concept_similarity,
      reason, status, adopted_concept_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'pending', NULL, ?, ?)
    RETURNING id
  `).get(
    input.term,
    termNormalized,
    input.frequencyInPaper,
    JSON.stringify([input.sourcePaperId]),
    input.closestExistingConceptId ?? null,
    input.closestExistingConceptSimilarity ?? null,
    input.reason,
    timestamp,
    timestamp,
  ) as { id: number };

  return asSuggestionId(row.id);
}

// ─── §7.2 adoptSuggestedConcept ───

export function adoptSuggestedConcept(
  db: Database.Database,
  suggestionId: SuggestionId,
  conceptOverrides?: Partial<ConceptDefinition>,
): ConceptId {
  return writeTransaction(db, () => {
    const row = db
      .prepare(
        "SELECT * FROM suggested_concepts WHERE id = ? AND status = 'pending'",
      )
      .get(suggestionId) as Record<string, unknown> | undefined;

    if (!row) {
      throw new IntegrityError({
        message: `Suggested concept not found or not pending: ${suggestionId}`,
        context: { dbPath: db.name, suggestionId },
      });
    }

    const suggestion = fromRow<SuggestedConcept>(row);
    const timestamp = now();

    // 构造概念 ID: slugify(term_normalized)
    const baseId =
      conceptOverrides?.id ??
      asConceptId(
        suggestion.termNormalized
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '')
          .slice(0, 64) || 'unnamed_concept',
      );

    const concept: ConceptDefinition = {
      id: baseId,
      nameZh: conceptOverrides?.nameZh ?? suggestion.term,
      nameEn: conceptOverrides?.nameEn ?? suggestion.term,
      layer: conceptOverrides?.layer ?? 'core',
      definition: conceptOverrides?.definition ?? suggestion.reason,
      searchKeywords: conceptOverrides?.searchKeywords ?? [suggestion.term],
      maturity: conceptOverrides?.maturity ?? 'tentative',
      parentId: conceptOverrides?.parentId ?? null,
      history: [],
      deprecated: false,
      deprecatedAt: null,
      deprecatedReason: null,
      createdAt: timestamp,
    };

    addConcept(db, concept);

    db.prepare(`
      UPDATE suggested_concepts
      SET status = 'adopted', adopted_concept_id = ?, updated_at = ?
      WHERE id = ?
    `).run(concept.id, timestamp, suggestionId);

    return concept.id;
  });
}

// ─── dismissSuggestedConcept ───

export function dismissSuggestedConcept(
  db: Database.Database,
  suggestionId: SuggestionId,
): number {
  return db
    .prepare(
      "UPDATE suggested_concepts SET status = 'dismissed', updated_at = ? WHERE id = ? AND status = 'pending'",
    )
    .run(now(), suggestionId).changes;
}

// ─── restoreSuggestedConcept ───

export function restoreSuggestedConcept(
  db: Database.Database,
  suggestionId: SuggestionId,
): number {
  return db
    .prepare(
      "UPDATE suggested_concepts SET status = 'pending', updated_at = ? WHERE id = ? AND status = 'dismissed'",
    )
    .run(now(), suggestionId).changes;
}

// ─── getSuggestedConceptsStats ───

export interface SuggestedConceptsStatsResult {
  pendingCount: number;
  adoptedCount: number;
  dismissedCount: number;
}

export function getSuggestedConceptsStats(
  db: Database.Database,
): SuggestedConceptsStatsResult {
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
      SUM(CASE WHEN status = 'adopted' THEN 1 ELSE 0 END) AS adopted_count,
      SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) AS dismissed_count
    FROM suggested_concepts
  `).get() as { pending_count: number; adopted_count: number; dismissed_count: number };

  return {
    pendingCount: row.pending_count ?? 0,
    adoptedCount: row.adopted_count ?? 0,
    dismissedCount: row.dismissed_count ?? 0,
  };
}

// ─── 查询 ───

export function getSuggestedConcepts(
  db: Database.Database,
  status?: SuggestionStatus,
  limit: number = 50,
): SuggestedConcept[] {
  const condition = status ? 'WHERE status = ?' : '';
  const params: unknown[] = status ? [status, limit] : [limit];

  const rows = db
    .prepare(
      `SELECT * FROM suggested_concepts ${condition} ORDER BY source_paper_count DESC, frequency DESC LIMIT ?`,
    )
    .all(...params) as Record<string, unknown>[];

  return rows.map((r) => fromRow<SuggestedConcept>(r));
}

export function getSuggestedConcept(
  db: Database.Database,
  id: SuggestionId,
): SuggestedConcept | null {
  const row = db
    .prepare('SELECT * FROM suggested_concepts WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return fromRow<SuggestedConcept>(row);
}

// ─── getSuggestedConceptByTerm ───

export function getSuggestedConceptByTerm(
  db: Database.Database,
  termNormalized: string,
): SuggestedConcept | null {
  const row = db
    .prepare(
      "SELECT * FROM suggested_concepts WHERE term_normalized = ? AND status = 'pending'",
    )
    .get(termNormalized) as Record<string, unknown> | undefined;
  if (!row) return null;
  return fromRow<SuggestedConcept>(row);
}

// ─── updateSuggestedConcept ───

export function updateSuggestedConcept(
  db: Database.Database,
  id: SuggestionId,
  updates: Record<string, unknown>,
): number {
  const allowed = ['frequency', 'source_paper_ids', 'source_paper_count', 'reason', 'updated_at'];
  const entries = Object.entries(updates).filter(([k]) => allowed.includes(k));
  if (entries.length === 0) return 0;

  const setClauses = entries.map(([k]) => `${k} = ?`).join(', ');
  const values = entries.map(([, v]) => v);
  values.push(id);

  return db
    .prepare(`UPDATE suggested_concepts SET ${setClauses} WHERE id = ?`)
    .run(...values).changes;
}
