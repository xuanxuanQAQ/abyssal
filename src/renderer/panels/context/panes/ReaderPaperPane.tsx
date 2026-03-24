/**
 * ReaderPaperPane — Reader 论文上下文（§3.2）
 *
 * AnalysisSummaryCard → MappingSuggestionList → AIProactiveTips
 */

import React from 'react';
import { AnalysisSummaryCard } from '../cards/AnalysisSummaryCard';
import { MappingSuggestionList } from '../cards/MappingSuggestionList';
import { AIProactiveTips } from '../cards/AIProactiveTips';

interface ReaderPaperPaneProps {
  paperId: string;
}

export function ReaderPaperPane({ paperId }: ReaderPaperPaneProps) {
  return (
    <div style={{ overflowY: 'auto', height: '100%' }}>
      <AnalysisSummaryCard paperId={paperId} />
      <MappingSuggestionList paperId={paperId} />
      <AIProactiveTips />
    </div>
  );
}
