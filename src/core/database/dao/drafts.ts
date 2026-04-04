import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { ArticleId, DraftId } from '../../types/common';
import type { Draft, DraftSectionMeta, DraftSource, DraftVersion } from '../../types/article';
import { fromRow, now } from '../row-mapper';
import { writeTransaction } from '../transaction-utils';
import {
  buildDocumentProjection,
  contentHash,
  createEmptyArticleDocument,
  createBodyDocumentFromText,
  ensureOutlineHeadingIds,
  parseArticleDocument,
  replaceSectionBodyInDocument,
  serializeArticleDocument,
} from '../../../shared/writing/documentOutline';

type DraftSectionProjection = {
  sectionId: string;
  title: string;
  parentId: string | null;
  sortIndex: number;
  depth: number;
  wordCount: number;
  lineageId: string;
  basedOnSectionId: string | null;
  status: string;
  writingInstruction: string | null;
  conceptIds: string[];
  paperIds: string[];
  aiModel: string | null;
  evidenceStatus: string | null;
  evidenceGaps: string[];
};

function getDraftOrThrow(db: Database.Database, draftId: DraftId): Draft {
  const draft = getDraft(db, draftId);
  if (!draft) {
    throw new Error(`Draft not found: ${draftId}`);
  }
  return draft;
}

function getDraftSectionMetaMap(db: Database.Database, draftId: DraftId): Map<string, DraftSectionMeta> {
  const rows = db.prepare('SELECT * FROM draft_section_meta WHERE draft_id = ? ORDER BY updated_at').all(draftId) as Record<string, unknown>[];
  return new Map(rows.map((row) => {
    const parsed = fromRow<DraftSectionMeta>(row);
    return [parsed.sectionId, parsed];
  }));
}

function getLatestDraftVersionRow(db: Database.Database, draftId: DraftId): DraftVersion | null {
  const row = db.prepare(`
    SELECT *
    FROM draft_versions
    WHERE draft_id = ?
    ORDER BY version DESC
    LIMIT 1
  `).get(draftId) as Record<string, unknown> | undefined;
  return row ? fromRow<DraftVersion>(row) : null;
}

