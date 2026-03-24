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

let _seq = 0;
/** 自增 ID，避免测试间冲突 */
function nextId(prefix = 'test'): string {
  return `${prefix}_${++_seq}`;
}

/** 重置计数器（在需要确定性 ID 的测试中调用） */
export function resetFixtureSeq(): void {
  _seq = 0;
}

// ── Paper ──

export function makePaper(overrides: Partial<PaperMetadata> = {}): PaperMetadata {
  return {
    id: nextId('paper'),
    title: 'A Test Paper on Unit Testing',
    authors: ['Alice', 'Bob'],
    year: 2024,
    paperType: 'journal',
    source: 'semantic_scholar',
    ...overrides,
  };
}

// ── TextChunk ──

export function makeChunk(overrides: Partial<TextChunk> = {}): TextChunk {
  const id = nextId('chunk');
  return {
    chunkId: id,
    paperId: nextId('paper'),
    section: 'Introduction',
    pageStart: 1,
    pageEnd: 2,
    text: `Sample chunk text for ${id}`,
    tokenCount: 128,
    ...overrides,
  };
}

// ── Annotation ──

export function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    paperId: nextId('paper'),
    page: 1,
    rect: [0, 0, 100, 20],
    text: 'highlighted text',
    type: 'highlight',
    ...overrides,
  };
}

// ── Concept ──

export function makeConcept(overrides: Partial<ConceptDefinition> = {}): ConceptDefinition {
  const id = nextId('concept');
  return {
    id,
    nameZh: '测试概念',
    nameEn: 'Test Concept',
    layer: 'core',
    definition: 'A concept used in testing',
    keywords: ['test', 'unit'],
    ...overrides,
  };
}

// ── ConceptMapping ──

export function makeMapping(overrides: Partial<ConceptMapping> = {}): ConceptMapping {
  return {
    conceptId: nextId('concept'),
    relation: 'supports',
    confidence: 0.85,
    evidence: 'The paper provides empirical evidence.',
    ...overrides,
  };
}
