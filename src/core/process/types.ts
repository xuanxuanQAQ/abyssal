// ═══ Process Module Types ═══

import type { PageCharData, PageOcrLines } from '../dla/types';
import type { PdfRect } from '../types/annotation';

/** 带样式的行信息（用于节标题识别时辅助排除正则误报） */
export interface StyledLine {
  text: string;
  fontSize: number;
  isBold: boolean;
  pageIndex: number;
}

/** PDF 内嵌元数据（从 PDF metadata dict 提取） */
export interface PdfEmbeddedMetadata {
  title: string | null;
  author: string | null;
  subject: string | null;
  keywords: string | null;
  creator: string | null;
  producer: string | null;
  creationDate: string | null;
}

/** 首页启发式提取的元数据 */
export interface FirstPageMetadata {
  /** 首页最大字号文本 → 标题候选 */
  titleCandidate: string | null;
  /** 标题下方文本 → 作者候选 */
  authorCandidates: string[];
  /** 首页文本前 2000 字符（供 LLM 提取用） */
  firstPageText: string;
}

/** 文本提取结果 */
export interface TextExtractionResult {
  fullText: string;
  pageCount: number;
  method: 'mupdf' | 'ocr' | 'mupdf+ocr';
  pageTexts: string[];
  charCount: number;
  estimatedTokenCount: number;
  ocrConfidence: number | null;
  scannedPageIndices: number[];
  /** 带字体元数据的行列表（供 extractSections 使用以提高节标题识别精度） */
  styledLines: StyledLine[];
  /** PDF 内嵌元数据 */
  pdfMetadata: PdfEmbeddedMetadata;
  /** 首页启发式提取结果 */
  firstPage: FirstPageMetadata;
  /** 每页字符位置数据（供 DLA block-text 融合使用） */
  pageCharData?: PageCharData[];
  /** OCR 行级 bbox 数据（按页分组，供阅读器文本层对齐使用） */
  ocrPageLines?: PageOcrLines[];
}

/** 提取的参考文献条目 */
export interface ExtractedReference {
  rawText: string;
  orderIndex: number;
  doi: string | null;
  year: number | null;
  roughAuthors: string | null;
  roughTitle: string | null;
}

/** 图表候选页 */
export interface FigureCandidate {
  pageIndex: number;
  detectionMethod: 'low_density' | 'vector_paths' | 'both';
  densityRatio: number;
  estimatedFigureArea: number;
}

/** 图表/表格/公式块 */
export interface FigureBlock {
  pageIndex: number;
  type: 'figure' | 'table' | 'equation' | 'algorithm';
  rect: PdfRect | null;
  description: string;
  imagePath: string | null;
  captionText: string | null;
  ocrText: string | null;
}

/** PDF 原始标注数据 */
export interface PdfAnnotationRaw {
  page: number;
  type: 'highlight' | 'note';
  rect: PdfRect;
  contents: string | null;
  selectedText: string;
  color: [number, number, number] | null;
  createdDate: string | null;
}