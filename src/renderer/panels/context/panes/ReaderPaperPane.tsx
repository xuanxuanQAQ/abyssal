/**
 * ReaderPaperPane — Reader 论文上下文（§3.2）
 *
 * AnalysisSummaryCard → MappingSuggestionList → AIProactiveTips
 */

import React from 'react';
import { AnalysisSummaryCard } from '../cards/AnalysisSummaryCard';
import { MappingSuggestionList } from '../cards/MappingSuggestionList';
import { AIProactiveTips } from '../cards/AIProactiveTips';

const scrollContainerStyle: React.CSSProperties = { overflowY: 'auto', height: '100%' };

interface ReaderPaperPaneProps {
  paperId: string;
}

export const ReaderPaperPane = React.memo(function ReaderPaperPane({ paperId }: ReaderPaperPaneProps) {
  return (
    <div style={scrollContainerStyle}>
      <AnalysisSummaryCard paperId={paperId} />
      <MappingSuggestionList paperId={paperId} />
      <AIProactiveTips />
    </div>
  );
});
