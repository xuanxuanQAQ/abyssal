// ═══ CrossRef 书目补全 ═══
// §3: GET /works/{doi} + JATS 清理 + 仅空字段补全

import type { PaperMetadata, PaperType } from '../types/paper';
import type { EnrichResult } from '../types/bibliography';
import type { HttpClient } from '../infra/http-client';
import type { RateLimiter } from '../infra/rate-limiter';
import { PaperNotFoundError } from '../types/errors';

// ─── §3.1.2 CrossRef type → PaperType ───

const CROSSREF_TYPE_MAP: Record<string, PaperType> = {
  'journal-article': 'journal',
  'proceedings-article': 'conference',
  'book': 'book',
  'book-chapter': 'chapter',
  'posted-content': 'preprint',
  'peer-review': 'review',
};

// ─── §3.1.3 JATS XML 清理 ───
// Fix #1: 仅去除 JATS 命名空间标签，保护数学符号 < > 不被误删

function cleanJats(text: string): string {
  // 仅匹配 JATS 命名空间标签 <jats:...> 和通用 HTML 标签 <p> <b> <i> <sub> <sup> 等
  return text
    .replace(/<\/?jats:[^>]+>/g, '')  // <jats:p>, </jats:p> 等
    .replace(/<\/?(?:p|b|i|em|strong|sub|sup|span|div|br)\b[^>]*>/gi, '') // 通用 HTML
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── 辅助：仅当目标为空时覆盖 ───

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim().length === 0);
}

// ─── §3.1 enrichBibliography ───

export async function enrichBibliography(
  paper: PaperMetadata,
  http: HttpClient,
  limiter: RateLimiter,
): Promise<EnrichResult> {
  if (!paper.doi) {
    return { enriched: false, enrichedFields: [], metadata: paper };
  }

  await limiter.acquire();

  // Fix #18: DOI 按 `/` 分段编码，保留路径结构（CrossRef 要求 prefix/suffix 格式）
  const doiParts = paper.doi.split('/');
  const encodedDoi = doiParts.map(part => encodeURIComponent(part)).join('/');
  const url = `https://api.crossref.org/works/${encodedDoi}`;
  let data: { message: Record<string, unknown> };

  try {
    data = await http.requestJson<typeof data>(url);
  } catch (err) {
    // Fix #19: 使用 instanceof 和结构化字段检测 404，而非字符串匹配
    if (err instanceof PaperNotFoundError) {
      return { enriched: false, enrichedFields: [], metadata: paper };
    }
    const status = (err as { status?: number; statusCode?: number }).status
      ?? (err as { status?: number; statusCode?: number }).statusCode;
    if (status === 404) {
      return { enriched: false, enrichedFields: [], metadata: paper };
    }
    throw err;
  }

  const msg = data.message;
  const enrichedFields: string[] = [];
  const updated = { ...paper };

  function fill<K extends keyof PaperMetadata>(
    field: K,
    value: PaperMetadata[K] | undefined | null,
  ): void {
    if (value != null && isEmpty(updated[field])) {
      (updated as Record<string, unknown>)[field] = value;
      enrichedFields.push(field);
    }
  }

  // §3.1.2: 字段补全映射
  // Fix: CrossRef container-title/ISSN/ISBN 均可能返回 string[] — 安全提取首元素
  const containerTitle = msg['container-title'];
  fill('journal',
    Array.isArray(containerTitle)
      ? (containerTitle[0] as string | undefined) ?? null
      : (typeof containerTitle === 'string' ? containerTitle : null),
  );
  fill('volume', typeof msg['volume'] === 'string' ? msg['volume'] : null);
  fill('issue', typeof msg['issue'] === 'string' ? msg['issue'] : null);
  fill('pages', typeof msg['page'] === 'string' ? msg['page'] : null);
  fill('publisher', typeof msg['publisher'] === 'string' ? msg['publisher'] : null);

  const issn = msg['ISSN'];
  fill('issn', Array.isArray(issn) ? (issn[0] as string | undefined) ?? null : null);

  const isbn = msg['ISBN'];
  fill('isbn', Array.isArray(isbn) ? (isbn[0] as string | undefined) ?? null : null);

  fill('edition', msg['edition-number'] as string);

  // editors
  const editors = msg['editor'] as Array<{ family?: string; given?: string }> | undefined;
  if (editors && editors.length > 0 && isEmpty(updated.editors)) {
    updated.editors = editors.map((e) =>
      e.given ? `${e.family}, ${e.given}` : (e.family ?? ''),
    ).filter(Boolean);
    enrichedFields.push('editors');
  }

  // type
  const crType = msg['type'] as string | undefined;
  if (crType && updated.paperType === 'unknown') {
    const mapped = CROSSREF_TYPE_MAP[crType];
    if (mapped) {
      updated.paperType = mapped;
      enrichedFields.push('paperType');
    }
  }

  // abstract (JATS 清理)
  const rawAbstract = msg['abstract'] as string | undefined;
  if (rawAbstract && isEmpty(updated.abstract)) {
    updated.abstract = cleanJats(rawAbstract);
    enrichedFields.push('abstract');
  }

  // authors (仅当为空时)
  const crAuthors = msg['author'] as Array<{ family?: string; given?: string }> | undefined;
  if (crAuthors && crAuthors.length > 0 && updated.authors.length === 0) {
    updated.authors = crAuthors.map((a) =>
      a.given ? `${a.family}, ${a.given}` : (a.family ?? ''),
    ).filter(Boolean);
    enrichedFields.push('authors');
  }

  // year
  const published = msg['published'] as { 'date-parts'?: number[][] } | undefined;
  if (published?.['date-parts']?.[0]?.[0] && !updated.year) {
    updated.year = published['date-parts'][0]![0]!;
    enrichedFields.push('year');
  }

  // title
  const crTitle = msg['title'];
  if (Array.isArray(crTitle) && (crTitle as string[])[0] && isEmpty(updated.title)) {
    updated.title = (crTitle as string[])[0]!;
    enrichedFields.push('title');
  }

  return {
    enriched: enrichedFields.length > 0,
    enrichedFields,
    metadata: updated,
  };
}