function syncDraftDocumentState(
  db: Database.Database,
  draftId: DraftId,
  inputDocumentJson: string,
  source: DraftSource,
): { documentJson: string; updatedAt: string } {
  const draft = getDraftOrThrow(db, draftId);
  const timestamp = now();
  const parsed = parseArticleDocument(inputDocumentJson);
  const normalized = ensureOutlineHeadingIds(parsed, () => randomUUID());
  const projection = buildDocumentProjection(normalized.document);
  const serialized = serializeArticleDocument(normalized.document);
  const metaMap = getDraftSectionMetaMap(db, draftId);
  const latestVersion = getLatestDraftVersionRow(db, draftId);
  const wholeContent = projection.flatSections
    .map((section) => `${section.title}\n${section.plainText}`.trim())
    .filter((section) => section.length > 0)
    .join('\n\n');
  const wholeHash = contentHash(normalized.document);

  const upsertMeta = db.prepare(`
    INSERT INTO draft_section_meta (
      draft_id, section_id, lineage_id, based_on_section_id, status,
      writing_instruction, concept_ids, paper_ids, ai_model, evidence_status, evidence_gaps,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(draft_id, section_id) DO UPDATE SET
      lineage_id = excluded.lineage_id,
      based_on_section_id = excluded.based_on_section_id,
      status = excluded.status,
      writing_instruction = excluded.writing_instruction,
      concept_ids = excluded.concept_ids,
      paper_ids = excluded.paper_ids,
      ai_model = excluded.ai_model,
      evidence_status = excluded.evidence_status,
      evidence_gaps = excluded.evidence_gaps,
      updated_at = excluded.updated_at
  `);
  const deleteMeta = db.prepare('DELETE FROM draft_section_meta WHERE draft_id = ? AND section_id = ?');
  const nextVersionStmt = db.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM draft_versions WHERE draft_id = ?');
  const insertVersion = db.prepare(`
    INSERT INTO draft_versions (
      draft_id, version, title, content, document_json, content_hash, source, summary, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  writeTransaction(db, () => {
    db.prepare(`
      UPDATE article_drafts
      SET document_json = ?, updated_at = ?
      WHERE id = ?
    `).run(serialized, timestamp, draftId);

    const activeIds = new Set<string>();
    for (const section of projection.flatSections) {
      activeIds.add(section.id);
      const current = metaMap.get(section.id);
      upsertMeta.run(
        draftId,
        section.id,
        current?.lineageId ?? section.id,
        current?.basedOnSectionId ?? null,
        current?.status ?? 'pending',
        current?.writingInstruction ?? null,
        JSON.stringify(current?.conceptIds ?? []),
        JSON.stringify(current?.paperIds ?? []),
        current?.aiModel ?? null,
        current?.evidenceStatus ?? null,
        JSON.stringify(current?.evidenceGaps ?? []),
        current?.createdAt ?? timestamp,
        timestamp,
      );
    }

    for (const sectionId of metaMap.keys()) {
      if (!activeIds.has(sectionId)) {
        deleteMeta.run(draftId, sectionId);
      }
    }

    if (!latestVersion || latestVersion.contentHash !== wholeHash) {
      const nextVersion = nextVersionStmt.get(draftId) as { next_version: number };
      insertVersion.run(
        draftId,
        nextVersion.next_version,
        draft.title,
        wholeContent,
        serialized,
        wholeHash,
        source,
        null,
        timestamp,
      );
    }

    const articleRow = db.prepare('SELECT id, default_draft_id FROM articles WHERE id = ?').get(draft.articleId) as { id: string; default_draft_id: string | null } | undefined;
    if (articleRow?.default_draft_id === draftId) {
      db.prepare('UPDATE articles SET document_json = ?, updated_at = ? WHERE id = ?').run(serialized, timestamp, draft.articleId);
    }
  });

  return { documentJson: serialized, updatedAt: timestamp };
}

export function createInitialDefaultDraft(
  db: Database.Database,
  args: {
    articleId: ArticleId;
    title: string;
    documentJson: string;
    writingStyle: string | null;
    cslStyleId: string | null;
    abstract: string | null;
    keywords: string[];
    targetWordCount: number | null;
    createdAt: string;
    updatedAt: string;
  },
): DraftId {
  const draftId = randomUUID() as DraftId;
  db.prepare(`
    INSERT INTO article_drafts (
      id, article_id, title, status, document_json, based_on_draft_id, source,
      language, audience, writing_style, csl_style_id, abstract, keywords,
      target_word_count, last_opened_at, created_at, updated_at
    ) VALUES (?, ?, ?, 'drafting', ?, NULL, 'manual', NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    draftId,
    args.articleId,
    args.title,
    args.documentJson,
    args.writingStyle,
    args.cslStyleId,
    args.abstract,
    JSON.stringify(args.keywords ?? []),
    args.targetWordCount,
    args.updatedAt,
    args.createdAt,
    args.updatedAt,
  );
  db.prepare('UPDATE articles SET default_draft_id = ? WHERE id = ?').run(draftId, args.articleId);
  syncDraftDocumentState(db, draftId, args.documentJson, 'manual');
  return draftId;
}

export function createDraft(
  db: Database.Database,
  input: Omit<Draft, 'createdAt' | 'updatedAt'>,
): DraftId {
  const timestamp = now();
  const sourceDraft = input.basedOnDraftId ? getDraft(db, input.basedOnDraftId) : null;
  const documentJson = input.documentJson || sourceDraft?.documentJson || serializeArticleDocument(createEmptyArticleDocument());
  const draftId = input.id;

  writeTransaction(db, () => {
    db.prepare(`
      INSERT INTO article_drafts (
        id, article_id, title, status, document_json, based_on_draft_id, source,
        language, audience, writing_style, csl_style_id, abstract, keywords,
        target_word_count, last_opened_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      draftId,
      input.articleId,
      input.title,
      input.status,
      documentJson,
      input.basedOnDraftId,
      input.source,
      input.language,
      input.audience,
      input.writingStyle,
      input.cslStyleId,
      input.abstract,
      JSON.stringify(input.keywords ?? []),
      input.targetWordCount,
      input.lastOpenedAt,
      timestamp,
      timestamp,
    );

    if (input.basedOnDraftId) {
      const metaRows = db.prepare('SELECT * FROM draft_section_meta WHERE draft_id = ?').all(input.basedOnDraftId) as Record<string, unknown>[];
      const insertMeta = db.prepare(`
        INSERT INTO draft_section_meta (
          draft_id, section_id, lineage_id, based_on_section_id, status,
          writing_instruction, concept_ids, paper_ids, ai_model, evidence_status, evidence_gaps,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const row of metaRows) {
        insertMeta.run(
          draftId,
          row['section_id'],
          row['lineage_id'],
          row['section_id'],
          row['status'],
          row['writing_instruction'] ?? null,
          row['concept_ids'] ?? '[]',
          row['paper_ids'] ?? '[]',
          row['ai_model'] ?? null,
          row['evidence_status'] ?? null,
          row['evidence_gaps'] ?? '[]',
          timestamp,
          timestamp,
        );
      }
    }
  });

  syncDraftDocumentState(db, draftId, documentJson, input.source);
  return draftId;
}

export function getDraft(db: Database.Database, id: DraftId): Draft | null {
  const row = db.prepare('SELECT * FROM article_drafts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return fromRow<Draft>(row);
}

export function updateDraft(
  db: Database.Database,
  id: DraftId,
  updates: Partial<Pick<Draft, 'title' | 'status' | 'language' | 'audience' | 'writingStyle' | 'cslStyleId' | 'abstract' | 'keywords' | 'targetWordCount' | 'lastOpenedAt'>>,
): number {
  const setClauses: string[] = ['updated_at = ?'];
  const params: unknown[] = [now()];

  if (updates.title !== undefined) { setClauses.push('title = ?'); params.push(updates.title); }
  if (updates.status !== undefined) { setClauses.push('status = ?'); params.push(updates.status); }
  if (updates.language !== undefined) { setClauses.push('language = ?'); params.push(updates.language); }
  if (updates.audience !== undefined) { setClauses.push('audience = ?'); params.push(updates.audience); }
  if (updates.writingStyle !== undefined) { setClauses.push('writing_style = ?'); params.push(updates.writingStyle); }
  if (updates.cslStyleId !== undefined) { setClauses.push('csl_style_id = ?'); params.push(updates.cslStyleId); }
  if (updates.abstract !== undefined) { setClauses.push('abstract = ?'); params.push(updates.abstract); }
  if (updates.keywords !== undefined) { setClauses.push('keywords = ?'); params.push(JSON.stringify(updates.keywords)); }
  if (updates.targetWordCount !== undefined) { setClauses.push('target_word_count = ?'); params.push(updates.targetWordCount); }
  if (updates.lastOpenedAt !== undefined) { setClauses.push('last_opened_at = ?'); params.push(updates.lastOpenedAt); }

  params.push(id);
  return db.prepare(`UPDATE article_drafts SET ${setClauses.join(', ')} WHERE id = ?`).run(...params).changes;
}

export function listDraftsByArticle(db: Database.Database, articleId: ArticleId): Draft[] {
  const rows = db.prepare('SELECT * FROM article_drafts WHERE article_id = ? ORDER BY updated_at DESC').all(articleId) as Record<string, unknown>[];
  return rows.map((row) => fromRow<Draft>(row));
}

export function deleteDraft(db: Database.Database, id: DraftId): number {
  const draft = getDraft(db, id);
  if (!draft) return 0;

  return writeTransaction(db, () => {
    const changes = db.prepare('DELETE FROM article_drafts WHERE id = ?').run(id).changes;
    const nextDraft = db.prepare('SELECT id, document_json FROM article_drafts WHERE article_id = ? ORDER BY updated_at DESC LIMIT 1').get(draft.articleId) as { id: string; document_json: string } | undefined;
    db.prepare('UPDATE articles SET default_draft_id = ?, document_json = COALESCE(?, document_json), updated_at = ? WHERE id = ?').run(
      nextDraft?.id ?? null,
      nextDraft?.document_json ?? null,
      now(),
      draft.articleId,
    );
    return changes;
  });
}

export function getDraftDocument(
  db: Database.Database,
  draftId: DraftId,
): { draftId: DraftId; articleId: ArticleId; documentJson: string; updatedAt: string } {
  const draft = getDraftOrThrow(db, draftId);
  const normalized = ensureOutlineHeadingIds(parseArticleDocument(draft.documentJson), () => randomUUID());
  const serialized = serializeArticleDocument(normalized.document);
  const updatedAt = serialized !== draft.documentJson ? now() : draft.updatedAt;
  if (serialized !== draft.documentJson) {
    db.prepare('UPDATE article_drafts SET document_json = ?, updated_at = ? WHERE id = ?').run(serialized, updatedAt, draftId);
  }
  return {
    draftId,
    articleId: draft.articleId,
    documentJson: serialized,
    updatedAt,
  };
}

export function saveDraftDocument(
  db: Database.Database,
  draftId: DraftId,
  documentJson: string,
  source: DraftSource,
): void {
  syncDraftDocumentState(db, draftId, documentJson, source);
}

export function getDraftSectionMeta(db: Database.Database, draftId: DraftId): DraftSectionMeta[] {
  const rows = db.prepare('SELECT * FROM draft_section_meta WHERE draft_id = ? ORDER BY updated_at').all(draftId) as Record<string, unknown>[];
  return rows.map((row) => fromRow<DraftSectionMeta>(row));
}

export function getDraftSections(
  db: Database.Database,
  draftId: DraftId,
): DraftSectionProjection[] {
  const draft = getDraftOrThrow(db, draftId);
  const metaMap = getDraftSectionMetaMap(db, draftId);
  const projection = buildDocumentProjection(parseArticleDocument(draft.documentJson));

  return projection.flatSections.map((section) => {
    const meta = metaMap.get(section.id);
    return {
      sectionId: section.id,
      title: section.title,
      parentId: section.parentId,
      sortIndex: section.sortIndex,
      depth: section.depth,
      wordCount: section.wordCount,
      lineageId: meta?.lineageId ?? section.id,
      basedOnSectionId: meta?.basedOnSectionId ?? null,
      status: meta?.status ?? 'pending',
      writingInstruction: meta?.writingInstruction ?? null,
      conceptIds: meta?.conceptIds ?? [],
      paperIds: meta?.paperIds ?? [],
      aiModel: meta?.aiModel ?? null,
      evidenceStatus: meta?.evidenceStatus ?? null,
      evidenceGaps: meta?.evidenceGaps ?? [],
    };
  });
}

export function updateDraftSectionMeta(
  db: Database.Database,
  draftId: DraftId,
  sectionId: string,
  patch: Partial<Pick<DraftSectionMeta, 'lineageId' | 'basedOnSectionId' | 'status' | 'writingInstruction' | 'conceptIds' | 'paperIds' | 'aiModel' | 'evidenceStatus' | 'evidenceGaps'>>,
): number {
  const current = getDraftSectionMetaMap(db, draftId).get(sectionId);
  const timestamp = now();
  return db.prepare(`
    INSERT INTO draft_section_meta (
      draft_id, section_id, lineage_id, based_on_section_id, status,
      writing_instruction, concept_ids, paper_ids, ai_model, evidence_status, evidence_gaps,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(draft_id, section_id) DO UPDATE SET
      lineage_id = excluded.lineage_id,
      based_on_section_id = excluded.based_on_section_id,
      status = excluded.status,
      writing_instruction = excluded.writing_instruction,
      concept_ids = excluded.concept_ids,
      paper_ids = excluded.paper_ids,
      ai_model = excluded.ai_model,
      evidence_status = excluded.evidence_status,
      evidence_gaps = excluded.evidence_gaps,
      updated_at = excluded.updated_at
  `).run(
    draftId,
    sectionId,
    patch.lineageId ?? current?.lineageId ?? sectionId,
    patch.basedOnSectionId ?? current?.basedOnSectionId ?? null,
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

export function updateDraftSectionContent(
  db: Database.Database,
  draftId: DraftId,
  sectionId: string,
  content: string,
  documentJson: string | null | undefined,
  source: DraftSource,
): void {
  const current = getDraftDocument(db, draftId);
  const bodyDoc = documentJson ? parseArticleDocument(documentJson) : createBodyDocumentFromText(content);
  const nextDocument = replaceSectionBodyInDocument(parseArticleDocument(current.documentJson), sectionId, bodyDoc);
  saveDraftDocument(db, draftId, JSON.stringify(nextDocument), source);
}

export function getDraftVersions(db: Database.Database, draftId: DraftId): DraftVersion[] {
  const rows = db.prepare('SELECT * FROM draft_versions WHERE draft_id = ? ORDER BY version DESC').all(draftId) as Record<string, unknown>[];
  return rows.map((row) => fromRow<DraftVersion>(row));
}

export function getDraftVersion(db: Database.Database, draftId: DraftId, version: number): DraftVersion | null {
  const row = db.prepare('SELECT * FROM draft_versions WHERE draft_id = ? AND version = ?').get(draftId, version) as Record<string, unknown> | undefined;
  return row ? fromRow<DraftVersion>(row) : null;
}

export function restoreDraftVersion(db: Database.Database, draftId: DraftId, version: number): void {
  const snapshot = getDraftVersion(db, draftId, version);
  if (!snapshot) {
    throw new Error(`Draft version not found: ${draftId}#${version}`);
  }
  saveDraftDocument(db, draftId, snapshot.documentJson, 'manual');
}

export function createDraftFromVersion(
  db: Database.Database,
  draftId: DraftId,
  version: number,
  title: string,
): DraftId {
  const sourceDraft = getDraftOrThrow(db, draftId);
  const snapshot = getDraftVersion(db, draftId, version);
  if (!snapshot) {
    throw new Error(`Draft version not found: ${draftId}#${version}`);
  }
  const nextDraftId = randomUUID() as DraftId;
  createDraft(db, {
    id: nextDraftId,
    articleId: sourceDraft.articleId,
    title,
    status: 'drafting',
    documentJson: snapshot.documentJson,
    basedOnDraftId: draftId,
    source: 'duplicate',
    language: sourceDraft.language,
    audience: sourceDraft.audience,
    writingStyle: sourceDraft.writingStyle,
    cslStyleId: sourceDraft.cslStyleId,
    abstract: sourceDraft.abstract,
    keywords: sourceDraft.keywords,
    targetWordCount: sourceDraft.targetWordCount,
    lastOpenedAt: null,
  });
  return nextDraftId;
}