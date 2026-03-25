// ═══ 品牌类型（Branded Types） ═══

declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

/** 论文内部 ID（SHA-1 前 12 字符十六进制） */
export type PaperId = Brand<string, 'PaperId'>;
/** 概念 ID（小写蛇形标识符） */
export type ConceptId = Brand<string, 'ConceptId'>;
/** 文本块 ID（格式化字符串） */
export type ChunkId = Brand<string, 'ChunkId'>;
/** 文章 ID */
export type ArticleId = Brand<string, 'ArticleId'>;
/** 纲要节 ID */
export type OutlineEntryId = Brand<string, 'OutlineEntryId'>;
/** 碎片笔记 ID */
export type MemoId = Brand<string, 'MemoId'>;
/** 结构化笔记 ID（UUID） */
export type NoteId = Brand<string, 'NoteId'>;
/** 标注 ID（SQLite 自增整数） */
export type AnnotationId = Brand<number, 'AnnotationId'>;
/** 概念建议 ID（SQLite 自增整数） */
export type SuggestionId = Brand<number, 'SuggestionId'>;

// ═══ 类型守卫 ═══

const HEX_12 = /^[0-9a-f]{12}$/;
const CONCEPT_ID_RE = /^[a-z][a-z0-9_]{0,63}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPaperId(s: string): s is PaperId {
  return HEX_12.test(s);
}

export function isConceptId(s: string): s is ConceptId {
  return CONCEPT_ID_RE.test(s);
}

export function isNoteId(s: string): s is NoteId {
  return UUID_RE.test(s);
}

// ═══ 类型构造器 ═══

// NOTE: ConfigError 定义在 errors.ts，此处为避免循环依赖直接抛 Error。
// 上层调用方（infra/ 以上）应使用 ConfigError。

export function asPaperId(s: string): PaperId {
  if (!isPaperId(s)) {
    throw new Error(`Invalid PaperId: "${s}" — expected 12-char hex string`);
  }
  return s as PaperId;
}

export function asConceptId(s: string): ConceptId {
  if (!isConceptId(s)) {
    throw new Error(
      `Invalid ConceptId: "${s}" — expected /^[a-z][a-z0-9_]{0,63}$/`,
    );
  }
  return s as ConceptId;
}

export function asChunkId(s: string): ChunkId {
  return s as ChunkId;
}

export function asArticleId(s: string): ArticleId {
  return s as ArticleId;
}

export function asOutlineEntryId(s: string): OutlineEntryId {
  return s as OutlineEntryId;
}

export function asMemoId(s: string): MemoId {
  return s as MemoId;
}

export function asNoteId(s: string): NoteId {
  if (!isNoteId(s)) {
    throw new Error(`Invalid NoteId: "${s}" — expected UUID v4`);
  }
  return s as NoteId;
}

export function asAnnotationId(n: number): AnnotationId {
  return n as AnnotationId;
}

export function asSuggestionId(n: number): SuggestionId {
  return n as SuggestionId;
}

// ═══ 共享工具类型 ═══

/** 混入：创建/更新时间戳 */
export interface Timestamped {
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/** 分页返回值 */
export interface PaginatedResult<T> {
  items: T[];
  totalCount: number;
  offset: number;
  limit: number;
}

/** 排序规范 */
export interface SortSpec {
  field: string;
  order: 'asc' | 'desc';
}

// ═══ 依赖注入接口 ═══

/** VLM 图像描述能力（process 模块通过此接口调用 LLM，保持 LLM 无关性） */
export interface VisionCapable {
  describeImage(
    imageBase64: string,
    mimeType: 'image/png' | 'image/jpeg',
    prompt: string,
    maxTokens: number,
  ): Promise<string>;
}

/** 嵌入生成函数（rag 模块通过此接口调用嵌入后端） */
export interface EmbedFunction {
  embed(texts: string[]): Promise<Float32Array[]>;
}
