// ═══ 跨数据源去重 ═══
// §5: DOI / arXiv ID / 标题+年份 三级匹配

import type { PaperMetadata } from '../types/paper';
import { normalizeDoi, normalizeArxivId, titleNormalize, generatePaperId } from './paper-id';

// ─── 合并两篇论文 ───

function mergePapers(a: PaperMetadata, b: PaperMetadata): PaperMetadata {
  // 字段优先级来源：优先使用书目信息更完整的源（crossref, openalex）
  const biblioPreferred =
    b.source === 'crossref' || b.source === 'openalex' ? b : a;
  const biblioOther = biblioPreferred === a ? b : a;

  const merged: PaperMetadata = {
    id: generatePaperId(
      a.doi ?? b.doi,
      a.arxivId ?? b.arxivId,
      (a.title.length >= b.title.length ? a : b).title,
    ),
    title: a.title.length >= b.title.length ? a.title : b.title,
    authors: a.authors.length >= b.authors.length ? a.authors : b.authors,
    year: Math.max(a.year, b.year),
    doi: a.doi ?? b.doi,
    arxivId: a.arxivId ?? b.arxivId,
    abstract:
      (a.abstract?.length ?? 0) >= (b.abstract?.length ?? 0)
        ? a.abstract
        : b.abstract,
    citationCount:
      Math.max(a.citationCount ?? 0, b.citationCount ?? 0) || null,
    paperType: a.paperType !== 'unknown' ? a.paperType : b.paperType,
    source: a.source, // 保留首次发现的来源
    venue: biblioPreferred.venue ?? biblioOther.venue,
    journal: biblioPreferred.journal ?? biblioOther.journal,
    volume: biblioPreferred.volume ?? biblioOther.volume,
    issue: biblioPreferred.issue ?? biblioOther.issue,
    pages: biblioPreferred.pages ?? biblioOther.pages,
    publisher: biblioPreferred.publisher ?? biblioOther.publisher,
    isbn: a.isbn ?? b.isbn,
    edition: a.edition ?? b.edition,
    editors: a.editors ?? b.editors,
    bookTitle: a.bookTitle ?? b.bookTitle,
    series: a.series ?? b.series,
    issn: a.issn ?? b.issn,
    pmid: a.pmid ?? b.pmid,
    pmcid: a.pmcid ?? b.pmcid,
    url: a.url ?? b.url,
    bibtexKey: a.bibtexKey ?? b.bibtexKey,
    biblioComplete: a.biblioComplete || b.biblioComplete,
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
    if (matchIndex === undefined && paper.title) {
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

    if (matchIndex !== undefined) {
      // 合并到已有记录
      result[matchIndex] = mergePapers(result[matchIndex]!, paper);
      // 更新索引（合并后 DOI/arXivId 可能填充）
      const merged = result[matchIndex]!;
      if (merged.doi) doiMap.set(normalizeDoi(merged.doi), matchIndex);
      if (merged.arxivId)
        arxivMap.set(normalizeArxivId(merged.arxivId), matchIndex);
    } else {
      // 新记录
      const idx = result.length;
      result.push(paper);

      if (paper.doi) doiMap.set(normalizeDoi(paper.doi), idx);
      if (paper.arxivId)
        arxivMap.set(normalizeArxivId(paper.arxivId), idx);
      if (paper.title) {
        const nt = titleNormalize(paper.title);
        if (nt.length > 0) {
          const arr = titleYearMap.get(nt) ?? [];
          arr.push({ index: idx, year: paper.year });
          titleYearMap.set(nt, arr);
        }
      }
    }
  }

  return result;
}
