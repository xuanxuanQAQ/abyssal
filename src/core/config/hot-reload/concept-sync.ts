// ═══ concepts.yaml ↔ 数据库双向同步 ═══
// §六: 概念框架热重载

import * as fs from 'node:fs';
import type Database from 'better-sqlite3';
import type { ConceptId } from '../../types/common';
import type { ConceptDefinition } from '../../types/concept';
import type { Logger } from '../../infra/logger';
import { loadConceptsYaml } from '../concepts-loader';
import * as conceptsDao from '../../database/dao/concepts';

// ─── 同步报告 ───

export interface SyncReport {
  added: ConceptId[];
  modified: Array<{ id: ConceptId; changes: string[] }>;
  deprecated: ConceptId[];
  unchanged: ConceptId[];
  renamed: Array<{ oldId: ConceptId; newId: ConceptId }>;
}

// ─── YAML → DB 同步 ───

/**
 * §6.2: 将 concepts.yaml 的内容合并到数据库。
 *
 * - 新增：YAML 中有但 DB 中没有
 * - 修改：两边都有但字段不同
 * - 删除：DB 中有但 YAML 中没有（执行 deprecate）
 */
export function syncConceptsFromYaml(
  yamlConcepts: ConceptDefinition[],
  db: Database.Database,
  logger?: Logger,
): SyncReport {
  const yamlMap = new Map(yamlConcepts.map((c) => [c.id, c]));
  const dbConcepts = conceptsDao.getAllConcepts(db, false);
  const dbMap = new Map(dbConcepts.map((c) => [c.id, c]));

  const report: SyncReport = {
    added: [],
    modified: [],
    deprecated: [],
    unchanged: [],
    renamed: [],
  };

  // Fix #1: Handle `replaces` field — safe rename via merge instead of Create+Deprecate.
  // ConceptDefinition with a `replaces` field (e.g., replaces: "design_afforance")
  // triggers mapping migration from old ID to new ID before normal sync proceeds.
  const replacesMap = new Map<ConceptId, ConceptId>(); // newId → oldId
  for (const [id, yamlConcept] of yamlMap) {
    const replacesId = (yamlConcept as unknown as Record<string, unknown>)['replaces'] as string | undefined;
    if (replacesId && dbMap.has(replacesId as ConceptId) && !dbMap.has(id)) {
      replacesMap.set(id as ConceptId, replacesId as ConceptId);
    }
  }

  // Execute renames first (before add/deprecate logic)
  for (const [newId, oldId] of replacesMap) {
    const yamlConcept = yamlMap.get(newId)!;
    try {
      // Use mergeConcepts to safely transfer all mappings, relations, annotations
      conceptsDao.addConcept(db, yamlConcept);
      conceptsDao.mergeConcepts(db, newId as ConceptId, oldId as ConceptId);
      report.renamed.push({ oldId, newId });
      logger?.info('Concept renamed via merge', { oldId, newId });
    } catch (err) {
      // Fallback: add as new if merge fails
      logger?.warn('Concept rename merge failed, adding as new', {
        oldId, newId, error: (err as Error).message,
      });
    }
  }

  // Rebuild maps after renames (deprecated old IDs are now in DB)
  const postRenameDbConcepts = conceptsDao.getAllConcepts(db, false);
  const postRenameDbMap = new Map(postRenameDbConcepts.map((c) => [c.id, c]));

  // 新增：YAML 中有但 DB 中没有 (skip already-renamed)
  for (const [id, yamlConcept] of yamlMap) {
    if (replacesMap.has(id)) continue; // already handled above
    if (!postRenameDbMap.has(id)) {
      conceptsDao.addConcept(db, yamlConcept);
      report.added.push(id);
      logger?.info('Concept added from YAML', { id });
    }
  }

  // 修改：两边都有但字段不同
  for (const [id, yamlConcept] of yamlMap) {
    const dbConcept = dbMap.get(id);
    if (!dbConcept) continue;

    const changes = detectFieldChanges(yamlConcept, dbConcept);
    if (changes.length === 0) {
      report.unchanged.push(id);
      continue;
    }

    // 构建更新字段
    const fields: conceptsDao.UpdateConceptFields = {};
    if (changes.includes('nameZh')) fields.nameZh = yamlConcept.nameZh;
    if (changes.includes('nameEn')) fields.nameEn = yamlConcept.nameEn;
    if (changes.includes('layer')) fields.layer = yamlConcept.layer;
    if (changes.includes('definition')) fields.definition = yamlConcept.definition;
    if (changes.includes('searchKeywords')) fields.searchKeywords = yamlConcept.searchKeywords;
    if (changes.includes('maturity')) fields.maturity = yamlConcept.maturity;
    if (changes.includes('parentId')) fields.parentId = yamlConcept.parentId;

    // definition 变更时判定是否为破坏性
    const isBreaking = changes.includes('definition')
      ? isBreakingDefinitionChange(dbConcept.definition, yamlConcept.definition)
      : false;

    conceptsDao.updateConcept(db, id, fields, isBreaking);
    report.modified.push({ id, changes });
    logger?.info('Concept updated from YAML', { id, changes, isBreaking });
  }

  // 删除：DB 中有但 YAML 中没有 (skip IDs consumed by rename)
  const renamedOldIds = new Set(replacesMap.values());
  for (const [id, dbConcept] of dbMap) {
    if (renamedOldIds.has(id)) continue; // already merged into new ID
    if (!yamlMap.has(id) && !dbConcept.deprecated) {
      conceptsDao.deprecateConcept(db, id, 'Removed from concepts.yaml');
      report.deprecated.push(id);
      logger?.info('Concept deprecated (removed from YAML)', { id });
    }
  }

  return report;
}

