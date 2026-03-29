// ═══ seeds.yaml 双轨解析与校验 ═══
// §三: DOI 路径 vs Title+Author+Year 路径

import * as fs from 'node:fs';
import type { SeedType } from '../types/config';
import { SEED_TYPES } from '../types/config';

// ─── 原始 YAML 结构 ───

export interface RawSeed {
  doi?: string;
  title?: string;
  author?: string;
  year?: number;
  type: string;
  note?: string;
}

interface SeedsYamlFile {
  seeds: RawSeed[];
}

// ─── 解析后种子 ───

export interface ResolvedSeed {
  doi?: string;
  title: string;
  authors: string;
  year: number;
  seedType: SeedType;
  note: string | null;
  resolvedVia: string;
  needsConfirmation?: boolean;
  similarity?: number;
}

// ─── 校验结果 ───

export interface SeedValidationResult {
  errors: string[];
  warnings: string[];
}

// ─── 加载 ───

/**
 * 从 seeds.yaml 文件加载原始种子列表。
 * 文件不存在时返回空数组。
 */
export function loadSeedsYaml(filePath: string): RawSeed[] {
  if (!fs.existsSync(filePath)) return [];

  const yaml = require('js-yaml');
  const rawText = fs.readFileSync(filePath, 'utf-8');
  const parsed = yaml.load(rawText) as SeedsYamlFile | null;

  if (!parsed || !Array.isArray(parsed.seeds)) return [];

  return parsed.seeds;
}

// ─── Level 7 校验 ───

/**
 * 对种子列表执行格式校验。
 *
 * - 双轨判定：必须有 doi 或 title+author+year
 * - DOI 格式校验
 * - type 枚举校验
 * - year 合理性校验
 */
export function validateSeeds(seeds: RawSeed[]): SeedValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const currentYear = new Date().getFullYear();
  const doiPattern = /^10\.\d{4,9}\/[^\s]+$/;

  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i]!;

    const hasDoi = seed.doi != null && seed.doi.trim() !== '';
    const hasTitle = seed.title != null && seed.title.trim() !== '';
    const hasAuthor = seed.author != null && seed.author.trim() !== '';
    const hasYear = seed.year != null;

    // 双轨判定
    if (!hasDoi && !(hasTitle && hasAuthor && hasYear)) {
      errors.push(`Seed [${i}]: must have either 'doi' or 'title' + 'author' + 'year'`);
    }

    // DOI 格式
    if (hasDoi && !doiPattern.test(seed.doi!)) {
      warnings.push(`Seed [${i}]: DOI "${seed.doi}" may be malformed`);
    }

    // type 枚举
    if (!SEED_TYPES.includes(seed.type as SeedType)) {
      errors.push(`Seed [${i}]: invalid type "${seed.type}" — must be ${SEED_TYPES.join(' / ')}`);
    }

    // year 合理性
    if (hasYear) {
      if (seed.year! < 1800 || seed.year! > currentYear + 1) {
        warnings.push(`Seed [${i}]: year ${seed.year} seems unusual`);
      }
    }
  }

  return { errors, warnings };
}

// ─── 标题相似度（Jaccard 系数） ───

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'to', 'for', 'and', 'or', 'is', 'are',
  'was', 'were', 'on', 'at', 'by', 'with', 'from', 'as', 'it', 'its',
]);

export function titleSimilarity(a: string, b: string): number {
  const tokenize = (s: string): Set<string> => {
    const words = s
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
    return new Set(words);
  };

  const setA = tokenize(a);
  const setB = tokenize(b);

  if (setA.size === 0 && setB.size === 0) return 1.0;
  if (setA.size === 0 || setB.size === 0) return 0.0;

  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ─── 种子解析（需要 SearchModule 注入） ───

/**
 * 解析种子论文——需要外部搜索模块。
 *
 * TODO — 依赖 SearchService（resolveByDoi / search），
 *         实际调用在 orchestrator 层完成。
 */
export interface SearchModule {
  getPaperByDoi(doi: string): Promise<Record<string, unknown> | null>;
  crossrefLookup(doi: string): Promise<Record<string, unknown> | null>;
  search(query: string, opts: { limit: number }): Promise<Array<Record<string, unknown>>>;
}

export async function resolveSeeds(
  seeds: RawSeed[],
  searchModule: SearchModule,
): Promise<ResolvedSeed[]> {
  const resolved: ResolvedSeed[] = [];

  for (const seed of seeds) {
    let result: ResolvedSeed | null = null;

    if (seed.doi && seed.doi.trim()) {
      result = await resolveByDoi(seed, searchModule);
    } else {
      result = await resolveByTitleAuthorYear(seed, searchModule);
    }

    if (result) {
      resolved.push(result);
    }
  }

  return resolved;
}

async function resolveByDoi(
  seed: RawSeed,
  searchModule: SearchModule,
): Promise<ResolvedSeed | null> {
  // 尝试 Semantic Scholar
  let paper = await searchModule.getPaperByDoi(seed.doi!);
  if (paper) {
    return {
      doi: seed.doi,
      title: (paper['title'] as string) ?? '',
      authors: (paper['authors'] as string) ?? '',
      year: (paper['year'] as number) ?? 0,
      seedType: seed.type as SeedType,
      note: seed.note ?? null,
      resolvedVia: 'doi_semantic_scholar',
    };
  }

  // 回退到 CrossRef
  paper = await searchModule.crossrefLookup(seed.doi!);
  if (paper) {
    return {
      doi: seed.doi,
      title: (paper['title'] as string) ?? '',
      authors: (paper['authors'] as string) ?? '',
      year: (paper['year'] as number) ?? 0,
      seedType: seed.type as SeedType,
      note: seed.note ?? null,
      resolvedVia: 'doi_crossref',
    };
  }

  return null;
}

async function resolveByTitleAuthorYear(
  seed: RawSeed,
  searchModule: SearchModule,
): Promise<ResolvedSeed | null> {
  const query = `${seed.title ?? ''} ${seed.author ?? ''} ${seed.year ?? ''}`;
  const results = await searchModule.search(query, { limit: 5 });

  if (results.length === 0) return null;

  let best: Record<string, unknown> | null = null;
  let bestSimilarity = 0;

  for (const result of results) {
    const sim = titleSimilarity(seed.title ?? '', (result['title'] as string) ?? '');
    if (sim > bestSimilarity) {
      bestSimilarity = sim;
      best = result;
    }
  }

  if (!best) return null;

  const resolved: ResolvedSeed = {
    title: (best['title'] as string) ?? '',
    authors: (best['authors'] as string) ?? '',
    year: (best['year'] as number) ?? 0,
    seedType: seed.type as SeedType,
    note: seed.note ?? null,
    resolvedVia: bestSimilarity >= 0.7 ? 'title_search' : 'title_search_low_confidence',
  };

  if (bestSimilarity < 0.7) {
    resolved.needsConfirmation = true;
    resolved.similarity = bestSimilarity;
  }

  return resolved;
}
