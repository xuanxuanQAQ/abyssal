// ═══ 论文 CRUD ═══
// §3: addPaper / updatePaper / getPaper / queryPapers / deletePaper

import type Database from 'better-sqlite3';
import type { PaperId } from '../../types/common';
import type { PaperMetadata, PaperStatus, PaperSource, FulltextStatus, AnalysisStatus, Relevance, PaperType } from '../../types/paper';
import type { PaginatedResult, SortSpec } from '../../types/common';
import { fromRow, toRow, now, camelToSnake } from '../row-mapper';
import { safeFromRow, PaperRowSchema } from '../schemas';
import { writeTransaction } from '../transaction-utils';
import { hasVecTable } from './chunks';
import {
  validatePaperType, validatePaperSource, validateFulltextStatus,
  validateAnalysisStatus, validateRelevance,
} from '../validators';

// ─── 列名映射（paper 表的全部列与 TypeScript 字段的对应关系）───

const PAPER_COLUMNS = [
  'id', 'title', 'authors', 'year', 'doi', 'arxiv_id', 'abstract',
  'citation_count', 'paper_type', 'source', 'venue', 'journal', 'volume',
  'issue', 'pages', 'publisher', 'isbn', 'edition', 'editors', 'book_title',
  'series', 'issn', 'pmid', 'pmcid', 'url', 'bibtex_key', 'biblio_complete',
  'fulltext_status', 'fulltext_path', 'text_path', 'analysis_status',
  'analysis_path', 'relevance', 'decision_note', 'failure_reason',
  'discovered_at', 'updated_at',
] as const;

// ─── §3.1 addPaper (UPSERT) ───