// ─── YAML → DB 完整同步（从文件） ───

export function syncFromFile(
  yamlPath: string,
  db: Database.Database,
  logger?: Logger,
): SyncReport {
  const concepts = loadConceptsYaml(yamlPath);
  return syncConceptsFromYaml(concepts, db, logger);
}

// ─── DB → YAML 导出 ───

/**
 * §6.3: 将数据库中的概念导出为 concepts.yaml。
 */
export function exportConceptsToYaml(
  db: Database.Database,
  outputPath: string,
): void {
  const concepts = conceptsDao.getAllConcepts(db, false);
  const yaml = require('js-yaml');

  const yamlData = {
    concepts: concepts.map((c) => ({
      id: c.id,
      name_zh: c.nameZh,
      name_en: c.nameEn,
      layer: c.layer,
      definition: c.definition,
      keywords: c.searchKeywords,
      maturity: c.maturity,
      parent_id: c.parentId ?? null,
    })),
  };

  const yamlText = yaml.dump(yamlData, {
    lineWidth: 100,
    forceQuotes: false,
    sortKeys: false,
  });

  // 原子写入——先写临时文件再 rename
  const tmpPath = outputPath + '.tmp';
  fs.writeFileSync(tmpPath, yamlText, 'utf-8');
  fs.renameSync(tmpPath, outputPath);
}

// ─── 字段差异检测 ───

function detectFieldChanges(
  yamlConcept: ConceptDefinition,
  dbConcept: ConceptDefinition,
): string[] {
  const changes: string[] = [];

  if (yamlConcept.nameZh !== dbConcept.nameZh) changes.push('nameZh');
  if (yamlConcept.nameEn !== dbConcept.nameEn) changes.push('nameEn');
  if (yamlConcept.layer !== dbConcept.layer) changes.push('layer');
  if (yamlConcept.definition !== dbConcept.definition) changes.push('definition');
  if (yamlConcept.maturity !== dbConcept.maturity) changes.push('maturity');
  if (yamlConcept.parentId !== dbConcept.parentId) changes.push('parentId');

  // 比较 searchKeywords（数组）
  const yamlKw = JSON.stringify([...yamlConcept.searchKeywords].sort());
  const dbKw = JSON.stringify([...dbConcept.searchKeywords].sort());
  if (yamlKw !== dbKw) changes.push('searchKeywords');

  return changes;
}

// ═══ §6.1 Jaccard 相似度计算 ═══

