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

// ─── 零宽字符清理 ───

const ZERO_WIDTH_RE = /[\u200b\u200c\u200e\u200f\ufeff\u00ad\u2060]|\u200d/g;

/**
 * 标题归一化算法（与 PaperId 生成和去重共用）：
 * 1. 转小写（Unicode-aware）
 * 2. 去除零宽字符
 * 3. 去除全部标点和符号
 * 4. 按空白分词
 * 5. 去除 stop words
 * 6. 保持原始顺序拼接（不排序，避免词序不同的标题 false positive）
 *
 * 注意：此函数同时用于 PaperId 生成和去重匹配。
 * 修改算法会导致已有 PaperId 失效，需配合数据迁移。
 */
export function titleNormalize(title: string): string {
  const lower = title.toLowerCase();
  const noZeroWidth = lower.replace(ZERO_WIDTH_RE, '');
  const noPunctuation = noZeroWidth.replace(/[\p{P}\p{S}]/gu, '');
  const tokens = noPunctuation.split(/\s+/).filter((t) => t.length > 0);
  const filtered = tokens.filter((t) => !STOP_WORDS.has(t));
  // 保持原始词序拼接——"Deep Learning for NLP" ≠ "NLP for Deep Learning"
  return filtered.join('');
}

/**
 * 去重专用：返回标题归一化后的有效内容词数量。
 * 当内容词 < minTokens 时，调用方应跳过标题匹配（碰撞概率过高）。
 */
export function titleNormalizeTokenCount(title: string): number {
  const lower = title.toLowerCase();
  const noZeroWidth = lower.replace(ZERO_WIDTH_RE, '');
  const noPunctuation = noZeroWidth.replace(/[\p{P}\p{S}]/gu, '');
  const tokens = noPunctuation.split(/\s+/).filter((t) => t.length > 0);
  return tokens.filter((t) => !STOP_WORDS.has(t)).length;
}

/**
 * 生成 PaperId：SHA-1 前 12 字符。
 * 优先级：DOI > arXiv ID > normalizedTitle > URL/ISBN fallback
 */
export function generatePaperId(
  doi: string | null | undefined,
  arxivId: string | null | undefined,
  title: string | null | undefined,
  fallbackIdentifier?: string | null | undefined,
): PaperId {
  let input: string;

  if (doi) {
    input = normalizeDoi(doi);
  } else if (arxivId) {
    input = normalizeArxivId(arxivId);
  } else if (title) {
    input = titleNormalize(title);
  } else if (fallbackIdentifier) {
    input = fallbackIdentifier.trim().toLowerCase();
  } else {
    throw new Error('Cannot generate PaperId: no DOI, arXiv ID, title, or fallback identifier');
  }

  const hash = crypto.createHash('sha1').update(input).digest('hex');
  return asPaperId(hash.slice(0, 12));
}

// ─── DOI 标准化 ───

export function normalizeDoi(doi: string): string {
  // 清理零宽字符
  let d = doi.replace(ZERO_WIDTH_RE, '').trim();

  // 双重 URL 解码——某些爬虫产生 %252F 等双重编码
  try {
    let decoded = decodeURIComponent(d);
    // 尝试二次解码（检测双重编码：解码后仍含 % 编码序列）
    if (/%[0-9A-Fa-f]{2}/.test(decoded)) {
      try {
        decoded = decodeURIComponent(decoded);
      } catch {
        // 二次解码失败则保留一次解码结果
      }
    }
    d = decoded.toLowerCase();
  } catch {
    d = d.toLowerCase();
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
  let id = arxivId.replace(ZERO_WIDTH_RE, '').trim();

  // 去除常见前缀变体
  for (const prefix of [
    'https://arxiv.org/abs/',
    'http://arxiv.org/abs/',
    'https://arxiv.org/pdf/',
    'http://arxiv.org/pdf/',
    'arxiv:',
    'arXiv:',
  ]) {
    if (id.toLowerCase().startsWith(prefix.toLowerCase())) {
      id = id.slice(prefix.length);
      break;
    }
  }
  // 去 .pdf 后缀（来自 PDF URL）
  id = id.replace(/\.pdf$/i, '');
  // 去版本后缀
  return id.replace(/v\d+$/i, '');
}
