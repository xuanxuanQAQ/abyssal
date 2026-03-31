// ═══ 跨数据源去重 ═══
// §5: DOI / arXiv ID / 标题+年份 三级匹配

import type { PaperMetadata } from '../types/paper';
import { normalizeDoi, normalizeArxivId, titleNormalize, titleNormalizeTokenCount } from './paper-id';

// ─── 标题匹配的最低内容词数 ───
// 内容词过少时跳过 Level 3 匹配（碰撞概率过高）
const MIN_TITLE_TOKENS_FOR_DEDUP = 3;

// ─── 合并两篇论文 ───

function mergePapers(existing: PaperMetadata, incoming: PaperMetadata): PaperMetadata {
  // 字段优先级来源：优先使用书目信息更完整的源（crossref, openalex）
  const biblioPreferred =
    incoming.source === 'crossref' || incoming.source === 'openalex' ? incoming : existing;
  const biblioOther = biblioPreferred === existing ? incoming : existing;

  // Fix #9: 保留已有论文的 ID，避免 PaperId 变化导致 chunk 孤儿引用。
  // 已索引的 chunk 引用 existing.id，重新计算 ID 会导致引用断裂。
  const merged: PaperMetadata = {
    id: existing.id,
    title: existing.title.length >= incoming.title.length ? existing.title : incoming.title,
    authors: existing.authors.length >= incoming.authors.length ? existing.authors : incoming.authors,
    // Fix #5: 取 min 而非 max——预印本首次发布年份更有语义价值
    year: Math.min(existing.year, incoming.year),
    doi: existing.doi ?? incoming.doi,
    arxivId: existing.arxivId ?? incoming.arxivId,
    abstract:
      (existing.abstract?.length ?? 0) >= (incoming.abstract?.length ?? 0)
        ? existing.abstract
        : incoming.abstract,
    citationCount:
      Math.max(existing.citationCount ?? 0, incoming.citationCount ?? 0) || null,
    paperType: existing.paperType !== 'unknown' ? existing.paperType : incoming.paperType,
    // Fix #6: source 遵循 biblioPreferred 逻辑，不盲目保留首次来源
    source: biblioPreferred.source,
    venue: biblioPreferred.venue ?? biblioOther.venue,
    journal: biblioPreferred.journal ?? biblioOther.journal,
    volume: biblioPreferred.volume ?? biblioOther.volume,
    issue: biblioPreferred.issue ?? biblioOther.issue,
    pages: biblioPreferred.pages ?? biblioOther.pages,
    publisher: biblioPreferred.publisher ?? biblioOther.publisher,
    isbn: existing.isbn ?? incoming.isbn,
    edition: existing.edition ?? incoming.edition,
    editors: existing.editors ?? incoming.editors,
    bookTitle: existing.bookTitle ?? incoming.bookTitle,
    series: existing.series ?? incoming.series,
    issn: existing.issn ?? incoming.issn,
    pmid: existing.pmid ?? incoming.pmid,
    pmcid: existing.pmcid ?? incoming.pmcid,
    url: existing.url ?? incoming.url,
    bibtexKey: existing.bibtexKey ?? incoming.bibtexKey,
    biblioComplete: existing.biblioComplete || incoming.biblioComplete,
  };

  return merged;
}

// ─── 去重主函数 ───

export function deduplicatePapers(
  papers: PaperMetadata[],
): PaperMetadata[] {
  const result: PaperMetadata[] = [];

  // 三个索引 Map
  const doiMap = new Map<string, number>(); // normalizedDoi → index in result
  const arxivMap = new Map<string, number>(); // normalizedArxivId → index
  const titleYearMap = new Map<
    string,
    Array<{ index: number; year: number }>
  >();

  for (const paper of papers) {
    let matchIndex: number | undefined;

    // Level 1: DOI 精确匹配
    if (paper.doi) {
      const nd = normalizeDoi(paper.doi);
      matchIndex = doiMap.get(nd);
    }

    // Level 2: arXiv ID 精确匹配
    if (matchIndex === undefined && paper.arxivId) {
      const na = normalizeArxivId(paper.arxivId);
      matchIndex = arxivMap.get(na);
    }

    // Level 3: 标题归一化 + 年份模糊匹配
    // Fix #4: 仅当标题内容词 >= MIN_TITLE_TOKENS_FOR_DEDUP 时才启用，防止短标题碰撞
    if (matchIndex === undefined && paper.title) {
      const tokenCount = titleNormalizeTokenCount(paper.title);
      if (tokenCount >= MIN_TITLE_TOKENS_FOR_DEDUP) {
        const nt = titleNormalize(paper.title);
        if (nt.length > 0) {
          const candidates = titleYearMap.get(nt);
          if (candidates) {
            for (const c of candidates) {
              if (Math.abs(c.year - paper.year) <= 1) {
                matchIndex = c.index;
                break;
              }
            }
          }
        }
      }
    }

    if (matchIndex !== undefined) {
      // 合并到已有记录
      result[matchIndex] = mergePapers(result[matchIndex]!, paper);
      const merged = result[matchIndex]!;

      // 更新索引（合并后 DOI/arXivId 可能被填充）
      if (merged.doi) doiMap.set(normalizeDoi(merged.doi), matchIndex);
      if (merged.arxivId) arxivMap.set(normalizeArxivId(merged.arxivId), matchIndex);

      // Fix #1: 合并后标题可能变长（取较长者），需更新 titleYearMap 索引
      if (merged.title) {
        const mergedNt = titleNormalize(merged.title);
        if (mergedNt.length > 0) {
          const existingEntries = titleYearMap.get(mergedNt);
          if (existingEntries) {
            // 更新已有条目的 year
            const entry = existingEntries.find((e) => e.index === matchIndex);
            if (entry) {
              entry.year = merged.year;
            } else {
              existingEntries.push({ index: matchIndex, year: merged.year });
            }
          } else {
            titleYearMap.set(mergedNt, [{ index: matchIndex, year: merged.year }]);
          }
        }
      }
    } else {
      // 新记录
      const idx = result.length;
      result.push(paper);

      if (paper.doi) doiMap.set(normalizeDoi(paper.doi), idx);
      if (paper.arxivId)
        arxivMap.set(normalizeArxivId(paper.arxivId), idx);
      if (paper.title) {
        const tokenCount = titleNormalizeTokenCount(paper.title);
        if (tokenCount >= MIN_TITLE_TOKENS_FOR_DEDUP) {
          const nt = titleNormalize(paper.title);
          if (nt.length > 0) {
            const arr = titleYearMap.get(nt) ?? [];
            arr.push({ index: idx, year: paper.year });
            titleYearMap.set(nt, arr);
          }
        }
      }
    }
  }

  return result;
}
