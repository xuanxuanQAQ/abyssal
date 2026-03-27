// ═══ 文章、纲要与节草稿 CRUD ═══
// §8: createArticle / setOutline / addSectionDraft / markEditedParagraphs

import type Database from 'better-sqlite3';
import type { ArticleId, OutlineEntryId } from '../../types/common';
import type { Article, OutlineEntry, SectionDraft, ArticleStyle, ArticleStatus, OutlineEntryStatus } from '../../types/article';
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
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    article.id,
    article.title,
    article.style,
    article.cslStyleId,
    article.outputLanguage,
    article.status,
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
  updates: Partial<Pick<Article, 'title' | 'style' | 'cslStyleId' | 'outputLanguage' | 'status'>>,
): number {
  const setClauses: string[] = ['updated_at = ?'];
  const params: unknown[] = [now()];

  if (updates.title !== undefined) { setClauses.push('title = ?'); params.push(updates.title); }
  if (updates.style !== undefined) { setClauses.push('style = ?'); params.push(updates.style); }
  if (updates.cslStyleId !== undefined) { setClauses.push('csl_style_id = ?'); params.push(updates.cslStyleId); }
  if (updates.outputLanguage !== undefined) { setClauses.push('output_language = ?'); params.push(updates.outputLanguage); }
  if (updates.status !== undefined) { setClauses.push('status = ?'); params.push(updates.status); }

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
              status = ?, updated_at = ?
          WHERE id = ?
        `).run(
          entry.sortOrder,
          entry.title,
          entry.coreArgument,
          entry.writingInstruction,
          JSON.stringify(entry.conceptIds),
          JSON.stringify(entry.paperIds),
          entry.status,
          timestamp,
          entry.id,
        );
      } else {
        db.prepare(`
          INSERT INTO outlines (
            id, article_id, sort_order, title, core_argument,
            writing_instruction, concept_ids, paper_ids, status,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        outline_entry_id, version, content, llm_backend,
        edited_paragraphs, created_at
      ) VALUES (?, ?, ?, ?, '[]', ?)
    `).run(outlineEntryId, version, content, llmBackend, timestamp);

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
