import { describe, expect, it } from 'vitest';
import { groupDocumentBlocksByPage } from './useLayoutBlocks';

describe('groupDocumentBlocksByPage', () => {
  it('builds a page-indexed map from bulk IPC payloads', () => {
    const grouped = groupDocumentBlocksByPage([
      { pageIndex: 0, blocks: [{ type: 'text', bbox: { x: 0, y: 0, w: 1, h: 1 }, confidence: 0.9, pageIndex: 0 }] },
      { pageIndex: 2, blocks: [{ type: 'figure', bbox: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 }, confidence: 0.8, pageIndex: 2 }] },
    ]);

    expect(grouped.get(0)).toHaveLength(1);
    expect(grouped.get(2)?.[0]?.type).toBe('figure');
  });
});