/**
 * §6.1: 增强分词器——支持 CJK 字符逐字拆分。
 *
 * 英文部分：空格分词 + 过滤短词（≤2 字符）
 * 中文部分：逐字拆分（每个 CJK 字符作为独立 token）
 */
export function enhancedTokenize(text: string): Set<string> {
  const tokens = new Set<string>();

  // 英文部分：移除 CJK 字符后按空格分词
  const englishParts = text
    .replace(/[\u4e00-\u9fff]/g, ' ')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/);
  for (const part of englishParts) {
    if (part.length > 2) {
      tokens.add(part);
    }
  }

  // 中文部分：逐字拆分
  const cjkChars = text.match(/[\u4e00-\u9fff]/g);
  if (cjkChars) {
    for (const char of cjkChars) {
      tokens.add(char);
    }
  }

  return tokens;
}

/**
 * §6.1: 计算两段文本的 Jaccard 相似度。
 */
export function computeJaccard(oldText: string, newText: string): number {
  const oldTokens = enhancedTokenize(oldText);
  const newTokens = enhancedTokenize(newText);

  if (oldTokens.size === 0 && newTokens.size === 0) return 1.0;

  let intersection = 0;
  for (const token of oldTokens) {
    if (newTokens.has(token)) intersection++;
  }

  const union = oldTokens.size + newTokens.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ═══ §6.2 补充性/替换性判定 ═══

export interface BreakingDetectionResult {
  isBreaking: boolean;
  reason: string;
  jaccard: number;
}

/**
 * §6.2: 判定 definition 变更是否为破坏性。
 *
 * 三级规则：
 * 1. Jaccard < threshold → 替换性
 * 2. 旧定义是新定义的子集 → 补充性
 * 3. Jaccard ≥ threshold 但非子集 → 保守判定为补充性
 */
export function detectBreaking(
  oldDefinition: string,
  newDefinition: string,
  jaccardThreshold: number = 0.5,
): BreakingDetectionResult {
  const oldTokens = enhancedTokenize(oldDefinition);
  const newTokens = enhancedTokenize(newDefinition);
  const jaccard = computeJaccard(oldDefinition, newDefinition);

  // 规则 1: Jaccard 低于阈值 → 替换性
  if (jaccard < jaccardThreshold) {
    return {
      isBreaking: true,
      reason: `Jaccard similarity ${jaccard.toFixed(3)} < threshold ${jaccardThreshold}`,
      jaccard,
    };
  }

  // 规则 2: 旧定义是新定义的子集 → 补充性
  let isSubset = true;
  for (const token of oldTokens) {
    if (!newTokens.has(token)) {
      isSubset = false;
      break;
    }
  }

  if (isSubset) {
    return {
      isBreaking: false,
      reason: `Old definition is subset of new (Jaccard=${jaccard.toFixed(3)}). Additive change.`,
      jaccard,
    };
  }

  // 规则 3 (fixed): Jaccard ≥ threshold but NOT subset.
  // If old tokens were REMOVED, the definition was narrowed or broadened — treat as Breaking.
  // Rationale: removing a qualifier like "基于视觉刺激的" broadens the concept's scope,
  // invalidating mappings that relied on the removed constraint.
  const removedTokens = [...oldTokens].filter((t) => !newTokens.has(t));
  if (removedTokens.length > 0) {
    return {
      isBreaking: true,
      reason: `Jaccard ${jaccard.toFixed(3)} >= threshold but ${removedTokens.length} old tokens removed (scope change). Treating as breaking.`,
      jaccard,
    };
  }

  // Truly additive: all old tokens preserved, new tokens added
  return {
    isBreaking: false,
    reason: `Jaccard ${jaccard.toFixed(3)} >= threshold, all old tokens preserved. Additive change.`,
    jaccard,
  };
}

/**
 * 简化入口——兼容原有 boolean 签名。
 */
function isBreakingDefinitionChange(
  oldDef: string,
  newDef: string,
  jaccardThreshold: number = 0.5,
): boolean {
  return detectBreaking(oldDef, newDef, jaccardThreshold).isBreaking;
}
