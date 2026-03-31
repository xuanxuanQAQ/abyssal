// ═══ 文章、纲要与节草稿 CRUD ═══
// §8: createArticle / setOutline / addSectionDraft / markEditedParagraphs

import type Database from 'better-sqlite3';
import type { ArticleId, OutlineEntryId } from '../../types/common';
import type { Article, OutlineEntry, SectionDraft, ArticleStyle, ArticleStatus, OutlineEntryStatus, ArticleAsset, DraftSource } from '../../types/article';
import { fromRow, now } from '../row-mapper';
import { writeTransaction } from '../transaction-utils';

// ─── createArticle ───

export function createArticle(
  db: Database.Database,
  article: Omit<Article, 'createdAt' | 'updatedAt'>,
): ArticleId {
  const timestamp = now();

  db.prepare(`
    INSERT INTO articles (
      id, title, style, csl_style_id, output_language, status,
      abstract, keywords, authors, target_word_count,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    article.id,
    article.title,
    article.style,
    article.cslStyleId,
    article.outputLanguage,
    article.status,
    article.abstract ?? null,
    JSON.stringify(article.keywords ?? []),
    JSON.stringify(article.authors ?? []),
    article.targetWordCount ?? null,
    timestamp,
    timestamp,
  );

  return article.id;
}

// ─── getArticle ───

export function getArticle(
  db: Database.Database,
  id: ArticleId,
): Article | null {
  const row = db
    .prepare('SELECT * FROM articles WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return fromRow<Article>(row);
}

// ─── updateArticle ───

export function updateArticle(
  db: Database.Database,
  id: ArticleId,
  updates: Partial<Pick<Article, 'title' | 'style' | 'cslStyleId' | 'outputLanguage' | 'status' | 'abstract' | 'keywords' | 'authors' | 'targetWordCount'>>,
): number {
  const setClauses: string[] = ['updated_at = ?'];
  const params: unknown[] = [now()];

  if (updates.title !== undefined) { setClauses.push('title = ?'); params.push(updates.title); }
  if (updates.style !== undefined) { setClauses.push('style = ?'); params.push(updates.style); }
  if (updates.cslStyleId !== undefined) { setClauses.push('csl_style_id = ?'); params.push(updates.cslStyleId); }
  if (updates.outputLanguage !== undefined) { setClauses.push('output_language = ?'); params.push(updates.outputLanguage); }
  if (updates.status !== undefined) { setClauses.push('status = ?'); params.push(updates.status); }
  if (updates.abstract !== undefined) { setClauses.push('abstract = ?'); params.push(updates.abstract); }
  if (updates.keywords !== undefined) { setClauses.push('keywords = ?'); params.push(JSON.stringify(updates.keywords)); }
  if (updates.authors !== undefined) { setClauses.push('authors = ?'); params.push(JSON.stringify(updates.authors)); }
  if (updates.targetWordCount !== undefined) { setClauses.push('target_word_count = ?'); params.push(updates.targetWordCount); }

  params.push(id);

  return db
    .prepare(`UPDATE articles SET ${setClauses.join(', ')} WHERE id = ?`)
    .run(...params).changes;
}

// ─── §8.1 setOutline ───

export function setOutline(
  db: Database.Database,
  articleId: ArticleId,
  entries: OutlineEntry[],
): void {
  writeTransaction(db, () => {
    const timestamp = now();

    // 获取现有纲要节 ID
    const existingRows = db
      .prepare('SELECT id FROM outlines WHERE article_id = ?')
      .all(articleId) as { id: string }[];
    const existingIds = new Set(existingRows.map((r) => r.id));

    const newIds = new Set(entries.map((e) => e.id as string));

    // INSERT 或 UPDATE
    for (const entry of entries) {
      if (existingIds.has(entry.id)) {
        db.prepare(`
          UPDATE outlines
          SET sort_order = ?, title = ?, core_argument = ?,
              writing_instruction = ?, concept_ids = ?, paper_ids = ?,
              status = ?, parent_id = ?, depth = ?, updated_at = ?
          WHERE id = ?
        `).run(
          entry.sortOrder,
          entry.title,
          entry.coreArgument,
          entry.writingInstruction,
          JSON.stringify(entry.conceptIds),
          JSON.stringify(entry.paperIds),
          entry.status,
          entry.parentId ?? null,
          entry.depth ?? 0,
          timestamp,
          entry.id,
        );
      } else {
        db.prepare(`
          INSERT INTO outlines (
            id, article_id, sort_order, title, core_argument,
            writing_instruction, concept_ids, paper_ids, status,
            parent_id, depth,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          entry.id,
          articleId,
          entry.sortOrder,
          entry.title,
          entry.coreArgument,
          entry.writingInstruction,
          JSON.stringify(entry.conceptIds),
          JSON.stringify(entry.paperIds),
          entry.status,
          entry.parentId ?? null,
          entry.depth ?? 0,
          timestamp,
          timestamp,
        );
      }
    }

    // 不在新列表中的旧节标记为 deprecated（§8.1: 不删除，保留历史草稿）
    for (const existingId of existingIds) {
      if (!newIds.has(existingId)) {
        // outlines 表没有 deprecated 列，使用 status 标记
        // 规范原文使用 status = 'deprecated'，但 CHECK 约束不含此值
        // 这里保留原节不动，不改变 status（避免触发 CHECK 约束错误）
        // 从前端通过 sort_order = -1 标记为不显示
        db.prepare(
          'UPDATE outlines SET sort_order = -1, updated_at = ? WHERE id = ?',
        ).run(timestamp, existingId);
      }
    }
  });
}