export function addPaper(
  db: Database.Database,
  paper: PaperMetadata,
  status?: Partial<PaperStatus>,
): PaperId {
  // §1.2: 应用层枚举校验
  validatePaperType(paper.paperType);
  validatePaperSource(paper.source);
  if (status?.fulltextStatus) validateFulltextStatus(status.fulltextStatus);
  if (status?.analysisStatus) validateAnalysisStatus(status.analysisStatus);
  if (status?.relevance) validateRelevance(status.relevance);

  const timestamp = now();

  // §1.4: DOI/arXiv ID 交叉去重预检——同一篇论文可能以不同 canonical 被发现
  let effectiveId = paper.id;
  if (paper.doi || paper.arxivId) {
    const existing = db
      .prepare(
        'SELECT id FROM papers WHERE (doi = ? AND doi IS NOT NULL) OR (arxiv_id = ? AND arxiv_id IS NOT NULL)',
      )
      .get(paper.doi, paper.arxivId) as { id: string } | undefined;
    if (existing && existing.id !== paper.id) {
      effectiveId = existing.id as PaperId;
    }
  }

  const row = toRow({
    id: effectiveId,
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    doi: paper.doi,
    arxivId: paper.arxivId,
    abstract: paper.abstract,
    citationCount: paper.citationCount,
    paperType: paper.paperType,
    source: paper.source,
    venue: paper.venue,
    journal: paper.journal,
    volume: paper.volume,
    issue: paper.issue,
    pages: paper.pages,
    publisher: paper.publisher,
    isbn: paper.isbn,
    edition: paper.edition,
    editors: paper.editors,
    bookTitle: paper.bookTitle,
    series: paper.series,
    issn: paper.issn,
    pmid: paper.pmid,
    pmcid: paper.pmcid,
    url: paper.url,
    bibtexKey: paper.bibtexKey,
    biblioComplete: paper.biblioComplete,
    fulltextStatus: status?.fulltextStatus ?? 'not_attempted',
    fulltextPath: status?.fulltextPath ?? null,
    textPath: status?.textPath ?? null,
    analysisStatus: status?.analysisStatus ?? 'not_started',
    analysisPath: status?.analysisPath ?? null,
    relevance: status?.relevance ?? 'medium',
    decisionNote: status?.decisionNote ?? null,
    failureReason: status?.failureReason ?? null,
    discoveredAt: timestamp,
    updatedAt: timestamp,
  } as Record<string, unknown>);

  // §1.4 UPSERT 合并策略：
  //  title        → 更长覆盖
  //  authors      → 更完整覆盖（json_array_length 比较）
  //  editors      → 同 authors
  //  source       → 保留旧值（不可变）
  //  paper_type   → 仅从 'unknown' 覆盖
  //  biblio_complete → 单调递增
  //  citation_count → 取较大值
  //  discovered_at → 不更新
  //  其余可空字段 → 非空覆盖（COALESCE）
  db.prepare(`
    INSERT INTO papers (${PAPER_COLUMNS.join(', ')})
    VALUES (${PAPER_COLUMNS.map(() => '?').join(', ')})
    ON CONFLICT(id) DO UPDATE SET
      title           = CASE
                          WHEN length(excluded.title) > length(papers.title)
                          THEN excluded.title ELSE papers.title
                        END,
      authors         = CASE
                          WHEN json_array_length(excluded.authors) > json_array_length(papers.authors)
                          THEN excluded.authors ELSE papers.authors
                        END,
      year            = COALESCE(excluded.year, papers.year),
      doi             = COALESCE(excluded.doi, papers.doi),
      arxiv_id        = COALESCE(excluded.arxiv_id, papers.arxiv_id),
      abstract        = COALESCE(excluded.abstract, papers.abstract),
      citation_count  = COALESCE(
                          MAX(excluded.citation_count, papers.citation_count),
                          excluded.citation_count, papers.citation_count
                        ),
      paper_type      = CASE
                          WHEN papers.paper_type = 'unknown'
                          THEN excluded.paper_type ELSE papers.paper_type
                        END,
      venue           = COALESCE(excluded.venue, papers.venue),
      journal         = COALESCE(excluded.journal, papers.journal),
      volume          = COALESCE(excluded.volume, papers.volume),
      issue           = COALESCE(excluded.issue, papers.issue),
      pages           = COALESCE(excluded.pages, papers.pages),
      publisher       = COALESCE(excluded.publisher, papers.publisher),
      isbn            = COALESCE(excluded.isbn, papers.isbn),
      edition         = COALESCE(excluded.edition, papers.edition),
      editors         = CASE
                          WHEN excluded.editors IS NOT NULL
                            AND (papers.editors IS NULL
                              OR json_array_length(excluded.editors) > json_array_length(papers.editors))
                          THEN excluded.editors ELSE papers.editors
                        END,
      book_title      = COALESCE(excluded.book_title, papers.book_title),
      series          = COALESCE(excluded.series, papers.series),
      issn            = COALESCE(excluded.issn, papers.issn),
      pmid            = COALESCE(excluded.pmid, papers.pmid),
      pmcid           = COALESCE(excluded.pmcid, papers.pmcid),
      url             = COALESCE(excluded.url, papers.url),
      bibtex_key      = COALESCE(excluded.bibtex_key, papers.bibtex_key),
      biblio_complete = MAX(excluded.biblio_complete, papers.biblio_complete),
      fulltext_status = COALESCE(excluded.fulltext_status, papers.fulltext_status),
      fulltext_path   = COALESCE(excluded.fulltext_path, papers.fulltext_path),
      text_path       = COALESCE(excluded.text_path, papers.text_path),
      analysis_status = COALESCE(excluded.analysis_status, papers.analysis_status),
      analysis_path   = COALESCE(excluded.analysis_path, papers.analysis_path),
      relevance       = COALESCE(excluded.relevance, papers.relevance),
      decision_note   = COALESCE(excluded.decision_note, papers.decision_note),
      failure_reason  = COALESCE(excluded.failure_reason, papers.failure_reason),
      updated_at      = excluded.updated_at
  `).run(...PAPER_COLUMNS.map((col) => row[col] ?? null));

  return effectiveId;
}

