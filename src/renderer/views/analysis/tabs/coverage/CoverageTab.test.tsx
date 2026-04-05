import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CoverageTab } from './CoverageTab';

const pipelineStart = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'analysis.coverage.conceptCount') {
        return `概念覆盖度 (${params?.['count'] ?? 0})`;
      }

      const table: Record<string, string> = {
        'analysis.coverage.loading': '加载覆盖度数据…',
        'analysis.coverage.empty': '尚未定义概念框架。',
        'analysis.coverage.triggerDiscover': '触发定向发现',
        'analysis.coverage.discovering': '发现中…',
        'analysis.coverage.fullyCovered': '个概念已完全覆盖',
        'analysis.coverage.synthesized': '已综合',
        'analysis.coverage.analyzed': '已分析',
        'analysis.coverage.acquired': '已获取',
        'analysis.coverage.pending': '待处理',
        'analysis.coverage.excluded': '已排除',
        'analysis.coverage.noCoverage': '无覆盖 — 触发定向发现',
        'analysis.coverage.lowCoverage': '低覆盖',
        'analysis.coverage.paperSingular': '篇',
        'analysis.coverage.paperPlural': '篇',
      };

      return table[key] ?? key;
    },
  }),
}));

vi.mock('../../../../core/ipc/bridge', () => ({
  getAPI: () => ({
    pipeline: {
      start: pipelineStart,
    },
  }),
}));

vi.mock('./useCoverageData', () => ({
  useCoverageData: () => ({
    completeness: 0,
    isLoading: false,
    concepts: [
      {
        conceptId: 'concept-1',
        conceptName: 'Zero Coverage Concept',
        parentId: null,
        synthesized: 0,
        analyzed: 0,
        acquired: 0,
        pending: 0,
        excluded: 0,
        total: 0,
        score: 0,
      },
    ],
  }),
}));

describe('CoverageTab', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    pipelineStart.mockReset().mockResolvedValue('task-1');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('starts a targeted discover workflow for zero-coverage concepts', async () => {
    act(() => {
      root.render(<CoverageTab />);
    });

    const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent?.includes('触发定向发现'));
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(pipelineStart).toHaveBeenCalledWith('discover', { conceptIds: ['concept-1'] });
  });
});