// ═══ 概念框架管理 ═══
// §4: addConcept / updateConcept / deprecateConcept / syncConcepts / mergeConcepts / splitConcept / gcConceptChange

import type Database from 'better-sqlite3';
import type { ConceptId, PaperId } from '../../types/common';
import type { ConceptDefinition, ConceptHistoryEntry, ConceptMaturity } from '../../types/concept';
import type { ConceptMapping } from '../../types/mapping';
import { isConceptId } from '../../types/common';
import { IntegrityError } from '../../types/errors';
import { fromRow, now } from '../row-mapper';
import { safeFromRow, ConceptRowSchema } from '../schemas';
import { writeTransaction } from '../transaction-utils';

// ─── 内部工具 ───

function getConceptOrThrow(
  db: Database.Database,
  id: ConceptId,
  mustBeActive: boolean = true,
): ConceptDefinition {
  const condition = mustBeActive
    ? 'WHERE id = ? AND deprecated = 0'
    : 'WHERE id = ?';
  const row = db
    .prepare(`SELECT * FROM concepts ${condition}`)
    .get(id) as Record<string, unknown> | undefined;
  if (!row) {
    throw new IntegrityError({
      message: mustBeActive
        ? `Concept not found or deprecated: ${id}`
        : `Concept not found: ${id}`,
      context: { dbPath: db.name, conceptId: id },
    });
  }
  return fromRow<ConceptDefinition>(row);
}

function appendHistory(
  existing: ConceptHistoryEntry[],
  entry: ConceptHistoryEntry,
): string {
  const updated = [...existing, entry];
  return JSON.stringify(updated);
}

const MATURITY_ORDER: Record<ConceptMaturity, number> = {
  tentative: 0,
  working: 1,
  established: 2,
};

/**
 * DAG 循环检测：从 targetParentId 沿 parent_id 链向上遍历，
 * 如果遇到 childId 说明 childId→targetParentId 形成循环。
 *
 * 最大遍历深度 64（与 ConceptId 长度上限一致），防止脏数据导致死循环。
 */
function detectParentCycle(
  db: Database.Database,
  childId: ConceptId,
  targetParentId: ConceptId | null,
): void {
  if (!targetParentId) return;
  if (targetParentId === childId) {
    throw new IntegrityError({
      message: `Cannot set concept "${childId}" as its own parent`,
      context: { dbPath: db.name, conceptId: childId, parentId: targetParentId },
    });
  }

  const stmt = db.prepare('SELECT parent_id FROM concepts WHERE id = ?');
  let current: string | null = targetParentId;
  const maxDepth = 64;

  for (let depth = 0; depth < maxDepth && current; depth++) {
    const row = stmt.get(current) as { parent_id: string | null } | undefined;
    if (!row) break; // 概念不存在——链断裂，无循环
    current = row.parent_id;
    if (current === childId) {
      throw new IntegrityError({
        message: `Setting parent_id="${targetParentId}" for concept "${childId}" would create a cycle`,
        context: { dbPath: db.name, conceptId: childId, parentId: targetParentId },
      });
    }
  }
}

// ─── §4.1 addConcept ───

export function addConcept(
  db: Database.Database,
  concept: ConceptDefinition,
): void {
  if (!isConceptId(concept.id)) {
    throw new IntegrityError({
      message: `Invalid ConceptId: "${concept.id}" — must match /^[a-z][a-z0-9_]{0,63}$/`,
      context: { dbPath: db.name, conceptId: concept.id },
    });
  }

  // DAG 循环检测
  if (concept.parentId) {
    detectParentCycle(db, concept.id, concept.parentId);
  }

  const existing = db
    .prepare('SELECT 1 FROM concepts WHERE id = ?')
    .get(concept.id) as { 1: number } | undefined;
  if (existing) {
    throw new IntegrityError({
      message: `Concept already exists: ${concept.id}`,
      context: { dbPath: db.name, conceptId: concept.id },
    });
  }

  const timestamp = now();
  const initialHistory: ConceptHistoryEntry = {
    timestamp,
    changeType: 'created',
    oldValueSummary: '',
    reason: null,
    isBreaking: false,
    metadata: null,
  };

  const history = JSON.stringify([initialHistory]);

  db.prepare(`
    INSERT INTO concepts (
      id, name_zh, name_en, layer, definition, search_keywords,
      maturity, parent_id, history, deprecated, deprecated_at,
      deprecated_reason, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?)
  `).run(
    concept.id,
    concept.nameZh,
    concept.nameEn,
    concept.layer,
    concept.definition,
    JSON.stringify(concept.searchKeywords),
    concept.maturity,
    concept.parentId,
    history,
    timestamp,
    timestamp,
  );
}

