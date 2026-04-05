import type Database from 'better-sqlite3';
import type { ArticleId, OutlineEntryId } from '../../types/common';
import type {
  Article,
  OutlineEntry,
  SectionDraft,
  ArticleAsset,
  DraftSource,
  ArticleSectionMeta,
  ArticleSectionVersion,
  OutlineEntryStatus,
} from '../../types/article';
import { fromRow, now } from '../row-mapper';
import { writeTransaction } from '../transaction-utils';
import {
  buildDocumentProjection,
  contentHash,
  createBodyDocumentFromText,
  createEmptyArticleDocument,
  deleteSectionFromDocument,
  extractCitedPaperIdsFromDocument,
  extractPlainText,
  insertSectionInDocument,
  parseArticleDocument,
  renameSectionInDocument,
  reorderSectionsInDocument,
  replaceSectionBodyInDocument,
  serializeArticleDocument,
  ensureOutlineHeadingIds,
} from '../../../shared/writing/documentOutline';
import { createInitialDefaultDraft } from './drafts';

type SectionVersionRow = ArticleSectionVersion;
type SectionMetaRow = ArticleSectionMeta;

function defaultDocumentString(): string {
  return serializeArticleDocument(createEmptyArticleDocument());
}

function getArticleOrThrow(db: Database.Database, articleId: ArticleId): Article {
  const article = getArticle(db, articleId);
  if (!article) {
    throw new Error(`Article not found: ${articleId}`);
  }
  return article;
}

function getSectionMetaMap(
  db: Database.Database,
  articleId: ArticleId,
): Map<string, SectionMetaRow> {
  const rows = db.prepare(
    'SELECT * FROM article_section_meta WHERE article_id = ? ORDER BY updated_at',
  ).all(articleId) as Record<string, unknown>[];
  return new Map(rows.map((row) => {
    const parsed = fromRow<SectionMetaRow>(row);
    return [parsed.sectionId, parsed];
  }));
}

function getLatestVersionMap(
  db: Database.Database,
  articleId: ArticleId,
): Map<string, SectionVersionRow> {
  const rows = db.prepare(`
    SELECT article_id, section_id, version, title, content, document_json, content_hash, source, created_at
    FROM article_section_versions v
    WHERE article_id = ?
      AND version = (
        SELECT MAX(v2.version)
        FROM article_section_versions v2
        WHERE v2.article_id = v.article_id AND v2.section_id = v.section_id
      )
  `).all(articleId) as Record<string, unknown>[];

  return new Map(rows.map((row) => {
    const parsed = fromRow<SectionVersionRow>(row);
    return [parsed.sectionId, parsed];
  }));
}

function findArticleIdBySectionId(
  db: Database.Database,
  sectionId: string,
): ArticleId | null {
  const row = db.prepare(`
    SELECT article_id
    FROM article_section_meta
    WHERE section_id = ?
    UNION
    SELECT article_id
    FROM article_section_versions
    WHERE section_id = ?
    LIMIT 1
  `).get(sectionId, sectionId) as { article_id: string } | undefined;

  return (row?.article_id as ArticleId | undefined) ?? null;
}

function buildLegacyOutlineEntries(
  db: Database.Database,
  articleId: ArticleId,
): OutlineEntry[] {
  const article = getArticleOrThrow(db, articleId);
  const normalized = ensureOutlineHeadingIds(parseArticleDocument(article.documentJson), () => crypto.randomUUID());
  const projection = buildDocumentProjection(normalized.document);
  const metaMap = getSectionMetaMap(db, articleId);

  return projection.flatSections.map((section, index) => {
    const meta = metaMap.get(section.id);
    return {
      id: section.id as OutlineEntryId,
      articleId,
      parentId: (section.parentId as OutlineEntryId | null) ?? null,
      depth: section.depth,
      sortOrder: index,
      title: section.title,
      coreArgument: null,
      writingInstruction: meta?.writingInstruction ?? null,
      conceptIds: meta?.conceptIds ?? [],
      paperIds: meta?.paperIds ?? [],
      status: (meta?.status ?? 'pending') as OutlineEntryStatus,
    } satisfies OutlineEntry;
  });
}