// ─── §3.2 updatePaper ───

export function updatePaper(
  db: Database.Database,
  id: PaperId,
  updates: Partial<PaperMetadata & PaperStatus>,
): number {
  const entries = Object.entries(updates).filter(
    ([_, v]) => v !== undefined,
  );
  if (entries.length === 0) return 0;

  const setClauses: string[] = [];
  const params: unknown[] = [];

  for (const [key, value] of entries) {
    const col = camelToSnake(key);
    const row = toRow({ [key]: value } as Record<string, unknown>);
    setClauses.push(`${col} = ?`);
    params.push(row[col] ?? null);
  }

  setClauses.push('updated_at = ?');
  params.push(now());
  params.push(id);

  const result = db
    .prepare(`UPDATE papers SET ${setClauses.join(', ')} WHERE id = ?`)
    .run(...params);

  return result.changes;
}

// ─── §3.3 getPaper ───

export function getPaper(
  db: Database.Database,
  id: PaperId,
): (PaperMetadata & PaperStatus) | null {
  const row = db.prepare('SELECT * FROM papers WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return safeFromRow<PaperMetadata & PaperStatus>(row, PaperRowSchema);
}

// ─── §3.4 queryPapers ───

export interface QueryPapersFilter {
  ids?: PaperId[];
  fulltextStatus?: FulltextStatus[];
  analysisStatus?: AnalysisStatus[];
  relevance?: Relevance[];
  paperType?: PaperType[];
  source?: PaperSource[];
  yearRange?: { min?: number; max?: number };
  searchText?: string;
  sort?: SortSpec;
  limit?: number;
  offset?: number;
}

export function queryPapers(
  db: Database.Database,
  filter: QueryPapersFilter,
): PaginatedResult<PaperMetadata & PaperStatus> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.ids && filter.ids.length > 0) {
    conditions.push(`id IN (${filter.ids.map(() => '?').join(', ')})`);
    params.push(...filter.ids);
  }

  if (filter.fulltextStatus && filter.fulltextStatus.length > 0) {
    conditions.push(
      `fulltext_status IN (${filter.fulltextStatus.map(() => '?').join(', ')})`,
    );
    params.push(...filter.fulltextStatus);
  }

  if (filter.analysisStatus && filter.analysisStatus.length > 0) {
    conditions.push(
      `analysis_status IN (${filter.analysisStatus.map(() => '?').join(', ')})`,
    );
    params.push(...filter.analysisStatus);
  }

  if (filter.relevance && filter.relevance.length > 0) {
    conditions.push(
      `relevance IN (${filter.relevance.map(() => '?').join(', ')})`,
    );
    params.push(...filter.relevance);
  }

  if (filter.paperType && filter.paperType.length > 0) {
    conditions.push(
      `paper_type IN (${filter.paperType.map(() => '?').join(', ')})`,
    );
    params.push(...filter.paperType);
  }

  if (filter.source && filter.source.length > 0) {
    conditions.push(
      `source IN (${filter.source.map(() => '?').join(', ')})`,
    );
    params.push(...filter.source);
  }

  if (filter.yearRange) {
    if (filter.yearRange.min != null) {
      conditions.push('year >= ?');
      params.push(filter.yearRange.min);
    }
    if (filter.yearRange.max != null) {
      conditions.push('year <= ?');
      params.push(filter.yearRange.max);
    }
  }

  if (filter.searchText) {
    const like = `%${filter.searchText}%`;
    conditions.push('(title LIKE ? OR abstract LIKE ? OR authors LIKE ?)');
    params.push(like, like, like);
  }

  const whereClause =
    conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const sort = filter.sort ?? { field: 'updatedAt', order: 'desc' };
  const sortCol = camelToSnake(sort.field);
  const sortOrder = sort.order === 'asc' ? 'ASC' : 'DESC';

  const limit = filter.limit ?? 50;
  const offset = filter.offset ?? 0;

  // 在同一事务中执行数据查询和计数查询，确保一致性快照
  const queryFn = db.transaction(() => {
    const countRow = db
      .prepare(`SELECT COUNT(*) AS cnt FROM papers ${whereClause}`)
      .get(...params) as { cnt: number };

    const rows = db
      .prepare(
        `SELECT * FROM papers ${whereClause} ORDER BY ${sortCol} ${sortOrder} LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as Record<string, unknown>[];

    return {
      totalCount: countRow.cnt,
      rows,
    };
  });

  const { totalCount, rows } = queryFn();

  return {
    items: rows.map((r) => fromRow<PaperMetadata & PaperStatus>(r)),
    totalCount,
    offset,
    limit,
  };
}

// ─── §3.5 deletePaper ───

export function deletePaper(
  db: Database.Database,
  id: PaperId,
  cascade: boolean = true,
): number {
  if (!cascade) {
    return db.prepare('DELETE FROM papers WHERE id = ?').run(id).changes;
  }

  return writeTransaction(db, () => {
    const timestamp = now();

    // 1. 删除 paper_relations
    db.prepare(
      'DELETE FROM paper_relations WHERE source_paper_id = ? OR target_paper_id = ?',
    ).run(id, id);

    // 2. 删除 paper_concept_map
    db.prepare('DELETE FROM paper_concept_map WHERE paper_id = ?').run(id);

    // 3. 删除 citations
    db.prepare(
      'DELETE FROM citations WHERE citing_id = ? OR cited_id = ?',
    ).run(id, id);

    // 4. 删除 chunks + chunks_vec（先 vec 再 chunks——防御性编程）
    const chunkRows = db
      .prepare('SELECT rowid FROM chunks WHERE paper_id = ?')
      .all(id) as { rowid: number }[];

    if (chunkRows.length > 0) {
      const rowids = chunkRows.map((r) => r.rowid);
      const placeholders = rowids.map(() => '?').join(', ');
      // chunks_vec 可能不存在（skipVecExtension / sqlite-vec 未加载）
      if (hasVecTable(db)) {
        db.prepare(
          `DELETE FROM chunks_vec WHERE rowid IN (${placeholders})`,
        ).run(...rowids);
      }
      db.prepare('DELETE FROM chunks WHERE paper_id = ?').run(id);
    }

    // 5. 删除 annotations
    db.prepare('DELETE FROM annotations WHERE paper_id = ?').run(id);

    // 6. 更新碎片笔记中的论文引用（via 映射表 + JSON 列双写）
    const affectedMemos = db.prepare(
      'SELECT memo_id FROM memo_paper_map WHERE paper_id = ?',
    ).all(id) as { memo_id: number }[];

    db.prepare('DELETE FROM memo_paper_map WHERE paper_id = ?').run(id);

    if (affectedMemos.length > 0) {
      const updateMemoJson = db.prepare(`
        UPDATE research_memos
        SET paper_ids = (
          SELECT COALESCE(json_group_array(mp.paper_id), '[]')
          FROM memo_paper_map mp WHERE mp.memo_id = research_memos.id
        ),
        updated_at = ?
        WHERE id = ?
      `);
      for (const { memo_id } of affectedMemos) {
        updateMemoJson.run(timestamp, memo_id);
      }
    }

    // 7. §5.10 步骤 5: 清理结构化笔记中的论文引用
    db.prepare(`
      UPDATE research_notes
      SET linked_paper_ids = (
        SELECT COALESCE(json_group_array(je.value), '[]')
        FROM json_each(linked_paper_ids) je
        WHERE je.value != ?
      ),
      updated_at = ?
      WHERE id IN (
        SELECT n.id FROM research_notes n, json_each(n.linked_paper_ids) je
        WHERE je.value = ?
      )
    `).run(id, timestamp, id);

    // 8. 删除论文（CASCADE 自动清理 citations/seeds 等）
    const result = db.prepare('DELETE FROM papers WHERE id = ?').run(id);
    return result.changes;
  });
}