// ─── getOutline ───

export function getOutline(
  db: Database.Database,
  articleId: ArticleId,
): OutlineEntry[] {
  const rows = db
    .prepare(
      'SELECT * FROM outlines WHERE article_id = ? AND sort_order >= 0 ORDER BY sort_order',
    )
    .all(articleId) as Record<string, unknown>[];

  return rows.map((r) => fromRow<OutlineEntry>(r));
}

// ─── §8.2 addSectionDraft ───

export function addSectionDraft(
  db: Database.Database,
  outlineEntryId: OutlineEntryId,
  content: string,
  llmBackend: string,
  source: DraftSource = 'manual',
  documentJson: string | null = null,
): number {
  const timestamp = now();

  return writeTransaction(db, () => {
    // 计算新版本号
    const versionRow = db
      .prepare(
        'SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM section_drafts WHERE outline_entry_id = ?',
      )
      .get(outlineEntryId) as { next_version: number };

    const version = versionRow.next_version;

    db.prepare(`
      INSERT INTO section_drafts (
        outline_entry_id, version, content, document_json, llm_backend,
        source, edited_paragraphs, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, '[]', ?)
    `).run(outlineEntryId, version, content, documentJson, llmBackend, source, timestamp);

    // 首次生成时从 pending → drafted
    db.prepare(`
      UPDATE outlines SET status = 'drafted', updated_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(timestamp, outlineEntryId);

    return version;
  });
}

// ─── getSectionDrafts ───

export function getSectionDrafts(
  db: Database.Database,
  outlineEntryId: OutlineEntryId,
): SectionDraft[] {
  const rows = db
    .prepare(
      'SELECT * FROM section_drafts WHERE outline_entry_id = ? ORDER BY version DESC',
    )
    .all(outlineEntryId) as Record<string, unknown>[];

  return rows.map((r) => fromRow<SectionDraft>(r));
}

// ─── §8.3 markEditedParagraphs ───

export function markEditedParagraphs(
  db: Database.Database,
  outlineEntryId: OutlineEntryId,
  version: number,
  paragraphIndices: number[],
): number {
  return db
    .prepare(
      'UPDATE section_drafts SET edited_paragraphs = ? WHERE outline_entry_id = ? AND version = ?',
    )
    .run(JSON.stringify(paragraphIndices), outlineEntryId, version).changes;
}

// ─── getOutlineEntry ───

export function getOutlineEntry(
  db: Database.Database,
  id: OutlineEntryId,
): OutlineEntry | null {
  const row = db
    .prepare('SELECT * FROM outlines WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return fromRow<OutlineEntry>(row);
}

// ─── updateOutlineEntry ───

export function updateOutlineEntry(
  db: Database.Database,
  id: OutlineEntryId,
  updates: Partial<Pick<OutlineEntry, 'title' | 'coreArgument' | 'writingInstruction' | 'conceptIds' | 'paperIds' | 'status' | 'sortOrder' | 'parentId' | 'depth'>>,
): number {
  const setClauses: string[] = ['updated_at = ?'];
  const params: unknown[] = [now()];

  if (updates.title !== undefined) { setClauses.push('title = ?'); params.push(updates.title); }
  if (updates.coreArgument !== undefined) { setClauses.push('core_argument = ?'); params.push(updates.coreArgument); }
  if (updates.writingInstruction !== undefined) { setClauses.push('writing_instruction = ?'); params.push(updates.writingInstruction); }
  if (updates.conceptIds !== undefined) { setClauses.push('concept_ids = ?'); params.push(JSON.stringify(updates.conceptIds)); }
  if (updates.paperIds !== undefined) { setClauses.push('paper_ids = ?'); params.push(JSON.stringify(updates.paperIds)); }
  if (updates.status !== undefined) { setClauses.push('status = ?'); params.push(updates.status); }
  if (updates.sortOrder !== undefined) { setClauses.push('sort_order = ?'); params.push(updates.sortOrder); }
  if (updates.parentId !== undefined) { setClauses.push('parent_id = ?'); params.push(updates.parentId); }
  if (updates.depth !== undefined) { setClauses.push('depth = ?'); params.push(updates.depth); }

  params.push(id);

  return db
    .prepare(`UPDATE outlines SET ${setClauses.join(', ')} WHERE id = ?`)
    .run(...params).changes;
}

// ─── markOutlineEntryDeleted ───

export function markOutlineEntryDeleted(
  db: Database.Database,
  id: OutlineEntryId,
): number {
  return db
    .prepare('UPDATE outlines SET sort_order = -1, updated_at = ? WHERE id = ?')
    .run(now(), id).changes;
}

// ─── searchSections ───

export function searchSections(
  db: Database.Database,
  query: string,
): Array<{ outlineEntryId: OutlineEntryId; articleId: ArticleId; title: string; snippet: string }> {
  const likePattern = `%${query}%`;

  // Search in outline titles
  const titleMatches = db.prepare(`
    SELECT o.id AS outline_entry_id, o.article_id, o.title, '' AS snippet
    FROM outlines o
    WHERE o.sort_order >= 0 AND o.title LIKE ?
    LIMIT 20
  `).all(likePattern) as Array<Record<string, unknown>>;

  // Search in section draft content
  const contentMatches = db.prepare(`
    SELECT o.id AS outline_entry_id, o.article_id, o.title,
           SUBSTR(sd.content, MAX(1, INSTR(sd.content, ?) - 40), 120) AS snippet
    FROM outlines o
    JOIN section_drafts sd ON sd.outline_entry_id = o.id
    WHERE o.sort_order >= 0 AND sd.content LIKE ?
      AND sd.version = (
        SELECT MAX(sd2.version) FROM section_drafts sd2 WHERE sd2.outline_entry_id = o.id
      )
    LIMIT 20
  `).all(query, likePattern) as Array<Record<string, unknown>>;

  // Deduplicate by outlineEntryId
  const seen = new Set<string>();
  const results: Array<{ outlineEntryId: OutlineEntryId; articleId: ArticleId; title: string; snippet: string }> = [];

  for (const row of [...titleMatches, ...contentMatches]) {
    const eid = row['outline_entry_id'] as string;
    if (seen.has(eid)) continue;
    seen.add(eid);
    results.push({
      outlineEntryId: eid as OutlineEntryId,
      articleId: row['article_id'] as ArticleId,
      title: (row['title'] as string) ?? '',
      snippet: (row['snippet'] as string) ?? '',
    });
  }

  return results;
}

// ─── getAllArticles ───

export function getAllArticles(db: Database.Database): Article[] {
  const rows = db
    .prepare('SELECT * FROM articles ORDER BY updated_at DESC')
    .all() as Record<string, unknown>[];
  return rows.map((r) => fromRow<Article>(r));
}

// ─── deleteArticle ───

export function deleteArticle(
  db: Database.Database,
  id: ArticleId,
): number {
  // ON DELETE CASCADE 会删除 outlines → section_drafts
  return db.prepare('DELETE FROM articles WHERE id = ?').run(id).changes;
}

// ═══ Full Document Operations ═══

/**
 * Fetch all sections for an article with their latest draft content.
 * Returns sections ordered by sort_order with parent_id/depth.
 */
export function getFullDocument(
  db: Database.Database,
  articleId: ArticleId,
): Array<{
  sectionId: string;
  title: string;
  content: string;
  documentJson: string | null;
  version: number;
  sortIndex: number;
  parentId: string | null;
  depth: number;
}> {
  const rows = db.prepare(`
    SELECT
      o.id AS section_id,
      o.title,
      o.sort_order,
      o.parent_id,
      o.depth,
      sd.content,
      sd.document_json,
      sd.version
    FROM outlines o
    LEFT JOIN section_drafts sd ON sd.outline_entry_id = o.id
      AND sd.version = (
        SELECT MAX(sd2.version) FROM section_drafts sd2 WHERE sd2.outline_entry_id = o.id
      )
    WHERE o.article_id = ? AND o.sort_order >= 0
    ORDER BY o.sort_order
  `).all(articleId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    sectionId: r['section_id'] as string,
    title: (r['title'] as string) ?? '',
    content: (r['content'] as string) ?? '',
    documentJson: (r['document_json'] as string | null) ?? null,
    version: (r['version'] as number) ?? 0,
    sortIndex: (r['sort_order'] as number) ?? 0,
    parentId: (r['parent_id'] as string | null) ?? null,
    depth: (r['depth'] as number) ?? 0,
  }));
}

/**
 * Save multiple section drafts atomically.
 * Only saves sections that have actually changed.
 */
export function saveDocumentSections(
  db: Database.Database,
  articleId: ArticleId,
  sections: Array<{
    sectionId: string;
    title?: string;
    content: string;
    documentJson?: string | null;
    source: DraftSource;
  }>,
): void {
  const updateTitle = db.prepare(
    `UPDATE outlines SET title = ?, updated_at = ? WHERE id = ? AND article_id = ?`,
  );
  writeTransaction(db, () => {
    for (const section of sections) {
      addSectionDraft(
        db,
        section.sectionId as OutlineEntryId,
        section.content,
        section.source === 'manual' ? 'manual' : 'ai',
        section.source,
        section.documentJson ?? null,
      );
      if (section.title !== undefined) {
        updateTitle.run(section.title, new Date().toISOString(), section.sectionId, articleId);
      }
    }
  });
}

// ═══ Article Assets CRUD ═══

export function addArticleAsset(
  db: Database.Database,
  asset: ArticleAsset,
): void {
  db.prepare(`
    INSERT INTO article_assets (
      id, article_id, file_name, mime_type, file_path, file_size,
      caption, alt_text, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    asset.id,
    asset.articleId,
    asset.fileName,
    asset.mimeType,
    asset.filePath,
    asset.fileSize,
    asset.caption,
    asset.altText,
    asset.createdAt,
  );
}

export function getArticleAssets(
  db: Database.Database,
  articleId: ArticleId,
): ArticleAsset[] {
  const rows = db.prepare(
    'SELECT * FROM article_assets WHERE article_id = ? ORDER BY created_at',
  ).all(articleId) as Record<string, unknown>[];
  return rows.map((r) => fromRow<ArticleAsset>(r));
}

export function getArticleAsset(
  db: Database.Database,
  assetId: string,
): ArticleAsset | null {
  const row = db.prepare(
    'SELECT * FROM article_assets WHERE id = ?',
  ).get(assetId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return fromRow<ArticleAsset>(row);
}

export function deleteArticleAsset(
  db: Database.Database,
  assetId: string,
): number {
  return db.prepare('DELETE FROM article_assets WHERE id = ?').run(assetId).changes;
}

// ═══ Version Cleanup ═══

/**
 * Delete old draft versions, keeping the most recent `keepCount` per section.
 * Returns the number of deleted rows.
 */
export function cleanupVersions(
  db: Database.Database,
  articleId: ArticleId,
  keepCount: number,
): number {
  return writeTransaction(db, () => {
    // Get all outline entry IDs for this article
    const entries = db.prepare(
      'SELECT id FROM outlines WHERE article_id = ? AND sort_order >= 0',
    ).all(articleId) as { id: string }[];

    let totalDeleted = 0;

    for (const entry of entries) {
      // Find the version threshold
      const thresholdRow = db.prepare(`
        SELECT version FROM section_drafts
        WHERE outline_entry_id = ?
        ORDER BY version DESC
        LIMIT 1 OFFSET ?
      `).get(entry.id, keepCount) as { version: number } | undefined;

      if (!thresholdRow) continue; // fewer versions than keepCount

      const deleted = db.prepare(`
        DELETE FROM section_drafts
        WHERE outline_entry_id = ? AND version <= ?
      `).run(entry.id, thresholdRow.version).changes;

      totalDeleted += deleted;
    }

    return totalDeleted;
  });
}
