import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

// ── Inlined from shared/writing/documentOutline.ts ──
// Migration files must be self-contained because Vitest forks pool
// cannot resolve .ts relative imports under Node ESM.

interface JSONContent {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: JSONContent[];
  text?: string;
  marks?: unknown[];
}

interface ProjectedSection {
  id: string;
  title: string;
  level: number;
  depth: number;
  parentId: string | null;
  sortIndex: number;
  wordCount: number;
  startIndex: number;
  bodyStartIndex: number;
  bodyEndIndex: number;
  subtreeEndIndex: number;
  bodyDocument: JSONContent;
  plainText: string;
  children: ProjectedSection[];
}

interface DocumentProjection {
  document: JSONContent;
  flatSections: ProjectedSection[];
  rootSections: ProjectedSection[];
}

function cloneNode<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createEmptyArticleDocument(): JSONContent {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

function parseArticleDocument(documentJson: string | null | undefined): JSONContent {
  if (!documentJson) return createEmptyArticleDocument();
  try {
    const parsed = JSON.parse(documentJson) as JSONContent;
    if (parsed?.type !== 'doc' || !Array.isArray(parsed.content)) {
      return createEmptyArticleDocument();
    }
    return parsed;
  } catch {
    return createEmptyArticleDocument();
  }
}

function serializeArticleDocument(document: JSONContent): string {
  return JSON.stringify(document);
}

function contentHash(json: JSONContent): string {
  const str = JSON.stringify(json);
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

function isOutlineHeading(node: JSONContent | undefined): boolean {
  if (!node || node.type !== 'heading') return false;
  const level = Number(node.attrs?.level ?? 0);
  return level >= 1 && level <= 3;
}

function clampHeadingLevel(level: number): number {
  return Math.max(1, Math.min(6, level));
}

function extractTextContent(node: JSONContent | undefined): string {
  if (!node) return '';
  if (typeof node.text === 'string') return node.text;
  if (!Array.isArray(node.content)) return '';
  return node.content.map((child) => extractTextContent(child)).join('');
}

function extractPlainText(nodes: JSONContent[]): string {
  const parts: string[] = [];
  for (const node of nodes) {
    const text = extractTextContent(node).trim();
    if (text.length > 0) parts.push(text);
  }
  return parts.join('\n\n');
}

function countWords(text: string): number {
  const normalized = text.trim();
  if (normalized.length === 0) return 0;
  return normalized.split(/\s+/).length;
}

function buildDocumentProjection(inputDocument: JSONContent): DocumentProjection {
  const document = inputDocument?.type === 'doc' ? inputDocument : createEmptyArticleDocument();
  const content = Array.isArray(document.content) ? document.content : [];
  const flatSections: ProjectedSection[] = [];
  const siblingCounter = new Map<string | null, number>();
  const stack: ProjectedSection[] = [];

  const headingIndices: number[] = [];
  for (let index = 0; index < content.length; index += 1) {
    if (isOutlineHeading(content[index])) headingIndices.push(index);
  }

  for (let index = 0; index < headingIndices.length; index += 1) {
    const startIndex = headingIndices[index]!;
    const headingNode = content[startIndex]!;
    const nextHeadingIndex = headingIndices[index + 1] ?? content.length;
    const level = clampHeadingLevel(Number(headingNode.attrs?.level ?? 1));
    const sectionId = String(headingNode.attrs?.sectionId ?? '');
    const title = extractTextContent(headingNode).trim() || '未命名节';

    while (stack.length > 0 && stack[stack.length - 1]!.level >= level) {
      stack.pop();
    }

    const parent = stack[stack.length - 1] ?? null;
    const parentId = parent?.id ?? null;
    const sortIndex = siblingCounter.get(parentId) ?? 0;
    siblingCounter.set(parentId, sortIndex + 1);

    const bodyNodes = content.slice(startIndex + 1, nextHeadingIndex).map((node) => cloneNode(node));
    const bodyDocument: JSONContent = {
      type: 'doc',
      content: bodyNodes.length > 0 ? bodyNodes : [{ type: 'paragraph' }],
    };
    const plainText = extractPlainText(bodyNodes);

    const projected: ProjectedSection = {
      id: sectionId,
      title,
      level,
      depth: level - 1,
      parentId,
      sortIndex,
      wordCount: countWords(plainText),
      startIndex,
      bodyStartIndex: startIndex + 1,
      bodyEndIndex: nextHeadingIndex - 1,
      subtreeEndIndex: content.length - 1,
      bodyDocument,
      plainText,
      children: [],
    };

    if (parent) parent.children.push(projected);
    flatSections.push(projected);
    stack.push(projected);
  }

  for (let index = 0; index < flatSections.length; index += 1) {
    const current = flatSections[index]!;
    for (let nextIndex = index + 1; nextIndex < flatSections.length; nextIndex += 1) {
      const candidate = flatSections[nextIndex]!;
      if (candidate.level <= current.level) {
        current.subtreeEndIndex = candidate.startIndex - 1;
        break;
      }
    }
  }

  return {
    document,
    flatSections,
    rootSections: flatSections.filter((section) => section.parentId === null),
  };
}

function columnExists(db: Database.Database, tableName: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
}

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS article_drafts (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'drafting',
      document_json TEXT NOT NULL,
      based_on_draft_id TEXT REFERENCES article_drafts(id) ON DELETE SET NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      language TEXT,
      audience TEXT,
      writing_style TEXT,
      csl_style_id TEXT,
      abstract TEXT,
      keywords TEXT NOT NULL DEFAULT '[]',
      target_word_count INTEGER,
      last_opened_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_article_drafts_article ON article_drafts(article_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS draft_section_meta (
      draft_id TEXT NOT NULL REFERENCES article_drafts(id) ON DELETE CASCADE,
      section_id TEXT NOT NULL,
      lineage_id TEXT NOT NULL,
      based_on_section_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      writing_instruction TEXT,
      concept_ids TEXT NOT NULL DEFAULT '[]',
      paper_ids TEXT NOT NULL DEFAULT '[]',
      ai_model TEXT,
      evidence_status TEXT,
      evidence_gaps TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (draft_id, section_id)
    );
    CREATE INDEX IF NOT EXISTS idx_draft_section_meta_draft ON draft_section_meta(draft_id);
    CREATE INDEX IF NOT EXISTS idx_draft_section_meta_lineage ON draft_section_meta(draft_id, lineage_id);

    CREATE TABLE IF NOT EXISTS draft_versions (
      draft_id TEXT NOT NULL REFERENCES article_drafts(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      document_json TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (draft_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_draft_versions_lookup ON draft_versions(draft_id, version DESC);

    CREATE TABLE IF NOT EXISTS draft_asset_references (
      draft_id TEXT NOT NULL REFERENCES article_drafts(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL REFERENCES article_assets(id) ON DELETE CASCADE,
      referenced_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (draft_id, asset_id)
    );
    CREATE INDEX IF NOT EXISTS idx_draft_asset_refs_asset ON draft_asset_references(asset_id);

    CREATE TABLE IF NOT EXISTS draft_generation_jobs (
      job_id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      draft_id TEXT NOT NULL REFERENCES article_drafts(id) ON DELETE CASCADE,
      source_draft_id TEXT REFERENCES article_drafts(id) ON DELETE SET NULL,
      operation TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      stage TEXT NOT NULL DEFAULT 'initializing',
      progress_current INTEGER NOT NULL DEFAULT 0,
      progress_total INTEGER NOT NULL DEFAULT 0,
      checkpoint TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_draft_generation_jobs_article ON draft_generation_jobs(article_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_draft_generation_jobs_draft ON draft_generation_jobs(draft_id, updated_at DESC);
  `);

  if (!columnExists(db, 'articles', 'default_draft_id')) {
    db.exec(`ALTER TABLE articles ADD COLUMN default_draft_id TEXT REFERENCES article_drafts(id) ON DELETE SET NULL;`);
  }

  const articles = db.prepare(`
    SELECT id, title, style, csl_style_id, abstract, keywords, target_word_count, document_json, created_at, updated_at, default_draft_id
    FROM articles
    ORDER BY created_at ASC
  `).all() as Array<{
    id: string;
    title: string;
    style: string | null;
    csl_style_id: string | null;
    abstract: string | null;
    keywords: string | null;
    target_word_count: number | null;
    document_json: string | null;
    created_at: string;
    updated_at: string;
    default_draft_id: string | null;
  }>;

  const insertDraft = db.prepare(`
    INSERT INTO article_drafts (
      id, article_id, title, status, document_json, based_on_draft_id, source,
      language, audience, writing_style, csl_style_id, abstract, keywords,
      target_word_count, last_opened_at, created_at, updated_at
    ) VALUES (?, ?, ?, 'drafting', ?, NULL, 'manual', NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateDefaultDraft = db.prepare('UPDATE articles SET default_draft_id = ? WHERE id = ?');
  const insertDraftVersion = db.prepare(`
    INSERT OR IGNORE INTO draft_versions (
      draft_id, version, title, content, document_json, content_hash, source, summary, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertDraftSectionMeta = db.prepare(`
    INSERT OR IGNORE INTO draft_section_meta (
      draft_id, section_id, lineage_id, based_on_section_id, status,
      writing_instruction, concept_ids, paper_ids, ai_model, evidence_status, evidence_gaps,
      created_at, updated_at
    ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertCurrentMetaToDraft = db.prepare(`
    INSERT OR REPLACE INTO draft_section_meta (
      draft_id, section_id, lineage_id, based_on_section_id, status,
      writing_instruction, concept_ids, paper_ids, ai_model, evidence_status, evidence_gaps,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const article of articles) {
    let draftId = article.default_draft_id;
    if (!draftId) {
      draftId = randomUUID();
      insertDraft.run(
        draftId,
        article.id,
        '主稿',
        article.document_json ?? '{"type":"doc","content":[{"type":"paragraph"}]}',
        article.style,
        article.csl_style_id,
        article.abstract,
        article.keywords ?? '[]',
        article.target_word_count,
        article.updated_at,
        article.created_at,
        article.updated_at,
      );
      updateDefaultDraft.run(draftId, article.id);
    }

    const existingVersionCount = db.prepare('SELECT COUNT(1) AS count FROM draft_versions WHERE draft_id = ?').get(draftId) as { count: number };
    if (existingVersionCount.count === 0) {
      const parsed = parseArticleDocument(article.document_json);
      const projection = buildDocumentProjection(parsed);
      const content = projection.flatSections
        .map((section) => `${section.title}\n${section.plainText}`.trim())
        .filter((section) => section.length > 0)
        .join('\n\n');
      const serialized = serializeArticleDocument(parsed);
      insertDraftVersion.run(
        draftId,
        1,
        '主稿',
        content,
        serialized,
        contentHash(parsed),
        'manual',
        'Migrated from article document',
        article.updated_at,
      );
    }

    const articleMetaRows = db.prepare(`
      SELECT * FROM article_section_meta WHERE article_id = ?
    `).all(article.id) as Array<Record<string, unknown>>;
    for (const row of articleMetaRows) {
      const sectionId = String(row['section_id'] ?? '');
      if (!sectionId) continue;
      insertCurrentMetaToDraft.run(
        draftId,
        sectionId,
        sectionId,
        null,
        row['status'] ?? 'pending',
        row['writing_instruction'] ?? null,
        row['concept_ids'] ?? '[]',
        row['paper_ids'] ?? '[]',
        row['ai_model'] ?? null,
        row['evidence_status'] ?? null,
        row['evidence_gaps'] ?? '[]',
        row['created_at'] ?? article.created_at,
        row['updated_at'] ?? article.updated_at,
      );
    }

    const parsed = parseArticleDocument(article.document_json);
    const projection = buildDocumentProjection(parsed);
    for (const section of projection.flatSections) {
      insertDraftSectionMeta.run(
        draftId,
        section.id,
        section.id,
        'pending',
        null,
        '[]',
        '[]',
        null,
        null,
        '[]',
        article.created_at,
        article.updated_at,
      );
    }
  }
}