function syncDocumentState(
  db: Database.Database,
  articleId: ArticleId,
  inputDocumentJson: string,
  source: DraftSource,
): { documentJson: string; updatedAt: string } {
  const timestamp = now();
  const parsed = parseArticleDocument(inputDocumentJson);
  const normalized = ensureOutlineHeadingIds(parsed, () => crypto.randomUUID());
  const projection = buildDocumentProjection(normalized.document);
  const serialized = serializeArticleDocument(normalized.document);

  const existingMeta = getSectionMetaMap(db, articleId);
  const latestVersions = getLatestVersionMap(db, articleId);

  const upsertMeta = db.prepare(`
    INSERT INTO article_section_meta (
      article_id, section_id, status, writing_instruction,
      concept_ids, paper_ids, ai_model, evidence_status, evidence_gaps,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(article_id, section_id) DO UPDATE SET
      status = excluded.status,
      writing_instruction = excluded.writing_instruction,
      concept_ids = excluded.concept_ids,
      paper_ids = excluded.paper_ids,
      ai_model = excluded.ai_model,
      evidence_status = excluded.evidence_status,
      evidence_gaps = excluded.evidence_gaps,
      updated_at = excluded.updated_at
  `);

  const deleteMeta = db.prepare(
    'DELETE FROM article_section_meta WHERE article_id = ? AND section_id = ?',
  );
  const nextVersionStmt = db.prepare(
    'SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM article_section_versions WHERE article_id = ? AND section_id = ?',
  );
  const insertVersion = db.prepare(`
    INSERT INTO article_section_versions (
      article_id, section_id, version, title, content,
      document_json, content_hash, source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  writeTransaction(db, () => {
    db.prepare(
      'UPDATE articles SET document_json = ?, updated_at = ? WHERE id = ?',
    ).run(serialized, timestamp, articleId);

    const activeIds = new Set<string>();

    for (const section of projection.flatSections) {
      activeIds.add(section.id);
      const previousMeta = existingMeta.get(section.id);

      upsertMeta.run(
        articleId,
        section.id,
        previousMeta?.status ?? 'pending',
        previousMeta?.writingInstruction ?? null,
        JSON.stringify(previousMeta?.conceptIds ?? []),
        JSON.stringify(previousMeta?.paperIds ?? []),
        previousMeta?.aiModel ?? null,
        previousMeta?.evidenceStatus ?? null,
        JSON.stringify(previousMeta?.evidenceGaps ?? []),
        previousMeta?.createdAt ?? timestamp,
        timestamp,
      );

      const bodyHash = contentHash(section.bodyDocument);
      const latestVersion = latestVersions.get(section.id);
      if (!latestVersion || latestVersion.contentHash !== bodyHash || latestVersion.title !== section.title) {
        const versionRow = nextVersionStmt.get(articleId, section.id) as { next_version: number };
        insertVersion.run(
          articleId,
          section.id,
          versionRow.next_version,
          section.title,
          section.plainText,
          serializeArticleDocument(section.bodyDocument),
          bodyHash,
          source,
          timestamp,
        );
      }
    }

    for (const sectionId of existingMeta.keys()) {
      if (!activeIds.has(sectionId)) {
        deleteMeta.run(articleId, sectionId);
      }
    }
  });

  return {
    documentJson: serialized,
    updatedAt: timestamp,
  };
}

export function createArticle(
  db: Database.Database,
  article: Omit<Article, 'createdAt' | 'updatedAt'>,
): ArticleId {
  const timestamp = now();
  const documentJson = article.documentJson ?? defaultDocumentString();

  db.prepare(`
    INSERT INTO articles (
      id, title, style, csl_style_id, output_language, status,
      document_json, abstract, keywords, authors, target_word_count,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    article.id,
    article.title,
    article.style,
    article.cslStyleId,
    article.outputLanguage,
    article.status,
    documentJson,
    article.abstract ?? null,
    JSON.stringify(article.keywords ?? []),
    JSON.stringify(article.authors ?? []),
    article.targetWordCount ?? null,
    timestamp,
    timestamp,
  );

  createInitialDefaultDraft(db, {
    articleId: article.id,
    title: '主稿',
    documentJson,
    writingStyle: article.style,
    cslStyleId: article.cslStyleId,
    abstract: article.abstract ?? null,
    keywords: article.keywords ?? [],
    targetWordCount: article.targetWordCount ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  syncDocumentState(db, article.id, documentJson, 'manual');
  return article.id;
}

export function getArticle(
  db: Database.Database,
  id: ArticleId,
): Article | null {
  const row = db.prepare('SELECT * FROM articles WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return fromRow<Article>(row);
}

export function updateArticle(
  db: Database.Database,
  id: ArticleId,
  updates: Partial<Pick<Article, 'title' | 'style' | 'cslStyleId' | 'outputLanguage' | 'status' | 'documentJson' | 'abstract' | 'keywords' | 'authors' | 'targetWordCount'>>,
): number {
  const setClauses: string[] = ['updated_at = ?'];
  const params: unknown[] = [now()];

  if (updates.title !== undefined) { setClauses.push('title = ?'); params.push(updates.title); }
  if (updates.style !== undefined) { setClauses.push('style = ?'); params.push(updates.style); }
  if (updates.cslStyleId !== undefined) { setClauses.push('csl_style_id = ?'); params.push(updates.cslStyleId); }
  if (updates.outputLanguage !== undefined) { setClauses.push('output_language = ?'); params.push(updates.outputLanguage); }
  if (updates.status !== undefined) { setClauses.push('status = ?'); params.push(updates.status); }
  if (updates.documentJson !== undefined) { setClauses.push('document_json = ?'); params.push(updates.documentJson); }
  if (updates.abstract !== undefined) { setClauses.push('abstract = ?'); params.push(updates.abstract); }
  if (updates.keywords !== undefined) { setClauses.push('keywords = ?'); params.push(JSON.stringify(updates.keywords)); }
  if (updates.authors !== undefined) { setClauses.push('authors = ?'); params.push(JSON.stringify(updates.authors)); }
  if (updates.targetWordCount !== undefined) { setClauses.push('target_word_count = ?'); params.push(updates.targetWordCount); }

  params.push(id);
  return db.prepare(`UPDATE articles SET ${setClauses.join(', ')} WHERE id = ?`).run(...params).changes;
}

export function getAllArticles(db: Database.Database): Article[] {
  const rows = db.prepare('SELECT * FROM articles ORDER BY updated_at DESC').all() as Record<string, unknown>[];
  return rows.map((row) => fromRow<Article>(row));
}

export function deleteArticle(
  db: Database.Database,
  id: ArticleId,
): number {
  return db.prepare('DELETE FROM articles WHERE id = ?').run(id).changes;
}

export function getArticleDocument(
  db: Database.Database,
  articleId: ArticleId,
): { articleId: ArticleId; documentJson: string; updatedAt: string } {
  const article = getArticleOrThrow(db, articleId);
  const normalized = ensureOutlineHeadingIds(parseArticleDocument(article.documentJson), () => crypto.randomUUID());
  const serialized = serializeArticleDocument(normalized.document);
  if (serialized !== (article.documentJson ?? defaultDocumentString())) {
    updateArticle(db, articleId, { documentJson: serialized });
  }
  return {
    articleId,
    documentJson: serialized,
    updatedAt: article.updatedAt,
  };
}

export function saveArticleDocument(
  db: Database.Database,
  articleId: ArticleId,
  documentJson: string,
  source: DraftSource,
): void {
  syncDocumentState(db, articleId, documentJson, source);
}

export function setOutline(
  db: Database.Database,
  articleId: ArticleId,
  entries: OutlineEntry[],
): void {
  const sorted = [...entries].sort((left, right) => left.sortOrder - right.sortOrder);
  const doc = {
    type: 'doc',
    content: sorted.flatMap((entry) => [
      {
        type: 'heading',
        attrs: {
          level: Math.min((entry.depth ?? 0) + 1, 3),
          sectionId: entry.id,
        },
        content: [{ type: 'text', text: entry.title || '未命名节' }],
      },
      { type: 'paragraph' },
    ]),
  };
  saveArticleDocument(db, articleId, JSON.stringify(doc), 'manual');
}

export function getOutline(
  db: Database.Database,
  articleId: ArticleId,
): OutlineEntry[] {
  return buildLegacyOutlineEntries(db, articleId);
}

export function getOutlineEntry(
  db: Database.Database,
  id: OutlineEntryId,
): OutlineEntry | null {
  const articleId = findArticleIdBySectionId(db, id);
  if (!articleId) return null;
  return buildLegacyOutlineEntries(db, articleId).find((entry) => entry.id === id) ?? null;
}

function upsertSectionMetaPatch(
  db: Database.Database,
  articleId: ArticleId,
  sectionId: string,
  patch: Partial<Pick<OutlineEntry, 'writingInstruction' | 'conceptIds' | 'paperIds' | 'status'>> & {
    aiModel?: string | null;
    evidenceStatus?: string | null;
    evidenceGaps?: string[];
  },
): number {
  const metaMap = getSectionMetaMap(db, articleId);
  const current = metaMap.get(sectionId);
  const timestamp = now();
  return db.prepare(`
    INSERT INTO article_section_meta (
      article_id, section_id, status, writing_instruction,
      concept_ids, paper_ids, ai_model, evidence_status, evidence_gaps,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(article_id, section_id) DO UPDATE SET
      status = excluded.status,
      writing_instruction = excluded.writing_instruction,
      concept_ids = excluded.concept_ids,
      paper_ids = excluded.paper_ids,
      ai_model = excluded.ai_model,
      evidence_status = excluded.evidence_status,
      evidence_gaps = excluded.evidence_gaps,
      updated_at = excluded.updated_at
  `).run(
    articleId,
    sectionId,
    patch.status ?? current?.status ?? 'pending',
    patch.writingInstruction ?? current?.writingInstruction ?? null,
    JSON.stringify(patch.conceptIds ?? current?.conceptIds ?? []),
    JSON.stringify(patch.paperIds ?? current?.paperIds ?? []),
    patch.aiModel ?? current?.aiModel ?? null,
    patch.evidenceStatus ?? current?.evidenceStatus ?? null,
    JSON.stringify(patch.evidenceGaps ?? current?.evidenceGaps ?? []),
    current?.createdAt ?? timestamp,
    timestamp,
  ).changes;
}

export function updateOutlineEntry(
  db: Database.Database,
  id: OutlineEntryId,
  updates: Partial<Pick<OutlineEntry, 'title' | 'coreArgument' | 'writingInstruction' | 'conceptIds' | 'paperIds' | 'status' | 'sortOrder' | 'parentId' | 'depth'>>,
): number {
  const articleId = findArticleIdBySectionId(db, id);
  if (!articleId) return 0;

  let changed = 0;
  if (updates.title !== undefined) {
    const current = getArticleDocument(db, articleId);
    const renamed = renameSectionInDocument(parseArticleDocument(current.documentJson), id, updates.title);
    saveArticleDocument(db, articleId, JSON.stringify(renamed), 'manual');
    changed += 1;
  }

  if (
    updates.writingInstruction !== undefined ||
    updates.conceptIds !== undefined ||
    updates.paperIds !== undefined ||
    updates.status !== undefined
  ) {
    const metaPatch: Parameters<typeof upsertSectionMetaPatch>[3] = {};
    if (updates.writingInstruction !== undefined) metaPatch.writingInstruction = updates.writingInstruction;
    if (updates.conceptIds !== undefined) metaPatch.conceptIds = updates.conceptIds;
    if (updates.paperIds !== undefined) metaPatch.paperIds = updates.paperIds;
    if (updates.status !== undefined) metaPatch.status = updates.status;
    changed += upsertSectionMetaPatch(db, articleId, id, metaPatch);
  }

  return changed;
}

export function markOutlineEntryDeleted(
  db: Database.Database,
  id: OutlineEntryId,
): number {
  const articleId = findArticleIdBySectionId(db, id);
  if (!articleId) return 0;
  const current = getArticleDocument(db, articleId);
  const next = deleteSectionFromDocument(parseArticleDocument(current.documentJson), id);
  saveArticleDocument(db, articleId, JSON.stringify(next), 'manual');
  return 1;
}

export function searchSections(
  db: Database.Database,
  query: string,
): Array<{ outlineEntryId: OutlineEntryId; articleId: ArticleId; title: string; snippet: string }> {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) return [];

  const results: Array<{ outlineEntryId: OutlineEntryId; articleId: ArticleId; title: string; snippet: string }> = [];
  for (const article of getAllArticles(db)) {
    const projection = buildDocumentProjection(parseArticleDocument(article.documentJson));
    for (const section of projection.flatSections) {
      const haystack = `${section.title}\n${section.plainText}`.toLowerCase();
      if (!haystack.includes(normalizedQuery)) continue;

      const index = section.plainText.toLowerCase().indexOf(normalizedQuery);
      const snippet = index >= 0
        ? section.plainText.slice(Math.max(0, index - 40), index + normalizedQuery.length + 80)
        : '';
      results.push({
        outlineEntryId: section.id as OutlineEntryId,
        articleId: article.id,
        title: section.title,
        snippet,
      });
    }
  }

  return results.slice(0, 20);
}

export function addSectionDraft(
  db: Database.Database,
  outlineEntryId: OutlineEntryId,
  content: string,
  _llmBackend: string,
  source: DraftSource = 'manual',
  documentJson: string | null = null,
): number {
  const articleId = findArticleIdBySectionId(db, outlineEntryId);
  if (!articleId) {
    throw new Error(`Section not found: ${outlineEntryId}`);
  }

  const current = getArticleDocument(db, articleId);
  const bodyDoc = documentJson ? parseArticleDocument(documentJson) : createBodyDocumentFromText(content);
  const nextDocument = replaceSectionBodyInDocument(parseArticleDocument(current.documentJson), outlineEntryId, bodyDoc);
  saveArticleDocument(db, articleId, JSON.stringify(nextDocument), source);

  const latest = db.prepare(`
    SELECT version
    FROM article_section_versions
    WHERE article_id = ? AND section_id = ?
    ORDER BY version DESC
    LIMIT 1
  `).get(articleId, outlineEntryId) as { version: number } | undefined;

  return latest?.version ?? 1;
}

export function getSectionDrafts(
  db: Database.Database,
  outlineEntryId: OutlineEntryId,
): SectionDraft[] {
  const articleId = findArticleIdBySectionId(db, outlineEntryId);
  if (!articleId) return [];

  const rows = db.prepare(`
    SELECT article_id, section_id AS outline_entry_id, version, title, content,
           document_json, source, created_at
    FROM article_section_versions
    WHERE article_id = ? AND section_id = ?
    ORDER BY version DESC
  `).all(articleId, outlineEntryId) as Record<string, unknown>[];

  return rows.map((row) => {
    const docJsonStr = row['document_json'] as string | null;
    const citedPaperIds = docJsonStr
      ? extractCitedPaperIdsFromDocument(parseArticleDocument(docJsonStr))
      : extractCitedPaperIdsFromDocument(parseArticleDocument(null));
    return {
      outlineEntryId: row['outline_entry_id'] as OutlineEntryId,
      version: Number(row['version'] ?? 1),
      content: String(row['content'] ?? ''),
      documentJson: (row['document_json'] as string | null) ?? null,
      llmBackend: row['source'] === 'manual' ? 'manual' : 'ai',
      source: (row['source'] as DraftSource) ?? 'manual',
      editedParagraphs: [],
      createdAt: String(row['created_at'] ?? ''),
      citedPaperIds,
    } satisfies SectionDraft;
  });
}

export function markEditedParagraphs(
  _db: Database.Database,
  _outlineEntryId: OutlineEntryId,
  _version: number,
  _paragraphIndices: number[],
): number {
  return 1;
}

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
  const article = getArticleOrThrow(db, articleId);
  const projection = buildDocumentProjection(parseArticleDocument(article.documentJson));
  const latestVersions = getLatestVersionMap(db, articleId);

  return projection.flatSections.map((section, index) => {
    const latest = latestVersions.get(section.id);
    return {
      sectionId: section.id,
      title: section.title,
      content: latest?.content ?? section.plainText,
      documentJson: latest?.documentJson ?? serializeArticleDocument(section.bodyDocument),
      version: latest?.version ?? 0,
      sortIndex: index,
      parentId: section.parentId,
      depth: section.depth,
    };
  });
}

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
  let document = parseArticleDocument(getArticleDocument(db, articleId).documentJson);

  for (const section of sections) {
    if (section.title !== undefined) {
      document = renameSectionInDocument(document, section.sectionId, section.title);
    }
    if (section.documentJson !== undefined || section.content !== undefined) {
      const bodyDoc = section.documentJson
        ? parseArticleDocument(section.documentJson)
        : createBodyDocumentFromText(section.content);
      document = replaceSectionBodyInDocument(document, section.sectionId, bodyDoc);
    }
  }

  saveArticleDocument(db, articleId, JSON.stringify(document), sections[0]?.source ?? 'manual');
}

export function cleanupVersions(
  db: Database.Database,
  articleId: ArticleId,
  keepCount: number,
): number {
  return writeTransaction(db, () => {
    const sectionRows = db.prepare(
      'SELECT DISTINCT section_id FROM article_section_versions WHERE article_id = ?',
    ).all(articleId) as Array<{ section_id: string }>;

    let totalDeleted = 0;
    for (const sectionRow of sectionRows) {
      const threshold = db.prepare(`
        SELECT version
        FROM article_section_versions
        WHERE article_id = ? AND section_id = ?
        ORDER BY version DESC
        LIMIT 1 OFFSET ?
      `).get(articleId, sectionRow.section_id, keepCount) as { version: number } | undefined;

      if (!threshold) continue;
      totalDeleted += db.prepare(`
        DELETE FROM article_section_versions
        WHERE article_id = ? AND section_id = ? AND version <= ?
      `).run(articleId, sectionRow.section_id, threshold.version).changes;
    }

    return totalDeleted;
  });
}

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
  return rows.map((row) => fromRow<ArticleAsset>(row));
}

export function getArticleAsset(
  db: Database.Database,
  assetId: string,
): ArticleAsset | null {
  const row = db.prepare('SELECT * FROM article_assets WHERE id = ?').get(assetId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return fromRow<ArticleAsset>(row);
}

export function deleteArticleAsset(
  db: Database.Database,
  assetId: string,
): number {
  return db.prepare('DELETE FROM article_assets WHERE id = ?').run(assetId).changes;
}