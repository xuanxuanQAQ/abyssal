// ═══ concepts.yaml 解析与校验 ═══
// §二 Level 6: 概念框架完整性检查

import * as fs from 'node:fs';
import type { ConceptId } from '../types/common';
import { isConceptId } from '../types/common';
import type { ConceptDefinition } from '../types/concept';
import { CONCEPT_MATURITIES, type ConceptMaturity } from '../types/concept';

// ─── YAML 原始结构 ───

interface RawConceptYaml {
  id: string;
  name_zh: string;
  name_en: string;
  layer: string;
  definition: string;
  keywords: string[];
  maturity?: string;
  parent_id?: string | null;
  related_ids?: string[];
}

interface ConceptsYamlFile {
  concepts: RawConceptYaml[];
}

// ─── 校验结果 ───

export interface ConceptValidationResult {
  errors: string[];
  warnings: string[];
}

// ─── 加载 ───

/**
 * 从 concepts.yaml 文件加载并解析为 ConceptDefinition 数组。
 * 文件不存在时返回空数组。
 */
export function loadConceptsYaml(filePath: string): ConceptDefinition[] {
  if (!fs.existsSync(filePath)) return [];

  const yaml = require('js-yaml');
  const rawText = fs.readFileSync(filePath, 'utf-8');
  const parsed = yaml.load(rawText) as ConceptsYamlFile | null;

  if (!parsed || !Array.isArray(parsed.concepts)) return [];

  return parsed.concepts.map(rawToConceptDefinition);
}

function rawToConceptDefinition(raw: RawConceptYaml): ConceptDefinition {
  return {
    id: raw.id as ConceptId,
    nameZh: raw.name_zh ?? '',
    nameEn: raw.name_en ?? '',
    layer: raw.layer ?? '',
    definition: raw.definition ?? '',
    searchKeywords: raw.keywords ?? [],
    maturity: (CONCEPT_MATURITIES.includes(raw.maturity as ConceptMaturity)
      ? raw.maturity
      : 'working') as ConceptMaturity,
    parentId: (raw.parent_id ?? null) as ConceptId | null,
    history: [],
    deprecated: false,
    deprecatedAt: null,
    deprecatedReason: null,
    createdAt: new Date().toISOString(),
  };
}

// ─── Level 6 校验 ───

/**
 * 对概念列表执行完整的框架完整性校验。
 *
 * 6a: 全局唯一性
 * 6b: ID 格式
 * 6c: 必填字段
 * 6d: maturity 枚举
 * 6e: parent_id 悬空引用
 * 6f: parent_id 无环检测（DFS）
 * 6g: related_ids 悬空引用
 * 6h: definition 长度
 * 6i: 零概念检查
 */
export function validateConceptFramework(concepts: ConceptDefinition[]): ConceptValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 6i: 零概念——不再是错误
  if (concepts.length === 0) {
    warnings.push('No concepts defined — system will operate in zero_concepts mode');
    return { errors, warnings };
  }

  const ids = concepts.map((c) => c.id);
  const idSet = new Set<string>();

  // 6a: 全局唯一性
  for (const id of ids) {
    if (idSet.has(id)) {
      errors.push(`Duplicate concept ID: "${id}"`);
    }
    idSet.add(id);
  }

  for (const concept of concepts) {
    // 6b: ID 格式
    if (!isConceptId(concept.id)) {
      errors.push(`Invalid concept ID: "${concept.id}" — must match /^[a-z][a-z0-9_]{0,63}$/`);
    }

    // 6c: 必填字段
    if (!concept.nameZh) errors.push(`Concept ${concept.id}: name_zh is required`);
    if (!concept.nameEn) errors.push(`Concept ${concept.id}: name_en is required`);
    if (!concept.layer) errors.push(`Concept ${concept.id}: layer is required`);
    if (!concept.definition) errors.push(`Concept ${concept.id}: definition is required`);
    if (!concept.searchKeywords || concept.searchKeywords.length === 0) {
      errors.push(`Concept ${concept.id}: keywords must have at least 1 entry`);
    }

    // 6d: maturity 枚举
    const m = concept.maturity ?? 'working';
    if (!CONCEPT_MATURITIES.includes(m)) {
      errors.push(`Concept ${concept.id}: invalid maturity "${m}"`);
    }

    // 6e: parent_id 悬空引用
    if (concept.parentId !== null && concept.parentId !== undefined && !idSet.has(concept.parentId)) {
      errors.push(`Concept ${concept.id}: parent_id "${concept.parentId}" does not exist`);
    }

    // 6h: definition 长度
    if (concept.definition && concept.definition.length > 500) {
      warnings.push(
        `Concept ${concept.id}: definition exceeds 500 characters (${concept.definition.length})`,
      );
    }
  }

  // 6f: parent_id 无环检测
  if (hasCycle(concepts)) {
    errors.push('Concept hierarchy contains a cycle');
  }

  // 6g: related_ids 悬空引用
  // ConceptDefinition 不直接持有 related_ids，但 YAML 中可能有
  // 通过 raw 数据检查——此处跳过（由 YAML 层面检查）

  return { errors, warnings };
}

// ─── DFS 无环检测 ───

/**
 * 检测 parent_id 构成的 DAG 中是否存在环。
 */
export function hasCycle(concepts: ConceptDefinition[]): boolean {
  // 构建 parent → children 邻接表
  const children = new Map<string, string[]>();
  for (const concept of concepts) {
    if (concept.parentId) {
      const existing = children.get(concept.parentId) ?? [];
      existing.push(concept.id);
      children.set(concept.parentId, existing);
    }
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(nodeId: string): boolean {
    if (inStack.has(nodeId)) return true; // 发现环
    if (visited.has(nodeId)) return false; // 已访问

    visited.add(nodeId);
    inStack.add(nodeId);

    for (const child of children.get(nodeId) ?? []) {
      if (dfs(child)) return true;
    }

    inStack.delete(nodeId);
    return false;
  }

  // 从每个根节点（parent_id == null）执行 DFS
  const roots = concepts.filter((c) => c.parentId === null || c.parentId === undefined);
  for (const root of roots) {
    if (dfs(root.id)) return true;
  }

  // 检查孤立环（全部节点都有 parent 但形成环）
  if (visited.size < concepts.length) return true;

  return false;
}

// ─── related_ids 悬空引用校验（raw YAML 层面） ───

export function validateRelatedIds(
  rawConcepts: Array<{ id: string; related_ids?: string[] }>,
): string[] {
  const warnings: string[] = [];
  const idSet = new Set(rawConcepts.map((c) => c.id));

  for (const concept of rawConcepts) {
    for (const relId of concept.related_ids ?? []) {
      if (!idSet.has(relId)) {
        warnings.push(`Concept ${concept.id}: related_id "${relId}" does not exist`);
      }
    }
  }

  return warnings;
}
