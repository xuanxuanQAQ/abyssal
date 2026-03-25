// ═══ Process Module — 公共接口 ═══
//
// 将 PDF 文件转化为结构化数据（TextChunk、SectionMap、参考文献、FigureBlock）。
// 仅依赖 types/ 和 infra/token-counter，不依赖 database/rag/search/acquire。

import type { AbyssalConfig } from '../types/config';
import type { PaperId } from '../types/common';
import type { VisionCapable } from '../types/common';
import type {
  TextExtractionResult,
  ExtractedReference,
  FigureCandidate,
  FigureBlock,
  PdfAnnotationRaw,
} from '../types';
import type {
  TextChunk,
  SectionMap,
  SectionBoundaryList,
  ChunkSource,
} from '../types/chunk';

import { extractText, terminateOcrWorker } from './extract-text';
import type { ExtractTextOptions } from './extract-text';
import { extractSections } from './extract-sections';
import type { ExtractSectionsResult } from './extract-sections';
import { extractReferences } from './extract-references';
import { chunkText } from './chunk-text';
import type { ChunkTextOptions } from './chunk-text';
import { detectFigurePages } from './detect-figures';
import { parseFiguresWithVlm } from './parse-figures-vlm';
import type { ParseFiguresOptions } from './parse-figures-vlm';
import { readAnnotations, writeAnnotation } from './annotations';
import type { WriteAnnotationData } from './annotations';
import { compressForContext } from './compress';

// ─── 类型重导出 ───

export type { ExtractTextOptions } from './extract-text';
export type { ExtractSectionsResult } from './extract-sections';
export type { ChunkTextOptions } from './chunk-text';
export type { ParseFiguresOptions } from './parse-figures-vlm';
export type { WriteAnnotationData } from './annotations';
export { extractText } from './extract-text';
export { extractSections } from './extract-sections';
export { extractReferences } from './extract-references';
export { chunkText } from './chunk-text';
export { detectFigurePages } from './detect-figures';
export { parseFiguresWithVlm } from './parse-figures-vlm';
export { readAnnotations, writeAnnotation } from './annotations';
export { compressForContext } from './compress';

// ═══ ProcessService ═══

export class ProcessService {
  private readonly config: AbyssalConfig;
  private readonly vlm: VisionCapable | null;

  constructor(config: AbyssalConfig, vlm?: VisionCapable | null) {
    this.config = config;
    this.vlm = vlm ?? null;
  }

  // ─── §1 文本提取 ───

  async extractText(
    pdfPath: string,
    options?: ExtractTextOptions,
  ): Promise<TextExtractionResult> {
    return extractText(pdfPath, {
      ocrEnabled: this.config.analysis.ocrEnabled,
      ocrLanguages: this.config.analysis.ocrLanguages,
      charDensityThreshold: this.config.analysis.charDensityThreshold,
      ...options,
    });
  }

  // ─── §2 结构识别 ───

  extractSections(
    fullText: string,
    styledLines?: import('../types').StyledLine[],
  ): ExtractSectionsResult {
    return extractSections(fullText, styledLines);
  }

  // ─── §3 参考文献提取 ───

  extractReferences(fullText: string): ExtractedReference[] {
    return extractReferences(fullText);
  }

  // ─── §4 结构感知分块 ───

  chunkText(
    sectionMap: SectionMap,
    boundaries: SectionBoundaryList,
    pageTexts: string[],
    options?: ChunkTextOptions,
  ): TextChunk[] {
    return chunkText(sectionMap, boundaries, pageTexts, {
      maxTokensPerChunk: this.config.analysis.maxTokensPerChunk,
      overlapTokens: this.config.analysis.overlapTokens,
      ...options,
    });
  }

  // ─── §5 图表检测与解析 ───

  async detectFigurePages(pdfPath: string): Promise<FigureCandidate[]> {
    return detectFigurePages(pdfPath);
  }

  async parseFiguresWithVlm(
    pdfPath: string,
    candidates: FigureCandidate[],
    options?: ParseFiguresOptions,
  ): Promise<FigureBlock[]> {
    if (!this.vlm) {
      // TODO: VLM 未配置时返回空数组，由 orchestrator 处理
      return [];
    }
    return parseFiguresWithVlm(pdfPath, candidates, this.vlm, options);
  }

  // ─── §6 标注 ───

  async readAnnotations(pdfPath: string): Promise<PdfAnnotationRaw[]> {
    return readAnnotations(pdfPath);
  }

  async writeAnnotation(
    pdfPath: string,
    data: WriteAnnotationData,
  ): Promise<void> {
    return writeAnnotation(pdfPath, data);
  }

  // ─── §7 压缩 ───

  compressForContext(
    sectionMap: SectionMap,
    targetTokens: number,
  ): string {
    return compressForContext(sectionMap, targetTokens);
  }

  // ─── 资源管理 ───

  /** 应用退出时调用，释放 tesseract.js Worker */
  async terminate(): Promise<void> {
    await terminateOcrWorker();
  }
}

// ═══ 工厂函数 ═══

export function createProcessService(
  config: AbyssalConfig,
  vlm?: VisionCapable | null,
): ProcessService {
  return new ProcessService(config, vlm);
}
