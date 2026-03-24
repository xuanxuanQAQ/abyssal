/**
 * 单元测试示例 —— core/types
 *
 * 演示：
 *  - 使用 fixtures 工厂创建测试数据
 *  - 基本断言写法（对标 gtest EXPECT_EQ / EXPECT_TRUE）
 */
import { describe, it, expect } from 'vitest';
import { makePaper, makeChunk, makeAnnotation, makeConcept, makeMapping } from '@test-utils';

describe('PaperMetadata fixture', () => {
  it('should produce valid defaults', () => {
    const paper = makePaper();
    expect(paper.id).toBeTruthy();
    expect(paper.authors).toHaveLength(2);
    expect(paper.year).toBeGreaterThan(0);
    expect(paper.paperType).toBe('journal');
  });

  it('should allow field overrides', () => {
    const paper = makePaper({ title: 'Custom Title', year: 1999 });
    expect(paper.title).toBe('Custom Title');
    expect(paper.year).toBe(1999);
    // 未覆盖的字段保持默认
    expect(paper.authors).toHaveLength(2);
  });
});

describe('TextChunk fixture', () => {
  it('should carry section and token info', () => {
    const chunk = makeChunk({ section: 'Methods', tokenCount: 256 });
    expect(chunk.section).toBe('Methods');
    expect(chunk.tokenCount).toBe(256);
    expect(chunk.text).toContain(chunk.chunkId);
  });
});

describe('Annotation fixture', () => {
  it('should default to highlight type', () => {
    const ann = makeAnnotation();
    expect(ann.type).toBe('highlight');
    expect(ann.rect).toHaveLength(4);
  });
});

describe('Concept & Mapping fixtures', () => {
  it('should produce linked concept and mapping', () => {
    const concept = makeConcept({ nameEn: 'Self-Regulation' });
    const mapping = makeMapping({ conceptId: concept.id });

    expect(mapping.conceptId).toBe(concept.id);
    expect(mapping.confidence).toBeGreaterThan(0);
    expect(mapping.confidence).toBeLessThanOrEqual(1);
  });
});
