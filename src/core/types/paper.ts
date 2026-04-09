import type { PaperId } from './common';
import type {
  PaperType,
  Relevance,
  AnalysisStatus,
  FulltextStatus,
} from '../../shared-types/enums';

// ═══ 字面量联合 + const 数组 ═══
// 唯一定义源在 shared-types/enums，此处 re-export 并提供 const 数组用于运行时校验。

export type { PaperType, Relevance, AnalysisStatus, FulltextStatus };

export const PAPER_TYPES = [
  'journal',
  'conference',
  'book',
  'chapter',
  'preprint',
  'review',
  'webpage',
  'unknown',
] as const;

export const PAPER_SOURCES = [
  'semantic_scholar',
  'openalex',
  'arxiv',
  'crossref',
  'bibtex',
  'ris',
  'manual',
  'web',
  'google_scholar',
  'tavily_scholar',
  'baidu_xueshu',
] as const;
export type PaperSource = (typeof PAPER_SOURCES)[number];

export const FULLTEXT_STATUSES = [
  'not_attempted',
  'pending',
  'available',
  'abstract_only',
  'failed',
] as const;

export const ANALYSIS_STATUSES = [
  'not_started',
  'in_progress',
  'completed',
  'needs_review',
  'failed',
] as const;

export const RELEVANCES = ['seed', 'high', 'medium', 'low', 'excluded'] as const;

// ═══ PaperMetadata ═══

export interface PaperMetadata {
  // 身份标识
  id: PaperId;
  title: string;
  authors: string[]; // "LastName, FirstName" 格式，至少一个元素
  year: number;
  doi: string | null;
  arxivId: string | null;

  // 期刊/会议
  venue: string | null;
  journal: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  publisher: string | null;

  // 书籍特有
  isbn: string | null;
  edition: string | null;
  editors: string[] | null;
  bookTitle: string | null;
  series: string | null;

  // 标识符族
  issn: string | null;
  pmid: string | null;
  pmcid: string | null;
  url: string | null;

  // 通用
  abstract: string | null;
  citationCount: number | null;
  paperType: PaperType;
  source: PaperSource;

  // 引文控制
  bibtexKey: string | null;
  biblioComplete: boolean;

  // 网页来源
  sourceUrl?: string | null;
}

// ═══ PaperStatus ═══

export interface PaperStatus {
  paperId: PaperId;
  fulltextStatus: FulltextStatus;
  fulltextPath: string | null;
  textPath: string | null;
  analysisStatus: AnalysisStatus;
  analysisPath: string | null;
  relevance: Relevance;
  decisionNote: string | null;
  failureReason: string | null;
  discoveredAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
