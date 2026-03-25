/**
 * 测试夹具（Fixtures）—— 可复用的测试数据工厂。
 *
 * 设计原则：
 *  - 每个工厂返回一个合法的最小对象，可通过 Partial<T> 覆盖字段
 *  - 不做 deep merge，只用 spread 浅覆盖，保持简单
 *
 * 用法（类比 gtest）：
 *  gtest:   PaperMetadata paper{.id = "x", .title = "y"};
 *  vitest:  const paper = makePaper({ id: 'x', title: 'y' });
 */
import type { PaperMetadata, TextChunk, Annotation, ConceptDefinition, ConceptMapping } from '@core/types';
import {
  asPaperId,
  asChunkId,
  asConceptId,
  asAnnotationId,
  type PaperId,
  type ConceptId,
} from '@core/types';

let _seq = 0;
/** 自增 ID，避免测试间冲突 */
function nextId(prefix = 'test'): string {
  return `${prefix}_${++_seq}`;
}

/** 生成 12 字符十六进制的假 PaperId */
function nextPaperId(): PaperId {
  const hex = (++_seq).toString(16).padStart(12, '0');
  return asPaperId(hex);
}

/** 生成合法 ConceptId */
function nextConceptId(): ConceptId {
  return asConceptId(`test_concept_${++_seq}`);
}

/** 重置计数器（在需要确定性 ID 的测试中调用） */
export function resetFixtureSeq(): void {
  _seq = 0;
}

// ── Paper ──

export function makePaper(overrides: Partial<PaperMetadata> = {}): PaperMetadata {
  return {
    id: nextPaperId(),
    title: 'A Test Paper on Unit Testing',
    authors: ['Alice, A.', 'Bob, B.'],
    year: 2024,
    doi: null,
    arxivId: null,
    venue: null,
    journal: null,
    volume: null,
    issue: null,
    pages: null,
    publisher: null,
    isbn: null,
    edition: null,
    editors: null,
    bookTitle: null,
    series: null,
    issn: null,
    pmid: null,
    pmcid: null,
    url: null,
    abstract: null,
    citationCount: null,
    paperType: 'journal',
    source: 'semantic_scholar',
    bibtexKey: null,
    biblioComplete: false,
    ...overrides,
  };
}

// ── TextChunk ──

export function makeChunk(overrides: Partial<TextChunk> = {}): TextChunk {
  const id = asChunkId(nextId('chunk'));
  return {
    chunkId: id,
    paperId: nextPaperId(),
    sectionLabel: 'introduction',
    sectionTitle: 'Introduction',
    sectionType: 'introduction',
    pageStart: 1,
    pageEnd: 2,
    text: `Sample chunk text for ${id}`,
    tokenCount: 128,
    source: 'paper',
    positionRatio: null,
    parentChunkId: null,
    chunkIndex: null,
    contextBefore: null,
    contextAfter: null,
    ...overrides,
  };
}

// ── Annotation ──

export function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: asAnnotationId(++_seq),
    paperId: nextPaperId(),
    page: 1,
    rect: { x0: 0, y0: 0, x1: 100, y1: 20 },
    selectedText: 'highlighted text',
    type: 'highlight',
    color: '#FFEB3B',
    comment: null,
    conceptId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Concept ──

export function makeConcept(overrides: Partial<ConceptDefinition> = {}): ConceptDefinition {
  const id = nextConceptId();
  return {
    id,
    nameZh: '测试概念',
    nameEn: 'Test Concept',
    layer: 'core',
    definition: 'A concept used in testing',
    searchKeywords: ['test', 'unit'],
    maturity: 'tentative',
    parentId: null,
    history: [],
    deprecated: false,
    deprecatedAt: null,
    deprecatedReason: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── ConceptMapping ──

export function makeMapping(overrides: Partial<ConceptMapping> = {}): ConceptMapping {
  return {
    paperId: nextPaperId(),
    conceptId: nextConceptId(),
    relation: 'supports',
    confidence: 0.85,
    evidence: {
      en: 'The paper provides empirical evidence.',
      original: '论文提供了实证证据。',
      originalLang: 'zh-CN',
      chunkId: null,
      page: null,
      annotationId: null,
    },
    annotationId: null,
    reviewed: false,
    reviewedAt: null,
    ...overrides,
  };
}
