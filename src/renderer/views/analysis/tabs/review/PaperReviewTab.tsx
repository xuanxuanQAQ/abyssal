/**
 * PaperReviewTab -- Top-level container for paper review workflow.
 *
 * Vertical scrollable layout:
 *   Toolbar (selector + actions) -> AnalysisReport -> MappingReviewList -> AdjudicationTimeline
 *
 * Reads selectedPaperId from the app store; falls back to the first paper
 * with analysisStatus === 'completed'.
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../../../core/store';
import { usePaperList, usePaper, useResetAnalysis } from '../../../../core/ipc/hooks/usePapers';
import { useMappingsForPaper } from '../../../../core/ipc/hooks/useMappings';
import { PaperSelector } from './PaperSelector';
import { AnalysisReport } from './AnalysisReport';
import { MappingReviewList } from './MappingReviewList';
import { AdjudicationTimeline } from './AdjudicationTimeline';
import { useAppDialog } from '../../../../shared/useAppDialog';
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
  const { t } = useTranslation();
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
  const resetAnalysis = useResetAnalysis();
  const { confirm, dialog } = useAppDialog();

  // Fetch concept timeline entries for adjudication timestamps
  const [timelineEntries, setTimelineEntries] = useState<Array<{ conceptId: string; timestamp: string; changeType: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    const loadTimeline = async () => {
      try {
        const { getAPI } = await import('../../../../core/ipc/bridge');
        const entries = await getAPI().db.concepts.getTimeline();
        if (!cancelled) {
          setTimelineEntries(entries as any);
        }
      } catch { /* optional data */ }
    };
    void loadTimeline();
    return () => { cancelled = true; };
  }, []);

  const handleDeleteAnalysis = useCallback(async () => {
    if (!activePaperId) return;
    const confirmed = await confirm({
      title: t('analysis.review.deleteReport', { defaultValue: 'Delete Analysis' }),
      description: t('analysis.review.confirmDelete', { defaultValue: 'Delete analysis report and all concept mappings for this paper? This cannot be undone.' }),
      confirmLabel: t('common.delete'),
      confirmTone: 'danger',
    });
    if (!confirmed) return;
    resetAnalysis.mutate(activePaperId);
  }, [activePaperId, confirm, resetAnalysis, t]);

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
      <>
        <div className="analysis-scroll-stage workspace-empty-state" style={{ padding: 'var(--space-6)', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
          {t('analysis.review.loading')}
        </div>
        {dialog}
      </>
    );
  }

  if (completedPapers.length === 0) {
    return (
      <>
        <div className="analysis-scroll-stage workspace-empty-state" style={{ padding: 'var(--space-6)', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
          {t('analysis.review.noAnalyses')}
        </div>
        {dialog}
      </>
    );
  }

  return (
    <>
      <div className="analysis-scroll-stage analysis-review-stage" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
      {/* ── Toolbar: selector + actions ── */}
      <div
        className="workspace-toolbar analysis-toolbar analysis-review-toolbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: 'var(--space-4) var(--space-5)',
          flexShrink: 0,
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <PaperSelector
            papers={selectorItems}
            selectedId={activePaperId}
            onSelect={setLocalSelectedId}
          />
        </div>
        {paper?.analysisReport && (
          <button
            onClick={handleDeleteAnalysis}
            disabled={resetAnalysis.isPending}
            className="analysis-action-btn analysis-action-btn--danger"
            title={t('analysis.review.deleteReport', { defaultValue: 'Delete Analysis' })}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
              padding: '5px 10px',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-muted)',
              backgroundColor: 'transparent',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm, 6px)',
              cursor: resetAnalysis.isPending ? 'not-allowed' : 'pointer',
              opacity: resetAnalysis.isPending ? 0.5 : 1,
              whiteSpace: 'nowrap',
              flexShrink: 0,
              transition: 'color 0.15s, border-color 0.15s',
            }}
            onMouseEnter={(e) => {
              if (!resetAnalysis.isPending) {
                e.currentTarget.style.color = 'var(--danger)';
                e.currentTarget.style.borderColor = 'var(--danger)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-muted)';
              e.currentTarget.style.borderColor = 'var(--border-subtle)';
            }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
              <path d="M5.5 1.5h5M2.5 4h11M6 7v4.5M10 7v4.5M3.5 4l.75 8.5a1.5 1.5 0 001.5 1.375h4.5a1.5 1.5 0 001.5-1.375L12.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {resetAnalysis.isPending
              ? t('analysis.review.deleting', { defaultValue: 'Deleting...' })
              : t('analysis.review.deleteReport', { defaultValue: 'Delete' })}
          </button>
        )}
      </div>

      {/* ── Report card ── */}
      {paper && (
        <div className="analysis-section-block" style={{ padding: 'var(--space-4) var(--space-5)', flexShrink: 0 }}>
          <AnalysisReport report={paper.analysisReport} />
        </div>
      )}

      {/* ── Concept mappings ── */}
      {activePaperId && (
        <div className="analysis-section-block" style={{ padding: '0 var(--space-5) var(--space-4)', flexShrink: 0 }}>
          <MappingReviewList paperId={activePaperId} />
        </div>
      )}

      {/* ── Adjudication timeline ── */}
      {mappings && mappings.length > 0 && (
        <div className="analysis-section-block" style={{ padding: '0 var(--space-5) var(--space-6)', flexShrink: 0 }}>
          <AdjudicationTimeline mappings={mappings} timelineEntries={timelineEntries} />
        </div>
      )}
      </div>
      {dialog}
    </>
  );
}
