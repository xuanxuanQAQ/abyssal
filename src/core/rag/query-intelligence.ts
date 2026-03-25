// ═══ 概念词典驱动的 Query Intelligence ═══
// §6: 概念识别 → 关键词注入 → memo 线索整合 → query 变体生成

import type { ConceptId } from '../types/common';
import type { ConceptDefinition } from '../types/concept';
import type { DatabaseService } from '../database';

// ─── Stop words（与 search/paper-id.ts 一致） ───

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to',
  'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are',
  'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'this', 'that', 'these', 'those',
]);

// ─── §6.2 概念识别 ───

function matchConcepts(
  queryText: string,
  concepts: ConceptDefinition[],
): ConceptDefinition[] {
  const queryLower = queryText.toLowerCase();
  const matched: ConceptDefinition[] = [];

  for (const concept of concepts) {
    // 精确匹配优先
    if (
      queryLower.includes(concept.nameEn.toLowerCase()) ||
      queryLower.includes(concept.nameZh.toLowerCase())
    ) {
      matched.push(concept);
      continue;
    }

    // search_keywords 扩展匹配
    for (const kw of concept.searchKeywords) {
      if (queryLower.includes(kw.toLowerCase())) {
        matched.push(concept);
        break;
      }
    }
  }

  return matched;
}

// ─── §6.3 关键词注入（改进：自然命题模板 + FTS 分离） ───

/**
 * 为向量检索生成自然语言合成命题（Synthetic Proposition），
 * 避免关键词堆砌导致的 OOD 向量偏移。
 * 离散关键词保留在 ftsKeywords 中供 BM25 词法检索使用。
 */
function buildNaturalVariant(
  queryText: string,
  concept: ConceptDefinition,
): { vectorVariant: string; ftsKeywords: string[] } {
  const queryWords = new Set(queryText.toLowerCase().split(/\s+/));
  const newKeywords = concept.searchKeywords.filter(
    (kw) => !queryWords.has(kw.toLowerCase()),
  );

  const maxKeywords = concept.maturity === 'tentative' ? 8 : 5;
  const selected = newKeywords.slice(0, maxKeywords);

  // 向量检索变体：融合为自然命题
  let vectorVariant: string;
  if (selected.length > 0) {
    vectorVariant = `${queryText}. The concept of ${concept.nameEn} involves ${selected.slice(0, 3).join(', ')}.`;
  } else {
    vectorVariant = queryText;
  }

  return { vectorVariant, ftsKeywords: selected };
}

// ─── §6.4 memo 线索提取 ───

function extractMemoKeywords(
  memoTexts: string[],
  existingKeywords: Set<string>,
): string[] {
  const freq = new Map<string, number>();

  for (const text of memoTexts) {
    const words = text.split(/[\s,.;:!?()[\]{}"']+/).filter((w) => w.length >= 3);
    for (const word of words) {
      if (STOP_WORDS.has(word.toLowerCase())) continue;
      if (existingKeywords.has(word.toLowerCase())) continue;

      // 保留首字母大写词（专有名词）和含连字符的复合词
      const isProperNoun = /^[A-Z]/.test(word);
      const isCompound = word.includes('-');
      if (isProperNoun || isCompound) {
        const key = word.toLowerCase();
        freq.set(key, (freq.get(key) ?? 0) + 1);
      }
    }
  }

  // 按频率排序，取前 3 个
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([word]) => word);
}

// ─── §6.1 expandQuery 主函数 ───

export interface QueryExpansionResult {
  /** 向量检索用的自然语言 query 变体 */
  variants: string[];
  /** BM25 词法检索用的离散关键词（供 FTS5 MATCH） */
  ftsKeywords: string[];
  matchedConcepts: ConceptDefinition[];
  expandParams: {
    expandFactorMultiplier: number;
    topKMultiplier: number;
  };
}

export function expandQuery(
  queryText: string,
  conceptIds: ConceptId[],
  dbService: DatabaseService,
): QueryExpansionResult {
  // 获取全部活跃概念
  const allConcepts = dbService.getAllConcepts(false);

  // §6.2: 概念识别
  const matchedConcepts = matchConcepts(queryText, allConcepts);

  // 也包括显式传入的 conceptIds
  for (const cid of conceptIds) {
    if (!matchedConcepts.some((c) => c.id === cid)) {
      const concept = dbService.getConcept(cid);
      if (concept && !concept.deprecated) matchedConcepts.push(concept);
    }
  }

  if (matchedConcepts.length === 0) {
    return {
      variants: [queryText],
      ftsKeywords: [],
      matchedConcepts: [],
      expandParams: { expandFactorMultiplier: 1, topKMultiplier: 1 },
    };
  }

  const variants: string[] = [queryText]; // variant 1: 原始 query
  const allFtsKeywords: string[] = [];

  // §6.3: 自然命题变体（向量检索）+ 离散关键词（FTS5）
  const allKeywords = new Set<string>();
  for (const concept of matchedConcepts) {
    const { vectorVariant, ftsKeywords } = buildNaturalVariant(queryText, concept);
    if (vectorVariant !== queryText && !variants.includes(vectorVariant)) {
      variants.push(vectorVariant);
    }
    allFtsKeywords.push(...ftsKeywords);
    for (const kw of concept.searchKeywords) {
      allKeywords.add(kw.toLowerCase());
    }
  }

  // §6.4: memo 线索整合
  const memoTexts: string[] = [];
  for (const concept of matchedConcepts) {
    const memos = dbService.getMemosByEntity('concept', concept.id);
    for (const memo of memos.slice(0, 5)) {
      memoTexts.push(memo.text);
    }
  }

  if (memoTexts.length > 0) {
    const memoKeywords = extractMemoKeywords(memoTexts, allKeywords);
    if (memoKeywords.length > 0) {
      // memo 关键词也融合为自然命题
      const memoVariant = `${queryText}. Related research insights: ${memoKeywords.join(', ')}.`;
      if (!variants.includes(memoVariant)) {
        variants.push(memoVariant);
      }
      allFtsKeywords.push(...memoKeywords);
    }
  }

  // §6.6: 成熟度感知参数
  const hasTentative = matchedConcepts.some((c) => c.maturity === 'tentative');

  // FTS 关键词去重
  const uniqueFtsKeywords = [...new Set(allFtsKeywords)];

  return {
    variants: variants.slice(0, 3),
    ftsKeywords: uniqueFtsKeywords,
    matchedConcepts,
    expandParams: {
      expandFactorMultiplier: hasTentative ? 2.0 : 1.0,
      topKMultiplier: hasTentative ? 1.5 : 1.0,
    },
  };
}

// ─── §6.5 层级感知扩展 ───

export function expandQueryHierarchical(
  queryText: string,
  conceptId: ConceptId,
  dbService: DatabaseService,
  maxLevels: number = 2,
): string[] {
  const variants: string[] = [];
  let currentId: ConceptId | null = conceptId;
  let level = 0;

  while (currentId && level < maxLevels) {
    const concept = dbService.getConcept(currentId);
    if (!concept || concept.deprecated) break;

    if (concept.parentId) {
      const parent = dbService.getConcept(concept.parentId);
      if (parent && !parent.deprecated) {
        const { vectorVariant } = buildNaturalVariant(queryText, parent);
        if (!variants.includes(vectorVariant)) {
          variants.push(vectorVariant);
        }
      }
      currentId = concept.parentId;
    } else {
      break;
    }
    level++;
  }

  return variants;
}
