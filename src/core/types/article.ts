import type { ArticleId, DraftId, OutlineEntryId, ConceptId, PaperId } from './common';

// ═══ 字面量联合 + const 数组 ═══

export const ARTICLE_STYLES = [
  'academic_blog',
  'formal_paper',
  'technical_doc',
  'narrative_review',
  'policy_brief',
] as const;
export type ArticleStyle = (typeof ARTICLE_STYLES)[number];

/** Chinese display labels for route-level style selector. */
export const ARTICLE_STYLE_LABELS: Record<ArticleStyle, string> = {
  formal_paper: '正式学术论文',
  technical_doc: '技术说明/技术报告',
  academic_blog: '学术博客',
  narrative_review: '叙事式综述',
  policy_brief: '政策简报/决策汇报',
};

export const ARTICLE_STATUSES = [
  'drafting',
  'reviewing',
  'published',
] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export const DRAFT_STATUSES = [
  'drafting',
  'review',
  'ready',
  'archived',
] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

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
  documentJson?: string | null;
  abstract: string | null;
  keywords: string[]; // JSON array in DB
  authors: ArticleAuthor[]; // JSON array in DB
  targetWordCount: number | null;
  defaultDraftId?: DraftId | null;
  createdAt: string;
  updatedAt: string;
}

export type DraftSource = 'manual' | 'auto' | 'ai-generate' | 'ai-rewrite' | 'ai-derive-draft' | 'duplicate';

export interface Draft {
  id: DraftId;
  articleId: ArticleId;
  title: string;
  status: DraftStatus;
  documentJson: string;
  basedOnDraftId: DraftId | null;
  source: DraftSource;
  language: string | null;
  audience: string | null;
  writingStyle: string | null;
  cslStyleId: string | null;
  abstract: string | null;
  keywords: string[];
  targetWordCount: number | null;
  lastOpenedAt: string | null;
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

export interface ArticleSectionMeta {
  articleId: ArticleId;
  sectionId: string;
  status: OutlineEntryStatus;
  writingInstruction: string | null;
  conceptIds: ConceptId[];
  paperIds: PaperId[];
  aiModel: string | null;
  evidenceStatus: string | null;
  evidenceGaps: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DraftSectionMeta {
  draftId: DraftId;
  sectionId: string;
  lineageId: string;
  basedOnSectionId: string | null;
  status: OutlineEntryStatus;
  writingInstruction: string | null;
  conceptIds: ConceptId[];
  paperIds: PaperId[];
  aiModel: string | null;
  evidenceStatus: string | null;
  evidenceGaps: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ArticleSectionVersion {
  articleId: ArticleId;
  sectionId: string;
  version: number;
  title: string;
  content: string;
  documentJson: string | null;
  contentHash: string;
  source: DraftSource;
  createdAt: string;
}

export interface DraftVersion {
  draftId: DraftId;
  version: number;
  title: string;
  content: string;
  documentJson: string;
  contentHash: string;
  source: DraftSource;
  summary: string | null;
  createdAt: string;
}

export interface DraftGenerationJob {
  jobId: string;
  articleId: ArticleId;
  draftId: DraftId;
  sourceDraftId: DraftId | null;
  operation: 'derive-draft' | 'generate-draft';
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  stage: 'initializing' | 'building-outline' | 'generating-sections' | 'assembling' | 'finalizing';
  progressCurrent: number;
  progressTotal: number;
  checkpoint: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DraftAssetReference {
  draftId: DraftId;
  assetId: string;
  referencedAt: string;
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
