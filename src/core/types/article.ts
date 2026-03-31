import type { ArticleId, OutlineEntryId, ConceptId, PaperId } from './common';

// ═══ 字面量联合 + const 数组 ═══

export const ARTICLE_STYLES = [
  'academic_blog',
  'formal_paper',
  'technical_doc',
] as const;
export type ArticleStyle = (typeof ARTICLE_STYLES)[number];

export const ARTICLE_STATUSES = [
  'drafting',
  'reviewing',
  'published',
] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export const OUTLINE_ENTRY_STATUSES = [
  'pending',
  'drafted',
  'revised',
  'finalized',
] as const;
export type OutlineEntryStatus = (typeof OUTLINE_ENTRY_STATUSES)[number];

// ═══ Article ═══

export interface ArticleAuthor {
  name: string;
  affiliation?: string;
  email?: string;
  isCorresponding?: boolean;
}

export interface Article {
  id: ArticleId;
  title: string;
  style: ArticleStyle;
  cslStyleId: string; // e.g. "apa", "chicago-author-date", "gb-7714-2015-numeric"
  outputLanguage: string; // BCP 47
  status: ArticleStatus;
  abstract: string | null;
  keywords: string[]; // JSON array in DB
  authors: ArticleAuthor[]; // JSON array in DB
  targetWordCount: number | null;
  createdAt: string;
  updatedAt: string;
}

// ═══ OutlineEntry ═══

export interface OutlineEntry {
  id: OutlineEntryId;
  articleId: ArticleId;
  parentId: OutlineEntryId | null;
  depth: number;
  sortOrder: number;
  title: string;
  coreArgument: string | null;
  writingInstruction: string | null;
  conceptIds: ConceptId[];
  paperIds: PaperId[];
  status: OutlineEntryStatus;
}

// ═══ SectionDraft ═══

export type DraftSource = 'manual' | 'auto' | 'ai-generate' | 'ai-rewrite';

export interface SectionDraft {
  outlineEntryId: OutlineEntryId;
  version: number; // 从 1 开始单调递增
  content: string; // Markdown 格式
  documentJson: string | null; // ProseMirror JSON (primary format)
  llmBackend: string; // e.g. "claude-opus"
  source: DraftSource;
  editedParagraphs: number[]; // 研究者手动编辑的段落索引（从 0 开始）
  createdAt: string;
  /** Paper IDs cited in this section (populated by citation tracking). */
  citedPaperIds?: string[] | undefined;
}

// ═══ Article Asset ═══

export interface ArticleAsset {
  id: string;
  articleId: ArticleId;
  fileName: string;
  mimeType: string;
  filePath: string;
  fileSize: number;
  caption: string | null;
  altText: string | null;
  createdAt: string;
}

// ═══ Cross-Reference Label ═══

export type CrossRefType = 'figure' | 'table' | 'equation' | 'section';

export interface CrossRefLabel {
  id: string;
  articleId: ArticleId;
  label: string;
  refType: CrossRefType;
  sectionId: string | null;
  displayNumber: string | null;
  createdAt: string;
}
