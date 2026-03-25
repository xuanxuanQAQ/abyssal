// ═══ Barrel re-export ═══
// src/core/types/ — 纯类型模块，零运行时依赖（错误类除外）
//
// TODO: src/shared-types/ 是前端 IPC 边界层，与本模块独立维护。
//       适配层（Electron IPC handler）负责两套类型之间的映射转换。
// TODO: src/__test-utils__/ 中的 fixture 工厂需同步更新字段签名。

export * from './common';
export * from './errors';
export * from './paper';
export * from './chunk';
export * from './concept';
export * from './mapping';
export * from './annotation';
export * from './article';
export * from './retrieval';
export * from './bibliography';
export * from './memo';
export * from './note';
export * from './suggestion';
export * from './relation';
export * from './config';

// ═══ 旧版兼容导出 ═══
// 以下类型原属各核心模块内部，暂保留在此处供 stub 模块引用。
// TODO: 各模块实现后应将这些类型移入各自模块内部。

/** LLM 工具定义 */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** LLM 工具调用 */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** LLM 调用选项 */
export interface CompleteOptions {
  tools?: ToolDef[];
  maxTokens?: number;
  temperature?: number;
}

/** LLM 调用结果 */
export interface CompleteResult {
  text?: string;
  toolCalls?: ToolCall[];
}

/** 全文获取尝试记录 */
export interface AcquireAttempt {
  source: string;
  status: 'success' | 'failed' | 'skipped';
  durationMs: number;
  failureReason: string | null;
  httpStatus: number | null;
}

/** 全文获取结果 */
export interface AcquireResult {
  status: 'success' | 'abstract_only' | 'failed';
  pdfPath: string | null;
  source: string | null;
  sha256: string | null;
  fileSize: number | null;
  attempts: AcquireAttempt[];
}

/** PDF 校验结果 */
export interface PdfValidation {
  valid: boolean;
  reason: string | null;
  pageCount: number | null;
  fileSizeBytes: number;
}

/** 引用遍历方向 */
export type CitationDirection = 'citations' | 'references';

/** 图表/表格/公式块 */
export interface FigureBlock {
  pageIndex: number;
  type: 'figure' | 'table' | 'equation' | 'algorithm';
  rect: import('./annotation').PdfRect | null;
  description: string;
  imagePath: string | null;
  captionText: string | null;
  ocrText: string | null;
}

/** 参考文献元数据（从全文中提取） */
export interface RefMetadata {
  title: string;
  authors?: string[] | undefined;
  year?: number | undefined;
  doi?: string | undefined;
}

/** 带样式的行信息（用于节标题识别时辅助排除正则误报） */
export interface StyledLine {
  text: string;
  fontSize: number;
  isBold: boolean;
  pageIndex: number;
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

/** PDF 原始标注数据 */
export interface PdfAnnotationRaw {
  page: number;
  type: 'highlight' | 'note';
  rect: import('./annotation').PdfRect;
  contents: string | null;
  selectedText: string;
  color: [number, number, number] | null;
  createdDate: string | null;
}
