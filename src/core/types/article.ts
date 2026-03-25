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

export interface Article {
  id: ArticleId;
  title: string;
  style: ArticleStyle;
  cslStyleId: string; // e.g. "apa", "chicago-author-date", "gb-7714-2015-numeric"
  outputLanguage: string; // BCP 47
  status: ArticleStatus;
  createdAt: string;
  updatedAt: string;
}

// ═══ OutlineEntry ═══

export interface OutlineEntry {
  id: OutlineEntryId;
  articleId: ArticleId;
  sortOrder: number;
  title: string;
  coreArgument: string | null;
  writingInstruction: string | null;
  conceptIds: ConceptId[];
  paperIds: PaperId[];
  status: OutlineEntryStatus;
}

// ═══ SectionDraft ═══

export interface SectionDraft {
  outlineEntryId: OutlineEntryId;
  version: number; // 从 1 开始单调递增
  content: string; // Markdown 格式
  llmBackend: string; // e.g. "claude-opus"
  editedParagraphs: number[]; // 研究者手动编辑的段落索引（从 0 开始）
  createdAt: string;
}
