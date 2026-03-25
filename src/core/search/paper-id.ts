// ═══ PaperId 生成 + 标题归一化 ═══
// §5.4: SHA-1(DOI || arXiv || normalizedTitle) 前 12 字符

import * as crypto from 'node:crypto';
import type { PaperId } from '../types/common';
import { asPaperId } from '../types/common';

// ─── Stop words ───

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to',
  'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are',
  'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should',
]);

/**
 * 标题归一化算法（与 PaperId 生成和去重共用）：
 * 1. 转小写（Unicode-aware）
 * 2. 去除全部标点和符号
 * 3. 按空白分词
 * 4. 去除 stop words
 * 5. 排序
 * 6. 无分隔符拼接
 */
export function titleNormalize(title: string): string {
  const lower = title.toLowerCase();
  const noPunctuation = lower.replace(/[\p{P}\p{S}]/gu, '');
  const tokens = noPunctuation.split(/\s+/).filter((t) => t.length > 0);
  const filtered = tokens.filter((t) => !STOP_WORDS.has(t));
  filtered.sort();
  return filtered.join('');
}

/**
 * 生成 PaperId：SHA-1 前 12 字符。
 * 优先级：DOI > arXiv ID > normalizedTitle
 */
export function generatePaperId(
  doi: string | null | undefined,
  arxivId: string | null | undefined,
  title: string | null | undefined,
): PaperId {
  let input: string;

  if (doi) {
    input = normalizeDoi(doi);
  } else if (arxivId) {
    input = normalizeArxivId(arxivId);
  } else if (title) {
    input = titleNormalize(title);
  } else {
    throw new Error('Cannot generate PaperId: no DOI, arXiv ID, or title');
  }

  const hash = crypto.createHash('sha1').update(input).digest('hex');
  return asPaperId(hash.slice(0, 12));
}

// ─── DOI 标准化 ───

export function normalizeDoi(doi: string): string {
  // URL 解码——跨数据源的 DOI 可能处于不同的 encode 状态（%2F vs /）
  let d: string;
  try {
    d = decodeURIComponent(doi.trim()).toLowerCase();
  } catch {
    d = doi.trim().toLowerCase();
  }
  for (const prefix of [
    'https://doi.org/',
    'http://doi.org/',
    'https://dx.doi.org/',
    'http://dx.doi.org/',
    'doi:',
  ]) {
    if (d.startsWith(prefix)) {
      d = d.slice(prefix.length);
      break;
    }
  }
  // 去尾部句号和空白
  return d.replace(/[\s.]+$/, '');
}

// ─── arXiv ID 标准化 ───

export function normalizeArxivId(arxivId: string): string {
  let id = arxivId.trim();
  for (const prefix of [
    'https://arxiv.org/abs/',
    'http://arxiv.org/abs/',
  ]) {
    if (id.startsWith(prefix)) {
      id = id.slice(prefix.length);
      break;
    }
  }
  // 去版本后缀
  return id.replace(/v\d+$/, '');
}