// ─── §4.2 updateConcept ───

export interface UpdateConceptFields {
  nameZh?: string;
  nameEn?: string;
  layer?: string;
  definition?: string;
  searchKeywords?: string[];
  maturity?: ConceptMaturity;
  parentId?: ConceptId | null;
}

export interface GcConceptChangeResult {
  affectedMappings: number;
  requiresRelationRecompute: boolean;
  requiresSynthesizeRefresh: boolean;
  affectedPaperIds: PaperId[];
}

export function updateConcept(
  db: Database.Database,
  id: ConceptId,
  fields: UpdateConceptFields,
  isBreaking: boolean = false,
  lookbackDays: number = 30,
): GcConceptChangeResult {
  return writeTransaction(db, () => {
    const current = getConceptOrThrow(db, id);
    const timestamp = now();
    const newEntries: ConceptHistoryEntry[] = [];

    // 为每个变更字段构造 ConceptHistoryEntry
    if (fields.definition !== undefined && fields.definition !== current.definition) {
      newEntries.push({
        timestamp,
        changeType: 'definition_refined',
        oldValueSummary: current.definition.slice(0, 200),
        reason: null,
        isBreaking,
        metadata: null,
      });
    }

    if (fields.searchKeywords !== undefined) {
      const oldSet = new Set(current.searchKeywords);
      const newSet = new Set(fields.searchKeywords);
      const added = fields.searchKeywords.filter((k) => !oldSet.has(k));
      const removed = current.searchKeywords.filter((k) => !newSet.has(k));
      if (added.length > 0) {
        newEntries.push({
          timestamp,
          changeType: 'keywords_added',
          oldValueSummary: added.join(', '),
          reason: null,
          isBreaking: false,
          metadata: { added },
        });
      }
      if (removed.length > 0) {
        newEntries.push({
          timestamp,
          changeType: 'keywords_removed',
          oldValueSummary: removed.join(', '),
          reason: null,
          isBreaking: false,
          metadata: { removed },
        });
      }
    }

    if (fields.maturity !== undefined && fields.maturity !== current.maturity) {
      const upgraded =
        MATURITY_ORDER[fields.maturity] > MATURITY_ORDER[current.maturity];
      newEntries.push({
        timestamp,
        changeType: upgraded ? 'maturity_upgraded' : 'maturity_downgraded',
        oldValueSummary: current.maturity,
        reason: null,
        isBreaking: false,
        metadata: { from: current.maturity, to: fields.maturity },
      });
    }

    if (fields.parentId !== undefined && fields.parentId !== current.parentId) {
      // DAG 循环检测
      detectParentCycle(db, id, fields.parentId);

      newEntries.push({
        timestamp,
        changeType: 'parent_changed',
        oldValueSummary: current.parentId ?? '',
        reason: null,
        isBreaking: false,
        metadata: { from: current.parentId, to: fields.parentId },
      });
    }

    if (fields.layer !== undefined && fields.layer !== current.layer) {
      newEntries.push({
        timestamp,
        changeType: 'layer_changed',
        oldValueSummary: current.layer,
        reason: null,
        isBreaking: false,
        metadata: { from: current.layer, to: fields.layer },
      });
    }

    // 追加历史（Fix: 避免 JSON parse/stringify 循环——history 始终为数组类型）
    let historyArr = current.history;
    for (const entry of newEntries) {
      historyArr = [...historyArr, entry];
    }

    // 构造 UPDATE SET
    const setClauses: string[] = ['updated_at = ?', 'history = ?'];
    const params: unknown[] = [timestamp, JSON.stringify(historyArr)];

    if (fields.nameZh !== undefined) { setClauses.push('name_zh = ?'); params.push(fields.nameZh); }
    if (fields.nameEn !== undefined) { setClauses.push('name_en = ?'); params.push(fields.nameEn); }
    if (fields.layer !== undefined) { setClauses.push('layer = ?'); params.push(fields.layer); }
    if (fields.definition !== undefined) { setClauses.push('definition = ?'); params.push(fields.definition); }
    if (fields.searchKeywords !== undefined) { setClauses.push('search_keywords = ?'); params.push(JSON.stringify(fields.searchKeywords)); }
    if (fields.maturity !== undefined) { setClauses.push('maturity = ?'); params.push(fields.maturity); }
    if (fields.parentId !== undefined) { setClauses.push('parent_id = ?'); params.push(fields.parentId); }

    params.push(id);
    db.prepare(`UPDATE concepts SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

    // 如果 definition 变更，执行 gcConceptChange
    if (fields.definition !== undefined && fields.definition !== current.definition) {
      return gcConceptChange(db, id, 'definition_refined', isBreaking, lookbackDays);
    }

    return {
      affectedMappings: 0,
      requiresRelationRecompute: false,
      requiresSynthesizeRefresh: false,
      affectedPaperIds: [],
    };
  });
}

// ─── §4.3 deprecateConcept ───

export function deprecateConcept(
  db: Database.Database,
  id: ConceptId,
  reason: string,
): GcConceptChangeResult {
  return writeTransaction(db, () => {
    const current = getConceptOrThrow(db, id);
    const timestamp = now();

    const entry: ConceptHistoryEntry = {
      timestamp,
      changeType: 'deprecated',
      oldValueSummary: '',
      reason,
      isBreaking: false,
      metadata: null,
    };

    const history = appendHistory(current.history, entry);

    db.prepare(`
      UPDATE concepts
      SET deprecated = 1, deprecated_at = ?, deprecated_reason = ?,
          history = ?, updated_at = ?
      WHERE id = ?
    `).run(timestamp, reason, history, timestamp, id);

    // §8: 概念建议表清理——解除 suggested_concepts 的 closest_existing_concept_id 引用
    db.prepare(
      'UPDATE suggested_concepts SET closest_existing_concept_id = NULL WHERE closest_existing_concept_id = ?',
    ).run(id);

    // §8.2: 清理 research_memos 中废弃概念引用
    // 从 concept_ids JSON 数组中移除废弃概念 ID
    db.prepare(`
      UPDATE research_memos
      SET concept_ids = (
        SELECT json_group_array(val)
        FROM (
          SELECT je.value AS val
          FROM json_each(concept_ids) je
          WHERE je.value != ?
        )
      ),
      updated_at = ?
      WHERE id IN (
        SELECT m.id FROM research_memos m, json_each(m.concept_ids) je
        WHERE je.value = ?
      )
    `).run(id, timestamp, id);

    // §8.3: 清理 research_notes 中废弃概念引用
    db.prepare(`
      UPDATE research_notes
      SET linked_concept_ids = (
        SELECT json_group_array(val)
        FROM (
          SELECT je.value AS val
          FROM json_each(linked_concept_ids) je
          WHERE je.value != ?
        )
      ),
      updated_at = ?
      WHERE id IN (
        SELECT n.id FROM research_notes n, json_each(n.linked_concept_ids) je
        WHERE je.value = ?
      )
    `).run(id, timestamp, id);

    // §8.4: 清理 memo_concept_map 规范化表
    db.prepare('DELETE FROM memo_concept_map WHERE concept_id = ?').run(id);

    return gcConceptChange(db, id, 'deprecated', false);
  });

}

// ─── §4.4 syncConcepts ───

export interface SyncConceptsResult {
  added: ConceptId[];
  updated: ConceptId[];
  deprecated: ConceptId[];
  affectedMappingCount: number;
}

export function syncConcepts(
  db: Database.Database,
  concepts: ConceptDefinition[],
  strategy: 'merge' | 'replace',
  isBreakingMap: Record<string, boolean> = {},
  lookbackDays: number = 30,
): SyncConceptsResult {
  return writeTransaction(db, () => {
    const existingRows = db
      .prepare('SELECT id FROM concepts WHERE deprecated = 0')
      .all() as { id: string }[];
    const existingIds = new Set(existingRows.map((r) => r.id));

    const added: ConceptId[] = [];
    const updated: ConceptId[] = [];
    const deprecated: ConceptId[] = [];
    let affectedMappingCount = 0;

    const newIds = new Set(concepts.map((c) => c.id as string));

    for (const concept of concepts) {
      if (!existingIds.has(concept.id)) {
        addConcept(db, concept);
        added.push(concept.id);
      } else {
        // 比较差异，有变更则 updateConcept
        const current = getConceptOrThrow(db, concept.id);
        const fields: UpdateConceptFields = {};
        let hasChanges = false;

        if (concept.nameZh !== current.nameZh) { fields.nameZh = concept.nameZh; hasChanges = true; }
        if (concept.nameEn !== current.nameEn) { fields.nameEn = concept.nameEn; hasChanges = true; }
        if (concept.layer !== current.layer) { fields.layer = concept.layer; hasChanges = true; }
        if (concept.definition !== current.definition) { fields.definition = concept.definition; hasChanges = true; }
        if (JSON.stringify(concept.searchKeywords) !== JSON.stringify(current.searchKeywords)) {
          fields.searchKeywords = concept.searchKeywords; hasChanges = true;
        }
        if (concept.maturity !== current.maturity) { fields.maturity = concept.maturity; hasChanges = true; }
        if (concept.parentId !== current.parentId) { fields.parentId = concept.parentId; hasChanges = true; }

        if (hasChanges) {
          const breaking = isBreakingMap[concept.id] ?? false;
          const result = updateConcept(db, concept.id, fields, breaking, lookbackDays);
          affectedMappingCount += result.affectedMappings;
          updated.push(concept.id);
        }
      }
    }

    // replace 策略：不在新列表中的概念执行 deprecate
    if (strategy === 'replace') {
      for (const existingId of existingIds) {
        if (!newIds.has(existingId)) {
          const result = deprecateConcept(
            db,
            existingId as ConceptId,
            'Removed during concept sync (replace strategy)',
          );
          affectedMappingCount += result.affectedMappings;
          deprecated.push(existingId as ConceptId);
        }
      }
    }

    return { added, updated, deprecated, affectedMappingCount };
  });

}

// ─── §4.5 mergeConcepts ───

export interface ConflictEntry {
  paperId: PaperId;
  keepRelation: string;
  keepConfidence: number;
  mergeRelation: string;
  mergeConfidence: number;
}

export type ConflictResolution = 'keep' | 'merge' | 'max_confidence';

export interface MergeConceptsResult {
  conflicts: ConflictEntry[];
  migratedMappings: number;
  affectedPapers: PaperId[];
}

export function mergeConcepts(
  db: Database.Database,
  keepConceptId: ConceptId,
  mergeConceptId: ConceptId,
  conflictResolution: ConflictResolution = 'max_confidence',
): MergeConceptsResult {
  return writeTransaction(db, () => {
    // 前置校验
    const keep = getConceptOrThrow(db, keepConceptId);
    const merge = getConceptOrThrow(db, mergeConceptId);
    const timestamp = now();

    if (keepConceptId === mergeConceptId) {
      throw new IntegrityError({
        message: 'Cannot merge a concept with itself',
        context: { dbPath: db.name, keepConceptId, mergeConceptId },
      });
    }

    // 检查层级循环
    if (keep.parentId === mergeConceptId || merge.parentId === keepConceptId) {
      throw new IntegrityError({
        message: 'Cannot merge parent/child concepts',
        context: { dbPath: db.name, keepConceptId, mergeConceptId },
      });
    }

    // 步骤 1：检测映射冲突
    const conflictRows = db.prepare(`
      SELECT pcm_keep.paper_id,
             pcm_keep.relation AS keep_relation,
             pcm_keep.confidence AS keep_confidence,
             pcm_merge.relation AS merge_relation,
             pcm_merge.confidence AS merge_confidence
      FROM paper_concept_map pcm_keep
      JOIN paper_concept_map pcm_merge ON pcm_keep.paper_id = pcm_merge.paper_id
      WHERE pcm_keep.concept_id = ? AND pcm_merge.concept_id = ?
    `).all(keepConceptId, mergeConceptId) as Array<Record<string, unknown>>;
    const conflicts: ConflictEntry[] = conflictRows.map(r => fromRow<ConflictEntry>(r));

    // 步骤 2：迁移非冲突映射
    const migrateResult = db.prepare(`
      UPDATE paper_concept_map
      SET concept_id = ?, updated_at = ?
      WHERE concept_id = ?
        AND paper_id NOT IN (SELECT paper_id FROM paper_concept_map WHERE concept_id = ?)
    `).run(keepConceptId, timestamp, mergeConceptId, keepConceptId);

    // 步骤 3：处理冲突映射
    if (conflicts.length > 0) {
      if (conflictResolution === 'keep') {
        db.prepare(
          'DELETE FROM paper_concept_map WHERE concept_id = ? AND paper_id IN (SELECT paper_id FROM paper_concept_map WHERE concept_id = ?)',
        ).run(mergeConceptId, keepConceptId);
      } else if (conflictResolution === 'merge') {
        db.prepare(
          'DELETE FROM paper_concept_map WHERE concept_id = ? AND paper_id IN (SELECT paper_id FROM paper_concept_map WHERE concept_id = ?)',
        ).run(keepConceptId, keepConceptId);
        db.prepare(
          'UPDATE paper_concept_map SET concept_id = ?, updated_at = ? WHERE concept_id = ?',
        ).run(keepConceptId, timestamp, mergeConceptId);
      } else {
        // max_confidence: 更新 keep 版本取最高置信度，删除 merge 版本
        for (const c of conflicts) {
          const maxConf = Math.max(c.keepConfidence, c.mergeConfidence);
          db.prepare(
            'UPDATE paper_concept_map SET confidence = ?, updated_at = ? WHERE paper_id = ? AND concept_id = ?',
          ).run(maxConf, timestamp, c.paperId, keepConceptId);
        }
        db.prepare(
          `DELETE FROM paper_concept_map WHERE concept_id = ? AND paper_id IN (${conflicts.map(() => '?').join(',')})`,
        ).run(mergeConceptId, ...conflicts.map((c) => c.paperId));
      }
    }

    // 步骤 4：合并 search_keywords
    const mergedKeywords = [
      ...new Set([...keep.searchKeywords, ...merge.searchKeywords]),
    ];
    db.prepare(
      'UPDATE concepts SET search_keywords = ?, updated_at = ? WHERE id = ?',
    ).run(JSON.stringify(mergedKeywords), timestamp, keepConceptId);

    // 步骤 5：更新碎片笔记和结构化笔记的概念引用
    // 使用子查询 DISTINCT 去重，防止 memo 同时关联 keep 和 merge 时产生重复
    db.prepare(`
      UPDATE research_memos
      SET concept_ids = (
        SELECT json_group_array(val) FROM (
          SELECT DISTINCT CASE WHEN je.value = ? THEN ? ELSE je.value END AS val
          FROM json_each(concept_ids) je
        )
      ),
      updated_at = ?
      WHERE id IN (
        SELECT m.id FROM research_memos m, json_each(m.concept_ids) je
        WHERE je.value = ?
      )
    `).run(mergeConceptId, keepConceptId, timestamp, mergeConceptId);

    db.prepare(`
      UPDATE research_notes
      SET linked_concept_ids = (
        SELECT json_group_array(val) FROM (
          SELECT DISTINCT CASE WHEN je.value = ? THEN ? ELSE je.value END AS val
          FROM json_each(linked_concept_ids) je
        )
      ),
      updated_at = ?
      WHERE id IN (
        SELECT n.id FROM research_notes n, json_each(n.linked_concept_ids) je
        WHERE je.value = ?
      )
    `).run(mergeConceptId, keepConceptId, timestamp, mergeConceptId);

    // 步骤 6：更新 suggested_concepts 引用
    db.prepare(
      'UPDATE suggested_concepts SET closest_existing_concept_id = ? WHERE closest_existing_concept_id = ?',
    ).run(keepConceptId, mergeConceptId);

    // 步骤 7：更新标注引用
    db.prepare('UPDATE annotations SET concept_id = ? WHERE concept_id = ?').run(
      keepConceptId,
      mergeConceptId,
    );

    // 步骤 8：记录演化历史
    const keepCurrent = getConceptOrThrow(db, keepConceptId);
    const mergedEntry: ConceptHistoryEntry = {
      timestamp,
      changeType: 'merged_from',
      oldValueSummary: '',
      reason: null,
      isBreaking: false,
      metadata: {
        sourceConceptId: mergeConceptId,
        sourceConceptName: merge.nameEn,
      },
    };
    const newHistory = appendHistory(keepCurrent.history, mergedEntry);
    db.prepare('UPDATE concepts SET history = ?, updated_at = ? WHERE id = ?').run(
      newHistory,
      timestamp,
      keepConceptId,
    );

    // 步骤 9：废弃被合并概念
    const mergeEntry: ConceptHistoryEntry = {
      timestamp,
      changeType: 'deprecated',
      oldValueSummary: '',
      reason: `Merged into ${keepConceptId}`,
      isBreaking: false,
      metadata: null,
    };
    const mergeHistory = appendHistory(merge.history, mergeEntry);
    db.prepare(`
      UPDATE concepts
      SET deprecated = 1, deprecated_at = ?, deprecated_reason = ?,
          history = ?, updated_at = ?
      WHERE id = ?
    `).run(timestamp, `Merged into ${keepConceptId}`, mergeHistory, timestamp, mergeConceptId);

    // 步骤 10：收集受影响的 paper_id
    const affectedRows = db.prepare(`
      SELECT DISTINCT paper_id FROM paper_concept_map WHERE concept_id = ?
    `).all(keepConceptId) as { paper_id: string }[];
    const affectedPapers = [
      ...new Set([
        ...affectedRows.map((r) => r.paper_id as PaperId),
        ...conflicts.map((c) => c.paperId),
      ]),
    ];

    return {
      conflicts,
      migratedMappings: migrateResult.changes,
      affectedPapers,
    };
  });

}

// ─── §4.7 splitConcept ───

export interface SplitConceptResult {
  conceptA: ConceptId;
  conceptB: ConceptId;
  pendingMappings: ConceptMapping[];
}

export function splitConcept(
  db: Database.Database,
  originalConceptId: ConceptId,
  newConceptA: ConceptDefinition,
  newConceptB: ConceptDefinition,
): SplitConceptResult {
  return writeTransaction(db, () => {
    const original = getConceptOrThrow(db, originalConceptId);
    const timestamp = now();

    // 创建概念 A 和 B
    addConcept(db, { ...newConceptA, maturity: newConceptA.maturity ?? original.maturity });
    addConcept(db, { ...newConceptB, maturity: newConceptB.maturity ?? original.maturity });

    // 在 A/B 的 history 中记录 split_into
    for (const newId of [newConceptA.id, newConceptB.id]) {
      const c = getConceptOrThrow(db, newId);
      const entry: ConceptHistoryEntry = {
        timestamp,
        changeType: 'split_into',
        oldValueSummary: '',
        reason: null,
        isBreaking: false,
        metadata: { originalConceptId },
      };
      const h = appendHistory(c.history, entry);
      db.prepare('UPDATE concepts SET history = ?, updated_at = ? WHERE id = ?').run(
        h, timestamp, newId,
      );
    }

    // 在原概念 history 中记录
    const splitEntry: ConceptHistoryEntry = {
      timestamp,
      changeType: 'split_into',
      oldValueSummary: '',
      reason: null,
      isBreaking: false,
      metadata: { newConceptIds: [newConceptA.id, newConceptB.id] },
    };
    const origHistory = appendHistory(original.history, splitEntry);
    db.prepare('UPDATE concepts SET history = ?, updated_at = ? WHERE id = ?').run(
      origHistory, timestamp, originalConceptId,
    );

    // 查询原概念的全部映射，返回给调用方分配
    const mappingRows = db.prepare(
      'SELECT * FROM paper_concept_map WHERE concept_id = ?',
    ).all(originalConceptId) as Record<string, unknown>[];

    const pendingMappings = mappingRows.map((r) =>
      fromRow<ConceptMapping>(r),
    );

    return {
      conceptA: newConceptA.id,
      conceptB: newConceptB.id,
      pendingMappings,
    };
  });

}

// ─── §7.3 completeSplit ───

export interface SplitAssignment {
  paperId: PaperId;
  targetConceptId: ConceptId;
}

/**
 * §7.3: 完成拆分——用户分配映射后执行。
 *
 * 将原概念的映射按用户指定的 assignments 迁移到新概念 A 或 B，
 * 然后废弃原概念。
 *
 * 注意：当映射数 >20 时，Orchestrator 层应在调用 completeSplit 前
 * 使用 LLM 预生成 assignments，本 DAO 不负责 LLM 调用。
 */
export function completeSplit(
  db: Database.Database,
  originalConceptId: ConceptId,
  assignments: SplitAssignment[],
): GcConceptChangeResult {
  return writeTransaction(db, () => {
    const timestamp = now();

    for (const assignment of assignments) {
      db.prepare(
        'UPDATE paper_concept_map SET concept_id = ?, reviewed = 0, updated_at = ? ' +
        'WHERE concept_id = ? AND paper_id = ?',
      ).run(assignment.targetConceptId, timestamp, originalConceptId, assignment.paperId);
    }

    // 废弃原概念
    return deprecateConcept(db, originalConceptId, 'Split into new concepts');
  });
}

// ─── §4.6 gcConceptChange（五阶段级联） ───

/**
 * §6.3: gcConceptChange 的五阶段级联操作。
 *
 * 阶段 1: 映射标记（按补充性/替换性区分范围）
 * 阶段 2: 派生关系清理（concept_agree/conflict/extend 边）
 * 阶段 3: 综述标记 stale（返回标记供上层处理）
 * 阶段 4: 收集受影响论文
 * 阶段 5: 触发通知（返回标记供上层 pushManager 处理）
 */
export function gcConceptChange(
  db: Database.Database,
  conceptId: ConceptId,
  changeType: 'definition_refined' | 'deprecated' | 'deleted',
  isBreaking: boolean = false,
  lookbackDays: number = 30,
): GcConceptChangeResult {
  const timestamp = now();
  let affectedMappings = 0;
  let requiresRelationRecompute = false;
  let requiresSynthesizeRefresh = false;
  const affectedPaperIds: PaperId[] = [];

  const existingRows = db.prepare(
    'SELECT DISTINCT paper_id FROM paper_concept_map WHERE concept_id = ?',
  ).all(conceptId) as { paper_id: string }[];
  affectedPaperIds.push(...existingRows.map((r) => r.paper_id as PaperId));

  // ═══ 阶段 1：映射标记 ═══
  if (changeType === 'definition_refined' && !isBreaking) {
    // 补充性修改 — 仅标记近期映射
    const result = db.prepare(`
      UPDATE paper_concept_map
      SET reviewed = 0, updated_at = ?
      WHERE concept_id = ?
        AND created_at > datetime(?, '-${lookbackDays} days')
    `).run(timestamp, conceptId, timestamp);
    affectedMappings = result.changes;
  } else if (changeType === 'definition_refined' && isBreaking) {
    // 替换性修改 — 全部映射标记未审阅
    const result = db.prepare(`
      UPDATE paper_concept_map
      SET reviewed = 0, updated_at = ?
      WHERE concept_id = ?
    `).run(timestamp, conceptId);
    affectedMappings = result.changes;
    requiresSynthesizeRefresh = true;
    requiresRelationRecompute = true;
  } else if (changeType === 'deprecated') {
    // 概念废弃 — 标记映射未审阅
    const result = db.prepare(`
      UPDATE paper_concept_map
      SET reviewed = 0, updated_at = ?
      WHERE concept_id = ?
    `).run(timestamp, conceptId);
    affectedMappings = result.changes;
  } else if (changeType === 'deleted') {
    // 物理删除
    affectedMappings = db.prepare(
      'DELETE FROM paper_concept_map WHERE concept_id = ?',
    ).run(conceptId).changes;
    requiresRelationRecompute = true;
  }

  // ═══ 阶段 2：派生关系清理 ═══
  // 对所有 changeType 都清理概念相关的 paper_relations 边
  const relResult = db.prepare(
    "DELETE FROM paper_relations WHERE " +
    "edge_type IN ('concept_agree', 'concept_conflict', 'concept_extend') AND " +
    "json_extract(metadata, '$.conceptId') = ?",
  ).run(conceptId);
  const deletedRelations = relResult.changes;
  if (deletedRelations > 0) {
    requiresRelationRecompute = true;
  }

  // ═══ 阶段 3：综述标记 stale ═══
  // 由返回值告知上层（AppContext.staleDrafts）需要标记
  // 当 definition 变更或概念废弃时，相关综述需要重新生成
  if (changeType === 'definition_refined' || changeType === 'deprecated') {
    requiresSynthesizeRefresh = true;
  }

  // ═══ 阶段 4：收集受影响论文 ═══
  // deleted 分支的额外清理
  if (changeType === 'deleted') {
    // annotations.concept_id → NULL 由 ON DELETE SET NULL 处理
    db.prepare('DELETE FROM concepts WHERE id = ?').run(conceptId);
  }

  // ═══ 阶段 5：触发通知（标记） ═══
  // 返回结构化结果供上层 pushManager.enqueueDbChange 使用

  return {
    affectedMappings,
    requiresRelationRecompute,
    requiresSynthesizeRefresh,
    affectedPaperIds,
  };
}

// ─── 查询辅助 ───

export function getConcept(
  db: Database.Database,
  id: ConceptId,
): ConceptDefinition | null {
  const row = db.prepare('SELECT * FROM concepts WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return safeFromRow<ConceptDefinition>(row, ConceptRowSchema);
}

export function getAllConcepts(
  db: Database.Database,
  includeDeprecated: boolean = false,
): ConceptDefinition[] {
  const condition = includeDeprecated ? '' : 'WHERE deprecated = 0';
  const rows = db
    .prepare(`SELECT * FROM concepts ${condition} ORDER BY created_at`)
    .all() as Record<string, unknown>[];
  return rows.map((r) => fromRow<ConceptDefinition>(r));
}
