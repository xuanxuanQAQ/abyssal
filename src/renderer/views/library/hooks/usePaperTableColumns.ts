/**
 * usePaperTableColumns — TanStack Table 列定义（§3.2）
 *
 * 11 列：select, relevance, title, authors, year, paperType,
 *        fulltextStatus, processStatus, analysisStatus, decisionNote, dateAdded
 *
 * 自定义排序比较函数：relevance 权重、status 优先级、Intl.Collator 中文排序。
 */

import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import type { Paper } from '../../../../shared-types/models';
import type { Relevance, AnalysisStatus, FulltextStatus } from '../../../../shared-types/enums';

const columnHelper = createColumnHelper<Paper>();

/** 排序权重映射 */
const RELEVANCE_WEIGHT: Record<Relevance, number> = {
  seed: 5,
  high: 4,
  medium: 3,
  low: 2,
  excluded: 1,
};

const ANALYSIS_WEIGHT: Record<AnalysisStatus, number> = {
  needs_review: 5,
  in_progress: 4,
  not_started: 3,
  completed: 2,
  failed: 1,
  skipped: 0,
};

const FULLTEXT_WEIGHT: Record<FulltextStatus, number> = {
  pending: 4,
  not_attempted: 3,
  abstract_only: 2,
  failed: 1,
  available: 0,
};

const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

export function usePaperTableColumns() {
  return useMemo(
    () => [
      // select 列（由 SelectCell 渲染，不参与排序）
      columnHelper.display({
        id: 'select',
        size: 36,
        minSize: 28,
        maxSize: 60,
        enableResizing: true,
        enableSorting: false,
      }),

      // relevance
      columnHelper.accessor('relevance', {
        id: 'relevance',
        header: '★',
        size: 40,
        minSize: 32,
        maxSize: 80,
        enableResizing: true,
        sortingFn: (rowA, rowB) =>
          RELEVANCE_WEIGHT[rowA.original.relevance] -
          RELEVANCE_WEIGHT[rowB.original.relevance],
      }),

      // title
      columnHelper.accessor('title', {
        id: 'title',
        header: '标题',
        size: 300,
        minSize: 100,
        maxSize: 800,
        enableResizing: true,
        sortingFn: (rowA, rowB) =>
          collator.compare(rowA.original.title, rowB.original.title),
      }),

      // authors
      columnHelper.accessor('authors', {
        id: 'authors',
        header: '作者',
        size: 160,
        minSize: 60,
        maxSize: 400,
        enableResizing: true,
        enableSorting: true,
        sortingFn: (rowA, rowB) => {
          const a = rowA.original.authors[0]?.name ?? '';
          const b = rowB.original.authors[0]?.name ?? '';
          return collator.compare(a, b);
        },
      }),

      // year
      columnHelper.accessor('year', {
        id: 'year',
        header: '年份',
        size: 60,
        minSize: 40,
        maxSize: 120,
        enableResizing: true,
      }),

      // paperType
      columnHelper.accessor('paperType', {
        id: 'paperType',
        header: '类型',
        size: 80,
        minSize: 40,
        maxSize: 160,
        enableResizing: true,
      }),

      // fulltextStatus
      columnHelper.accessor('fulltextStatus', {
        id: 'fulltextStatus',
        header: '全文',
        size: 56,
        minSize: 32,
        maxSize: 100,
        enableResizing: true,
        sortingFn: (rowA, rowB) =>
          FULLTEXT_WEIGHT[rowA.original.fulltextStatus] -
          FULLTEXT_WEIGHT[rowB.original.fulltextStatus],
      }),

      columnHelper.accessor((paper) => (paper.textPath ? 2 : paper.fulltextPath || paper.fulltextStatus === 'available' ? 1 : 0), {
        id: 'processStatus',
        header: '处理',
        size: 56,
        minSize: 32,
        maxSize: 100,
        enableResizing: true,
        sortingFn: (rowA, rowB) => {
          const processWeight = (paper: Paper) => {
            if (paper.textPath) return 2;
            if (paper.fulltextPath || paper.fulltextStatus === 'available') return 1;
            return 0;
          };

          return processWeight(rowA.original) - processWeight(rowB.original);
        },
      }),

      // analysisStatus
      columnHelper.accessor('analysisStatus', {
        id: 'analysisStatus',
        header: '分析',
        size: 56,
        minSize: 32,
        maxSize: 100,
        enableResizing: true,
        sortingFn: (rowA, rowB) =>
          ANALYSIS_WEIGHT[rowA.original.analysisStatus] -
          ANALYSIS_WEIGHT[rowB.original.analysisStatus],
      }),

      // decisionNote
      columnHelper.accessor('decisionNote', {
        id: 'decisionNote',
        header: '备注',
        size: 120,
        minSize: 50,
        maxSize: 500,
        enableResizing: true,
        enableSorting: false,
      }),

      // dateAdded
      columnHelper.accessor('dateAdded', {
        id: 'dateAdded',
        header: '添加日期',
        size: 100,
        minSize: 60,
        maxSize: 200,
        enableResizing: true,
        // ISO 8601 字符串直接比较
      }),
    ],
    []
  );
}
