/**
 * PaperReviewTab -- Top-level container for paper review workflow.
 *
 * Vertical scrollable layout:
 *   PaperSelector -> AnalysisReport -> MappingReviewList -> AdjudicationTimeline
 *
 * Reads selectedPaperId from the app store; falls back to the first paper
 * with analysisStatus === 'completed'.
 */

import React, { useState, useMemo } from 'react';
import { useAppStore } from '../../../../core/store';
import { usePaperList } from '../../../../core/ipc/hooks/usePapers';
import { usePaper } from '../../../../core/ipc/hooks/usePapers';
import { useMappingsForPaper } from '../../../../core/ipc/hooks/useMappings';
import { PaperSelector } from './PaperSelector';
import { AnalysisReport } from './AnalysisReport';
import { MappingReviewList } from './MappingReviewList';
import { AdjudicationTimeline } from './AdjudicationTimeline';
import type { Paper } from '../../../../../shared-types/models';
import type { Relevance } from '../../../../../shared-types/enums';

/** Relevance sort weight -- higher relevance papers appear first. */
const RELEVANCE_ORDER: Record<Relevance, number> = {
  seed: 0,
  high: 1,
  medium: 2,
  low: 3,
  excluded: 4,
};

export function PaperReviewTab() {
  const storePaperId = useAppStore((s) => s.selectedPaperId);
  const { data: allPapers, isLoading: papersLoading } = usePaperList();

  // Completed papers sorted by relevance
  const completedPapers = useMemo(() => {
    if (!allPapers) return [];
    return allPapers
      .filter((p): p is Paper => p.analysisStatus === 'completed')
      .sort((a, b) => RELEVANCE_ORDER[a.relevance] - RELEVANCE_ORDER[b.relevance]);
  }, [allPapers]);

  // Default selection: store value if it corresponds to a completed paper,
  // otherwise the first completed paper.
  const defaultPaperId = useMemo(() => {
    if (storePaperId && completedPapers.some((p) => p.id === storePaperId)) {
      return storePaperId;
    }
    return completedPapers[0]?.id ?? null;
  }, [storePaperId, completedPapers]);

  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);
  const activePaperId = localSelectedId ?? defaultPaperId;

  const { data: paper } = usePaper(activePaperId);
  const { data: mappings } = useMappingsForPaper(activePaperId);

  // Selector items
  const selectorItems = useMemo(
    () =>
      completedPapers.map((p) => ({
        id: p.id,
        title: p.title,
        authors: p.authors,
        year: p.year,
        relevance: p.relevance,
      })),
    [completedPapers],
  );

  if (papersLoading) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
        Loading...
      </div>
    );
  }

  if (completedPapers.length === 0) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
        No completed analyses yet.
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'auto',
      }}
    >
      <div style={{ padding: '16px 20px', flexShrink: 0 }}>
        <PaperSelector
          papers={selectorItems}
          selectedId={activePaperId}
          onSelect={setLocalSelectedId}
        />
      </div>

      {paper && (
        <div style={{ padding: '0 20px 16px', flexShrink: 0 }}>
          <AnalysisReport report={paper.analysisReport} />
        </div>
      )}

      {activePaperId && (
        <div style={{ padding: '0 20px 16px', flexShrink: 0 }}>
          <MappingReviewList paperId={activePaperId} />
        </div>
      )}

      {mappings && mappings.length > 0 && (
        <div style={{ padding: '0 20px 24px', flexShrink: 0 }}>
          <AdjudicationTimeline mappings={mappings} />
        </div>
      )}
    </div>
  );
}
