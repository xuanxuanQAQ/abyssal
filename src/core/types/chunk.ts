import type { ChunkId, PaperId } from './common';

// ═══ 字面量联合 + const 数组 ═══

export const SECTION_LABELS = [
  'abstract',
  'introduction',
  'background',
  'literature_review',
  'method',
  'results',
  'discussion',
  'conclusion',
  'appendix',
  'unknown',
] as const;
export type SectionLabel = (typeof SECTION_LABELS)[number];

export const SECTION_TYPES = [
  'introduction',
  'methods',
  'results',
  'discussion',
  'conclusion',
  'literature_review',
  'theory',
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export const CHUNK_SOURCES = [
  'paper',
  'annotation',
  'private',
  'memo',
  'note',
  'figure',
] as const;
export type ChunkSource = (typeof CHUNK_SOURCES)[number];

export const CHUNK_ORIGIN_PATHS = [
  'vector',
  'structured',
  'annotation',
  'memo',
  'note',
] as const;
export type ChunkOriginPath = (typeof CHUNK_ORIGIN_PATHS)[number];

// ═══ SectionMap ═══

/** SectionLabel → 该节全文文本的映射（由 process 模块 extractSections 生成） */
export type SectionMap = Map<SectionLabel, string>;

// ═══ SectionBoundary ═══

/** 节标题的原始信息（行号、标签、标题文本） */
export interface SectionBoundary {
  lineIndex: number;
  label: SectionLabel;
  title: string;
  type: SectionType | null;
}

export type SectionBoundaryList = SectionBoundary[];

// ═══ TextChunk ═══

export interface TextChunk {
  chunkId: ChunkId;
  paperId: PaperId | null;
  sectionLabel: SectionLabel | null;
  sectionTitle: string | null;
  sectionType: SectionType | null;
  pageStart: number | null;
  pageEnd: number | null;
  text: string;
  tokenCount: number;
  source: ChunkSource;
  positionRatio: number | null; // [0.0, 1.0]
  parentChunkId: ChunkId | null;
  chunkIndex: number | null;
  contextBefore: string | null;
  contextAfter: string | null;
  /** §8.1: 创建时间 ISO 8601。迁移前的旧 chunk 可能缺失此字段。 */
  createdAt?: string | null | undefined;
}

// ═══ RankedChunk ═══

export interface RankedChunk extends TextChunk {
  displayTitle: string;
  score: number; // [0.0, 1.0]
  rawL2Distance: number | null;
  originPath: ChunkOriginPath;
}
